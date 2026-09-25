"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLng, PlanLocation } from "../lib/geo";

// The intake screen's map: a real Google Map with a Places Autocomplete
// search box floating over its top edge.
//
// On load it asks for the device's location (the browser shows its own
// "allow location?" prompt). If allowed, the map centres there, drops a
// marker, and reports the place via onPlaceSelect — which is what unlocks
// the rest of the page. If refused or unavailable (no permission, no GPS,
// or a non-HTTPS page — browsers only share location over HTTPS or
// localhost), the map stays on a wide UK & Ireland view until the person
// searches. Picking a search result does the same as a found location.
// When `location` changes from outside (e.g. a saved plan is loaded), the
// map pans to it.
//
// The caller passes the exact className/style the old placeholder <div>
// had, so the box's size, rounded corners, colour, and position are
// unchanged — the map fills it, and the same beige shows through while it
// loads or if it can't load (no key, bad key, blocked script).
//
// Uses NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — a browser key by design, so
// restrict it to your domain in Google Cloud Console. NEXT_PUBLIC_GOOGLE_MAP_ID
// is optional (a Map ID from Cloud Console > Map Management); without it,
// Google's DEMO_MAP_ID is used, which is fine for development.

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

// Before any location is known: the UK and Ireland, zoomed out.
const WIDE_VIEW = { center: { lat: 54.3, lng: -4.5 }, zoom: 5 };

// The device's location, or null if refused / unavailable / too slow.
// Calling it shows the browser's permission prompt the first time.
function getDeviceLocation(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.info("[Landed] current location unavailable:", err.message);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 }
    );
  });
}

// Why the device location couldn't be used, in words a person can act on.
async function locationProblem(): Promise<string> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Your location can only be used on a secure (https) page — search for a place instead.";
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "This browser can't share your location — search for a place instead.";
  }
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status?.state === "denied") {
      return "Location is turned off for this site. Allow it in your browser or phone settings, then tap again.";
    }
  } catch {
    // Permissions API not available (e.g. older Safari) — fall through.
  }
  return "Couldn't find your location just now — try again, or search for a place.";
}

// Names the spot at the most local level Google knows: the neighbourhood
// ("Leverstock Green", "Kreuzberg") when there is one, otherwise the town.
// `name` goes in sentences ("…in Leverstock Green"); `label` adds the
// town (or country) for headings and for the live search, which uses it
// together with the exact coordinates.
function describePlace(
  point: LatLng,
  components: google.maps.places.AddressComponent[] | null | undefined,
  fallbackName: string
): PlanLocation {
  const part = (type: string) => components?.find((c) => c.types.includes(type))?.longText;
  const area = part("neighborhood") || part("sublocality_level_2") || part("sublocality_level_1") || part("sublocality");
  const town = part("locality") || part("postal_town") || part("administrative_area_level_2");
  const country = part("country");
  const name = area || town || fallbackName;
  const context = area && town && area !== town ? town : country && country !== name ? country : undefined;
  return { ...point, name, label: context ? `${name}, ${context}` : name };
}

declare global {
  interface Window {
    __landedMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

// Loads the Maps JavaScript API once per page, however many times this
// component mounts. Rejects if the key is missing or the script fails.
let mapsPromise: Promise<void> | null = null;
function loadGoogleMaps(): Promise<void> {
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise<void>((resolve, reject) => {
    if (!MAPS_KEY) {
      reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set"));
      return;
    }
    if (typeof window.google?.maps?.importLibrary === "function") {
      resolve();
      return;
    }
    window.__landedMapsReady = () => resolve();
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({ key: MAPS_KEY, v: "weekly", loading: "async", callback: "__landedMapsReady" });
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(script);
  }).catch((err) => {
    mapsPromise = null; // allow a retry on the next mount
    throw err;
  });
  return mapsPromise;
}

export function LiveMap({
  className,
  style,
  location,
  onPlaceSelect,
  resetSignal,
}: {
  className?: string;
  style?: React.CSSProperties;
  location?: PlanLocation;
  // `source`: a search result, the "Use my location" button, or the
  // automatic location on opening.
  onPlaceSelect?: (place: PlanLocation, source: "search" | "device-button" | "device-auto") => void;
  // Changing this clears the search box and marker and goes back to the
  // device's location (used when + starts a new enquiry).
  resetSignal?: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  onPlaceSelectRef.current = onPlaceSelect;
  const locationRef = useRef(location);
  locationRef.current = location;
  const [failed, setFailed] = useState(false);
  const resetRef = useRef<(() => void) | null>(null);
  // "Use my location" button: set once the map is ready.
  const locateRef = useRef<(() => Promise<boolean>) | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);

  async function handleLocate() {
    if (!locateRef.current || locating) return;
    setLocating(true);
    setLocateNote(null);
    const ok = await locateRef.current();
    setLocating(false);
    if (!ok) setLocateNote(await locationProblem());
  }

  // Hide the note after a while so it doesn't sit over the map.
  useEffect(() => {
    if (!locateNote) return;
    const t = window.setTimeout(() => setLocateNote(null), 8000);
    return () => window.clearTimeout(t);
  }, [locateNote]);

  useEffect(() => {
    if (resetSignal) resetRef.current?.();
  }, [resetSignal]);

  // Follow the plan's location when it's changed from outside the map.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !location) return;
    const center = map.getCenter();
    if (center && Math.abs(center.lat() - location.lat) < 1e-4 && Math.abs(center.lng() - location.lng) < 1e-4) return;
    map.setCenter({ lat: location.lat, lng: location.lng });
    map.setZoom(14);
    if (markerRef.current) {
      markerRef.current.position = { lat: location.lat, lng: location.lng };
      markerRef.current.map = map;
    }
  }, [location]);

  useEffect(() => {
    let cancelled = false;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | null = null;
    // Ask for the device location straight away, in parallel with loading
    // the map script, so the permission prompt appears immediately.
    let deviceLocation = getDeviceLocation();

    // Google calls this global when the key is rejected (invalid key,
    // referrer not allowed, billing off). The map then renders a grey
    // error panel — hide it and fall back to the plain box instead.
    window.gm_authFailure = () => {
      console.warn("[Landed] Google Maps rejected NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — showing the plain map box.");
      if (!cancelled) setFailed(true);
    };

    (async () => {
      try {
        await loadGoogleMaps();
        const [{ Map }, { AdvancedMarkerElement }, { PlaceAutocompleteElement, Place }] = await Promise.all([
          google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
          google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
          google.maps.importLibrary("places") as Promise<google.maps.PlacesLibrary>,
        ]);
        if (cancelled || !mapRef.current || !searchRef.current) return;

        // A saved plan may have set the location while the script was
        // downloading; otherwise start wide until the device location (or
        // a search) arrives.
        const start = locationRef.current;
        const map = new Map(mapRef.current, {
          center: start ? { lat: start.lat, lng: start.lng } : WIDE_VIEW.center,
          zoom: start ? 14 : WIDE_VIEW.zoom,
          mapId: MAP_ID,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        mapInstanceRef.current = map;
        const marker = new AdvancedMarkerElement({ map: null });
        markerRef.current = marker;

        // The search box is recreated (rather than cleared) on reset — the
        // widget doesn't expose a way to empty its text.
        const mountAutocomplete = () => {
          const ac = new PlaceAutocompleteElement({});
          ac.style.width = "100%";
          // The widget follows the OS dark mode by default; the app is
          // light-only, so pin it to light.
          ac.style.colorScheme = "light";
          searchRef.current?.appendChild(ac);
          autocomplete = ac;
          ac.addEventListener("gmp-select", onSelect);
        };

        const onSelect = async (event: Event) => {
          try {
            const { placePrediction } = event as google.maps.places.PlacePredictionSelectEvent;
            const place = placePrediction.toPlace();
            await place.fetchFields({ fields: ["displayName", "location", "viewport", "addressComponents"] });
            if (place.viewport) map.fitBounds(place.viewport);
            else if (place.location) {
              map.setCenter(place.location);
              map.setZoom(16);
            }
            marker.position = place.location ?? null;
            marker.map = place.location ? map : null;
            if (place.location) {
              const point = { lat: place.location.lat(), lng: place.location.lng() };
              onPlaceSelectRef.current?.(describePlace(point, place.addressComponents, place.displayName || ""), "search");
            }
          } catch (err) {
            console.warn("[Landed] couldn't load the selected place", err);
          }
        };

        // Centre on the device, and name the spot from the nearest place's
        // address (reverse geocoding would need the separate Geocoding
        // API; this uses Places, which the key already has).
        const centreOnDevice = async (point: LatLng, source: "device-button" | "device-auto") => {
          map.setCenter(point);
          map.setZoom(14);
          marker.position = point;
          marker.map = map;
          if (autocomplete) autocomplete.locationBias = { center: point, radius: 20000 };
          let described: PlanLocation = { ...point, name: "your area", label: "Your location" };
          try {
            const { places } = await Place.searchNearby({
              fields: ["addressComponents"],
              locationRestriction: { center: point, radius: 1000 },
              maxResultCount: 1,
              rankPreference: "DISTANCE",
            });
            if (places[0]?.addressComponents?.length) described = describePlace(point, places[0].addressComponents, "your area");
          } catch (err) {
            console.warn("[Landed] couldn't name the current location", err);
          }
          if (!cancelled) onPlaceSelectRef.current?.(described, source);
        };

        // Apply the device location unless a place was already chosen
        // meanwhile (a search, or a saved plan loading).
        const applyDeviceLocation = async () => {
          const point = await deviceLocation;
          if (cancelled || !point || locationRef.current) return;
          await centreOnDevice(point, "device-auto");
        };

        mountAutocomplete();
        applyDeviceLocation();
        // The button asks again every time — if permission was refused
        // earlier the browser answers straight away without a prompt.
        locateRef.current = async () => {
          const point = await getDeviceLocation();
          if (cancelled || !point) return false;
          await centreOnDevice(point, "device-button");
          return true;
        };
        setMapReady(true);
        resetRef.current = () => {
          marker.map = null;
          autocomplete?.remove();
          mountAutocomplete();
          map.setCenter(WIDE_VIEW.center);
          map.setZoom(WIDE_VIEW.zoom);
          // Permission is remembered, so this doesn't prompt again.
          deviceLocation = getDeviceLocation();
          applyDeviceLocation();
        };
      } catch (err) {
        console.warn("[Landed] Google Maps unavailable — showing the plain map box.", err);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      autocomplete?.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      resetRef.current = null;
      locateRef.current = null;
    };
  }, []);

  return (
    <div className={className} style={{ ...style, position: "relative", overflow: "hidden" }}>
      <div ref={mapRef} style={{ position: "absolute", inset: 0, visibility: failed ? "hidden" : "visible" }} />
      <div
        ref={searchRef}
        style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 1, display: failed ? "none" : "block" }}
      />
      {mapReady && !failed && (
        <div
          // bottom: 36 keeps it clear of Google's logo and attribution
          // along the map's bottom edge, which must stay visible.
          style={{ position: "absolute", left: 12, right: 12, bottom: 36, zIndex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, pointerEvents: "none" }}
        >
          {locateNote && (
            <span
              role="status"
              className="text-[12px] leading-snug"
              style={{ background: "#FFFFFF", color: "#767766", borderRadius: 12, padding: "8px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", pointerEvents: "auto" }}
            >
              {locateNote}
            </span>
          )}
          <button
            onClick={handleLocate}
            disabled={locating}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "inherit",
              color: "#111111",
              background: "#FFFFFF",
              border: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              cursor: locating ? "default" : "pointer",
              opacity: locating ? 0.7 : 1,
              pointerEvents: "auto",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2" fill="#111111" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            {locating ? "Finding you…" : "Use my location"}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TimeKey, VibeKey, BudgetKey } from "./lib/constants";
import { TIME_OPTIONS, VIBE_OPTIONS, BUDGET_OPTIONS, CTA_GRADIENT } from "./lib/constants";
import type { CategoryKey, CategoryOption, Catalog } from "./lib/categoryOptions";

// /api/plan's results: per timeframe, per category.
type LiveResults = Partial<Record<TimeKey, Partial<Catalog>>>;

// For a saved plan without its search results: its own venues, as the
// only option in each category, for every timeframe.
function resultsFromSavedItems(items: Record<string, SavedItem>): LiveResults {
  const byCat: Partial<Catalog> = {};
  for (const [cat, item] of Object.entries(items)) {
    if (!item.id || !item.address || !item.meta) continue; // very old saves: display fields only
    byCat[cat as CategoryKey] = [
      {
        id: item.id,
        tag: item.tag,
        tagBg: item.tagBg,
        title: item.title,
        price: item.price,
        unit: item.unit,
        address: item.address,
        phone: item.phone ?? "",
        vibes: (item.vibes ?? []) as VibeKey[],
        meta: item.meta,
        hasApiBooking: item.hasApiBooking,
      },
    ];
  }
  return { now: byCat, tonight: byCat, tomorrow: byCat };
}
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_OPTIONS, computePicks, mergeCatalog, optionsForBudget } from "./lib/categoryOptions";
import { mapsUrl, ticketSearchUrl, bookingSearchUrl } from "./lib/urls";
import { telHref } from "./lib/format";
import { PinIcon, PhoneIcon, PhotoIcon } from "./components/icons";
import { QuickDropdown } from "./components/QuickDropdown";
import { PlanItemCard } from "./components/PlanItemCard";
import { SectionHeading } from "./components/SectionHeading";
import { LiveMap } from "./components/LiveMap";
import { LoadingBar } from "./components/LoadingBar";
import { getBooking, saveBooking, newBookingId } from "./lib/bookingsStore";
import type { SavedItem, SavedLiveResults } from "./lib/bookingsStore";
import type { PlanLocation } from "./lib/geo";
import { DEFAULT_LOCATION, isNearGalway } from "./lib/geo";

const WHEN_MENU = (["now", "tonight", "tomorrow"] as TimeKey[]).map(
  (k) => TIME_OPTIONS.find((o) => o.key === k)!
);
const VIBE_MENU = (["nightout", "family", "date", "solo"] as VibeKey[]).map(
  (k) => VIBE_OPTIONS.find((o) => o.key === k)!
);
const BUDGET_MENU = (["low", "modest", "luxury"] as BudgetKey[]).map(
  (k) => BUDGET_OPTIONS.find((o) => o.key === k)!
);

const VIBE_PHRASES: Record<VibeKey, string> = {
  nightout: "your night out",
  date: "your date night",
  family: "your family day out",
  solo: "your solo time",
};
const TIME_PHRASES: Record<TimeKey, string> = {
  now: "now",
  tonight: "tonight",
  tomorrow: "tomorrow",
};

const NOISE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>";
const NOISE_URL = "data:image/svg+xml," + encodeURIComponent(NOISE_SVG);
const BAR_TIMES = ["6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM"];
const RESTAURANT_TIMES = ["6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM"];
const ARRIVAL_TIMES = ["Before 3 PM", "3–6 PM", "6–9 PM", "9 PM–12 AM", "After midnight"];

export default function Home() {
  const [mode, setMode] = useState<"search" | "explore">("search");
  const [radius, setRadius] = useState(5);
  const [time, setTime] = useState<TimeKey>("now");
  const [vibe, setVibe] = useState<VibeKey>("nightout");
  const [budget, setBudget] = useState<BudgetKey>("low");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingsConfirmed, setBookingsConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [barTime, setBarTime] = useState("7:30 PM");
  const [restaurantTime, setRestaurantTime] = useState("7:00 PM");
  const [arrivalTime, setArrivalTime] = useState("6–9 PM");

  // Which option is currently picked per category, and which category's
  // runner-up list (if any) is expanded below its card.
  const [picks, setPicks] = useState<Record<CategoryKey, string>>(() =>
    computePicks("nightout", "low")
  );
  const [removedCategories, setRemovedCategories] = useState<CategoryKey[]>([]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [openSwap, setOpenSwap] = useState<CategoryKey | null>(null);
  const [openMenu, setOpenMenu] = useState<"when" | "vibe" | "budget" | null>(null);

  // Where the plan is — Galway by default, or wherever the map search
  // moved it. The static catalog only covers Galway, so it's only used as
  // a fallback near there; elsewhere the plan is live results only.
  const [location, setLocation] = useState<PlanLocation>(DEFAULT_LOCATION);
  // Nothing below the map (Your Plan, Explore, the booking sheet's list)
  // appears until a location has actually been chosen — searched on the
  // map, from the device location, or carried in by a saved plan.
  const [locationChosen, setLocationChosen] = useState(false);
  // Bumped by + (new enquiry) to clear the map's search box and marker.
  const [mapResetSignal, setMapResetSignal] = useState(0);
  const staticFallback = isNearGalway(location);

  // Live venues from /api/plan (Claude web search + Google Places), for all
  // three timeframes at once — one search covers Now, Tonight and
  // Tomorrow, so switching When is instant. Near Galway, any category the
  // live search didn't return keeps the static catalog — see mergeCatalog.
  const [liveOptions, setLiveOptions] = useState<LiveResults | null>(null);
  const catalog = useMemo(
    () => mergeCatalog(liveOptions?.[time] ?? null, staticFallback),
    [liveOptions, time, staticFallback]
  );

  // Why the last live search came back with nothing (away from Galway,
  // where there's no static plan to fall back on), if it did.
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  // Whether a live search is in flight (anywhere, including near Galway
  // where the built-in venues show meanwhile), and when it started — the
  // loading bar works its progress out from that, so it doesn't restart
  // when the Search tab is left (for Explore) and shown again. The search
  // itself runs at page level and carries on regardless of the tab; only
  // a new place/vibe or + (new enquiry) replaces it.
  const [liveLoading, setLiveLoading] = useState(false);
  const [searchStartedAt, setSearchStartedAt] = useState(0);

  // Every option seen this session, by id — so a pick keeps resolving even
  // after the live catalog it came from is replaced (e.g. a swapped live
  // venue, then a When change), or when a saved plan points at the static
  // catalog while live results are showing. Loaded plans add their saved
  // venues here too (see rememberSavedItems).
  const knownOptionsRef = useRef(new Map<string, CategoryOption>());
  function findOption(cat: CategoryKey, id: string): CategoryOption | undefined {
    return (
      catalog[cat].find((o) => o.id === id) ||
      knownOptionsRef.current.get(id) ||
      CATEGORY_OPTIONS[cat].find((o) => o.id === id) ||
      // Nothing known by that id — fall back to today's best fit, if the
      // category has anything at all.
      catalog[cat].find((o) => o.id === computePicks(vibe, budget, catalog)[cat])
    );
  }
  // The categories actually showing in Your Plan: not removed, and with a
  // venue to show (away from Galway a category can be empty).
  const visibleCategories = CATEGORY_ORDER.filter((cat) => !removedCategories.includes(cat) && findOption(cat, picks[cat]));
  // Away from Galway, when this timeframe has nothing to show: say why.
  const emptyMessage =
    !staticFallback && !liveLoading && locationChosen && visibleCategories.length === 0
      ? liveStatus || `Couldn't find live places near ${location.name} ${TIME_PHRASES[time]}.`
      : null;

  // Saved plans store each venue in full, so a live venue from an earlier
  // session reloads exactly rather than falling back to today's best pick.
  function rememberSavedItems(items: Record<string, SavedItem>) {
    Object.values(items).forEach((item) => {
      if (!item.id || !item.address || !item.meta) return; // older saves only have display fields
      knownOptionsRef.current.set(item.id, {
        id: item.id,
        tag: item.tag,
        tagBg: item.tagBg,
        title: item.title,
        price: item.price,
        unit: item.unit,
        address: item.address,
        phone: item.phone ?? "",
        vibes: (item.vibes ?? []) as VibeKey[],
        meta: item.meta,
        hasApiBooking: item.hasApiBooking,
      });
    });
  }

  // True once picks came from somewhere other than the auto-pick logic (a
  // swap, or a loaded draft) — live results arriving after
  // that must not overwrite them. Changing Vibe, Budget, or the location
  // re-picks everything anyway, so it resets this.
  const manualPicksRef = useRef(false);

  // Whether the person has actually done something with this enquiry —
  // searched a place, used "Use my location", changed When/Vibe/Budget,
  // swapped or removed a venue, or opened a saved plan. Only then is the
  // plan auto-saved as a draft, so simply opening the app (which finds
  // your location on its own) doesn't leave a draft behind every time.
  const engagedRef = useRef(false);

  // Live results already fetched this visit, by place (~100 m) and vibe,
  // so going back to a place/vibe — or opening a saved plan that carries
  // its results — never searches again.
  const resultsCacheRef = useRef(new Map<string, LiveResults>());
  const resultsKey = (p: { lat: number; lng: number }, v: VibeKey) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}|${v}`;

  // Opening a saved plan (?load=…): the plan brings its own place, so the
  // map mustn't jump to the device location on its own — that would
  // start a fresh search where the person happens to be standing. Read
  // straight from the URL on the first client render, because the map
  // asks for the device location as soon as it mounts.
  const openingSavedPlanRef = useRef(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("load")
  );

  // Vibe and Budget re-run the closest-match-preferring-vibe pick for every
  // category, so Your Plan actually reflects the answer — this replaces any
  // manual swaps with the new best fit. Done here in the handlers rather
  // than in an effect on [vibe, budget], because an effect also fired when
  // a saved plan set vibe/budget, and overwrote its picks.
  function selectVibe(next: VibeKey) {
    engagedRef.current = true;
    setVibe(next);
    manualPicksRef.current = false;
    setPicks(computePicks(next, budget, catalog));
  }
  function selectBudget(next: BudgetKey) {
    engagedRef.current = true;
    setBudget(next);
    manualPicksRef.current = false;
    setPicks(computePicks(vibe, next, catalog));
  }
  // When switches to that timeframe's results, which are already here
  // from the same search — no new request.
  function selectTime(next: TimeKey) {
    engagedRef.current = true;
    setTime(next);
    manualPicksRef.current = false;
    setPicks(computePicks(vibe, budget, mergeCatalog(liveOptions?.[next] ?? null, staticFallback)));
  }
  // The map's search box moved the plan. The previous live results were
  // for the old place, so drop them; near Galway the static catalog shows
  // meanwhile, elsewhere the plan waits for live results.
  // Only ever called by a person's action (a search, or the "Use my
  // location" button) — the automatic location on opening just moves the
  // map — so this is where a search can start.
  function selectLocation(next: PlanLocation) {
    engagedRef.current = true;
    setLocationChosen(true);
    setLocation(next);
    setLiveOptions(null);
    manualPicksRef.current = false;
    setPicks(computePicks(vibe, budget, mergeCatalog(null, isNearGalway(next))));
  }

  // Ask /api/plan for live venues whenever Vibe or the location changes.
  // One search returns Now, Tonight and Tomorrow together, and Budget is
  // applied client-side, so neither When nor Budget triggers a search.
  // Near Galway the static catalog stays on screen until then, and remains
  // the fallback if the call fails or returns nothing. The server caches
  // identical requests for 30 minutes.
  const budgetRef = useRef(budget);
  budgetRef.current = budget;
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    // Nothing is shown until a location is chosen, so don't spend a live
    // search (or the user's allowance) on the default before then.
    if (!locationChosen) return;
    const useStatic = isNearGalway(location);
    const cacheKey = resultsKey(location, vibe);
    const cached = resultsCacheRef.current.get(cacheKey);
    if (cached) {
      // Already have results for this place and vibe — no new search.
      setLiveStatus(null);
      setLiveLoading(false);
      setLiveOptions(cached);
      if (!manualPicksRef.current) {
        setPicks(computePicks(vibe, budgetRef.current, mergeCatalog(cached[timeRef.current] ?? null, useStatic)));
      }
      return;
    }
    const controller = new AbortController();
    setLiveStatus(null);
    setLiveLoading(true);
    setSearchStartedAt(Date.now());
    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: location.label, lat: location.lat, lng: location.lng, vibe }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { options?: LiveResults; source?: string; warnings?: string[] }) => {
        if (data.warnings?.length) console.warn("[Landed] live search:", data.warnings.join(" "));
        const live = data.source === "live" && data.options ? data.options : null;
        if (live) {
          Object.values(live).forEach((byCat) =>
            Object.values(byCat ?? {}).forEach((opts) => opts?.forEach((o) => knownOptionsRef.current.set(o.id, o)))
          );
          resultsCacheRef.current.set(cacheKey, live);
        }
        setLiveLoading(false);
        setLiveOptions(live);
        setLiveStatus(live ? null : data.warnings?.[0] || null);
        if (!manualPicksRef.current) {
          setPicks(computePicks(vibe, budgetRef.current, mergeCatalog(live?.[timeRef.current] ?? null, useStatic)));
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn("[Landed] live search unavailable.", err);
        setLiveLoading(false);
        setLiveOptions(null);
        setLiveStatus(null);
        // Keep the cards consistent with the swap sheet, which is now
        // back on the fallback catalog — unless the user chose these picks.
        if (!manualPicksRef.current) setPicks(computePicks(vibe, budgetRef.current, mergeCatalog(null, useStatic)));
      });
    return () => controller.abort();
  }, [vibe, location, locationChosen]);

  // Until a location is chosen, the page stops at the map: Your Plan and
  // Explore aren't rendered and the page can't scroll, so the first step
  // is always picking a place. (The overflow lock is on <html>, separate
  // from the bottom sheets' lock on <body>.)
  useEffect(() => {
    if (locationChosen) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      root.style.overflow = prev;
    };
  }, [locationChosen]);

  useEffect(() => {
    if (!openSwap && !bookingOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openSwap, bookingOpen]);

  // Drag-to-close for the two bottom sheets: the handle bar area tracks
  // vertical drag, the sheet follows it 1:1, and releasing past a threshold
  // closes it — otherwise it springs back to fully open.
  const [swapDragY, setSwapDragY] = useState(0);
  const [swapDragging, setSwapDragging] = useState(false);
  const swapStartY = useRef(0);
  function swapHandleDown(e: React.PointerEvent) {
    setSwapDragging(true);
    swapStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function swapHandleMove(e: React.PointerEvent) {
    if (!swapDragging) return;
    setSwapDragY(Math.max(0, e.clientY - swapStartY.current));
  }
  function swapHandleUp() {
    setSwapDragging(false);
    if (swapDragY > 110) {
      setOpenSwap(null);
    }
    setSwapDragY(0);
  }

  const [bookingDragY, setBookingDragY] = useState(0);
  const [bookingDragging, setBookingDragging] = useState(false);
  const bookingStartY = useRef(0);
  function bookingHandleDown(e: React.PointerEvent) {
    setBookingDragging(true);
    bookingStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function bookingHandleMove(e: React.PointerEvent) {
    if (!bookingDragging) return;
    setBookingDragY(Math.max(0, e.clientY - bookingStartY.current));
  }
  function bookingHandleUp() {
    setBookingDragging(false);
    if (bookingDragY > 110) {
      setBookingOpen(false);
    }
    setBookingDragY(0);
  }

  const planRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const draftIdRef = useRef<string | null>(null);
  const modeRef = useRef(mode);
  const baseAngleRef = useRef(180);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Animates the background gradient's angle, color-stop positions, and
  // opacity continuously, using several sine waves at unrelated speeds
  // layered together — that combination drifts and settles in a way that
  // never visibly repeats or snaps back, unlike a simple looping CSS
  // keyframe animation would. Mutates the DOM directly via the ref rather
  // than React state so it stays smooth at animation-frame rate.
  //
  // The gradient's base angle eases toward 180deg in Search mode (white
  // top, green bottom) or 0deg in Explore mode (flipped) — a 180deg swing
  // in a linear-gradient reverses which end each colour sits at, so easing
  // toward that target each frame gives a smooth rotating swap instead of
  // an instant snap, and it naturally reverses again on toggling back.
  useEffect(() => {
    let raf: number;
    function tick() {
      const el = gradientRef.current;
      if (el) {
        const targetBase = modeRef.current === "explore" ? 0 : 180;
        baseAngleRef.current += (targetBase - baseAngleRef.current) * 0.05;
        const t = Date.now() / 1000;
        const angle = baseAngleRef.current + Math.sin(t * 0.13) * 30 + Math.sin(t * 0.037) * 20;
        const stop1 = 40 + Math.sin(t * 0.075) * 15;
        const stop2 = 82 + Math.sin(t * 0.055 + 1.5) * 12;
        const fade = 0.82 + Math.sin(t * 0.095) * 0.18;
        el.style.background = `linear-gradient(${angle}deg,#FFFFFF 0%,#F4F3C6 ${stop1}%,#DEEB3A ${stop2}%)`;
        el.style.opacity = String(fade);
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Custom snap: section 1 catches firmly from a fair distance (like the
  // old mandatory behavior), but section 2 only nudges into place when the
  // scroll already settled very close to its top — everywhere else in its
  // (long) content stays completely free. A single CSS scroll-snap-type
  // can't give two different sections two different catch radii, so this
  // replaces it entirely.
  useEffect(() => {
    let timeout: number;
    function settle() {
      const s2 = planRef.current;
      if (!s2) return;
      const y = window.scrollY;
      const section1Target = 0;
      const section2Target = s2.getBoundingClientRect().top + y;

      const FIRM = 170;
      const LOOSE = 90;

      let target: number | null = null;
      if (Math.abs(y - section1Target) < FIRM) target = section1Target;
      else if (Math.abs(y - section2Target) < LOOSE) target = section2Target;

      if (target !== null && Math.abs(target - y) > 1) {
        window.scrollTo({ top: target, behavior: "smooth" });
      }
    }
    function onScroll() {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(settle, 140);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timeout);
    };
  }, []);

  // Only promise a stay if one is in the plan (away from Galway the live
  // search may not have found any) — or one may still be on its way.
  const hasStay = visibleCategories.includes("stay") || (!removedCategories.includes("stay") && liveLoading);
  const planSummary = `Here's ${VIBE_PHRASES[vibe]} in ${location.name} ${TIME_PHRASES[time]}${hasStay ? " with a stay to round it off" : ""}.`;

  // If arriving via a "?load=<id>" link (from the Bookings page), pull that
  // saved booking/draft back into the editor instead of starting blank —
  // from the account when signed in, this device when not.
  useEffect(() => {
    const loadId = new URLSearchParams(window.location.search).get("load");
    if (!loadId) return;
    window.history.replaceState(null, "", "/");
    getBooking(loadId)
      .then((found) => {
        if (!found) return;
        draftIdRef.current = found.id;
        engagedRef.current = true;
        // Reopening a plan never searches: it comes back from what was
        // found before. With its saved search results that's everything
        // (swaps and all three timeframes); for plans saved without them
        // (older plans, or before the live_results column existed) it's
        // rebuilt from the venues saved in the plan itself.
        const restored: LiveResults = (found.liveResults as LiveResults | undefined) ?? resultsFromSavedItems(found.items);
        Object.values(restored).forEach((byCat) =>
          Object.values(byCat ?? {}).forEach((opts) => opts?.forEach((o) => knownOptionsRef.current.set(o.id, o)))
        );
        resultsCacheRef.current.set(resultsKey(found.location ?? DEFAULT_LOCATION, found.vibe as VibeKey), restored);
        setLocationChosen(true);
        manualPicksRef.current = true;
        rememberSavedItems(found.items);
        if (found.location) {
          setLocation(found.location);
          setLiveOptions(null);
        }
        setVibe(found.vibe as VibeKey);
        setTime(found.time as TimeKey);
        setBudget(found.budget as BudgetKey);
        setPicks(found.picks as Record<CategoryKey, string>);
        setRemovedCategories((found.removedCategories || []) as CategoryKey[]);
        setBookingsConfirmed(!!found.confirmed);
      })
      .catch(() => {
        // ignore — just falls back to a blank booking
      })
      .finally(() => {
        openingSavedPlanRef.current = false;
      });
  }, []);

  // Saves the plan on screen — to the account when signed in, this device
  // when not (and to this device as a fallback if the account save fails).
  // The same entry every time for this enquiry (draftIdRef), so repeated
  // saves update it. Stores the full venues and the search results, so
  // reopening it restores it exactly without searching again.
  function savePlan(overrides: { confirmed?: boolean } = {}) {
    const items: Record<string, SavedItem> = {};
    CATEGORY_ORDER.forEach((cat) => {
      if (removedCategories.includes(cat)) return;
      const opt = findOption(cat, picks[cat]);
      if (opt) items[cat] = { ...opt, hasApiBooking: opt.hasApiBooking || false };
    });
    if (!draftIdRef.current) draftIdRef.current = newBookingId();
    saveBooking({
      id: draftIdRef.current,
      createdAt: new Date().toISOString(),
      planSummary,
      picks,
      items,
      vibe,
      time,
      budget,
      removedCategories,
      confirmed: overrides.confirmed ?? bookingsConfirmed,
      location,
      liveResults: (liveOptions ?? undefined) as SavedLiveResults | undefined,
    })
      .then(({ error }) => {
        if (error) console.warn("[Landed] plan saved on this device instead of your account:", error);
      })
      .catch((err) => console.error("[Landed] couldn't save plan", err));
  }

  // Handles the nav bar's "+" button when already on this page: saves
  // whatever's currently on screen (updating the loaded draft in place if
  // we're editing one, otherwise adding a new entry), then resets
  // everything for an entirely new booking. Saved to the Supabase account
  // when signed in, or this device when not — see lib/bookingsStore.ts.
  useEffect(() => {
    function handleNewBooking() {
      // Only save a plan that has something in it — before a location is
      // chosen (or where nothing was found) there's nothing to keep.
      if (locationChosen && visibleCategories.length > 0) savePlan();
      startNewEnquiry();
    }

    // A brand-new enquiry: everything back to the defaults, including the
    // location, so the page locks at the map again until a place is chosen
    // (the lock effect scrolls back to the top).
    function startNewEnquiry() {
      draftIdRef.current = null;
      engagedRef.current = false;
      setVibe("nightout");
      setTime("now");
      setBudget("low");
      setRemovedCategories([]);
      setBookingsConfirmed(false);
      manualPicksRef.current = false;
      setLocation(DEFAULT_LOCATION);
      setLocationChosen(false);
      setLiveOptions(null);
      setLiveStatus(null);
      setLiveLoading(false);
      setMode("search");
      setPicks(computePicks("nightout", "low", mergeCatalog(null)));
      setMapResetSignal((n) => n + 1);
      if (window.location.search) {
        window.history.replaceState(null, "", "/");
      }
    }
    window.addEventListener("landed:new-booking", handleNewBooking);
    return () => window.removeEventListener("landed:new-booking", handleNewBooking);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSummary, picks, vibe, time, budget, removedCategories, bookingsConfirmed, catalog, location, locationChosen, visibleCategories, liveOptions]);

  // Auto-save: once the person has done something with a plan that has
  // venues in it, keep it saved as a draft (or as their confirmed booking,
  // once confirmed) — debounced, and always the same entry for this
  // enquiry, so tweaking it updates the draft rather than adding more.
  useEffect(() => {
    if (!engagedRef.current || !locationChosen || liveLoading || visibleCategories.length === 0) return;
    const t = window.setTimeout(() => savePlan(), 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, vibe, time, budget, removedCategories, location, liveOptions, bookingsConfirmed, liveLoading, locationChosen]);

  function handleBookPlan() {
    setBookingOpen(true);
  }

  // From the empty booking sheet: back up to the map and open its search.
  function goToLocationSearch() {
    setBookingOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      (document.querySelector("gmp-place-autocomplete") as HTMLElement | null)?.focus();
    }, 450);
  }
  const bookableCategories = locationChosen ? visibleCategories : [];

  return (
    // The 21px here (and on the content column further down) must match
    // NavBar.tsx's and the Search/Explore toggle's own left/right insets,
    // and the same 21px used in bookings/page.tsx and account/page.tsx —
    // see the longer comment on the toggle below for why.
    // pb-32 only once there's something below the map — before a location
    // is chosen the page must be exactly one screen tall, so there's
    // nothing to scroll (iOS doesn't reliably honour overflow: hidden).
    <main className={`w-full min-h-screen bg-white px-[21px] ${locationChosen ? "pb-32" : ""} flex flex-col gap-12`}>
      <div
        style={{
          height: "100dvh",
          // Clears the nav bar (92px + the home-indicator area it pads
          // itself with) and leaves a gap above it: 28px on phones with a
          // home indicator as well as without.
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
          width: "100vw",
          marginLeft: "calc(50% - 50vw)",
          marginRight: "calc(50% - 50vw)",
          position: "relative",
        }}
        className="flex flex-col"
      >
        <div
          ref={gradientRef}
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg,#FFFFFF 0%,#F4F3C6 45%,#DEEB3A 100%)",
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${NOISE_URL}")`,
            backgroundRepeat: "repeat",
            backgroundSize: "100px 100px",
            opacity: 0.65,
            mixBlendMode: "overlay",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
        <div
          className="w-full px-[21px] flex-1 flex flex-col gap-5"
          style={{ position: "relative", zIndex: 2, paddingTop: 90 }}
        >
          {/* Replace with your real logo asset. Plain <img> on purpose: a 30px
              local icon gains nothing from next/image's optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landed-icon.png" alt="Landed" className="w-[30px] h-auto" />
          <SectionHeading hideArrow>Where would you like to L↘nd?</SectionHeading>

          <LiveMap
            className="w-full rounded-2xl bg-[#E6E0D0] flex items-center justify-center text-sm text-black/40"
            style={{ flex: "1 1 auto", minHeight: 0 }}
            location={locationChosen ? location : undefined}
            onPlaceSelect={selectLocation}
            autoLocateAllowed={() => !openingSavedPlanRef.current}
            resetSignal={mapResetSignal}
          />
        </div>
      </div>

      {locationChosen && mode === "search" && (
      // minHeight: a full screen minus <main>'s pb-32 (8rem) below it, so
      // with few or no results the furthest you can scroll puts the
      // section's top exactly at the top of the screen — no further.
      <div ref={planRef} className="flex flex-col" style={{ paddingTop: "calc(5vh + 60px)", minHeight: "calc(100dvh - 8rem)" }}>
        <div className="flex items-center gap-2.5" style={{ marginBottom: 20 }}>
          <span className="font-semibold text-[18px] text-ink leading-none">Your Plan ↘</span>
        </div>

        {/* This summary's minHeight/marginBottom, and the equivalent pair
            on the Explore summary below (search "Searching for plans
            within"), started out equal so the first card in Your Plan and
            the first card in Explore would land at exactly the same
            height when toggling between them. They're now deliberately
            different (this one reserves one more line) because equal
            reservation left visibly more dead space under Your Plan's
            usually-shorter text. That was a conscious trade-off, made
            after several rounds of back-and-forth — accept slightly less
            precise card alignment for better-proportioned spacing in each
            section. If exact alignment matters again, make both minHeight
            values equal (they were 250/250, and separately 200/200,
            before this). */}
        <span className="font-semibold text-[40px] leading-tight text-ink" style={{ marginBottom: 16, minHeight: 300, display: "block" }}>
          {planSummary}
        </span>

        <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
          <QuickDropdown
            label="When"
            menu={WHEN_MENU}
            value={time}
            isOpen={openMenu === "when"}
            onToggle={() => setOpenMenu(openMenu === "when" ? null : "when")}
            onSelect={(key) => {
              selectTime(key);
              setOpenMenu(null);
            }}
          />
          <QuickDropdown
            label="Vibe"
            menu={VIBE_MENU}
            value={vibe}
            isOpen={openMenu === "vibe"}
            onToggle={() => setOpenMenu(openMenu === "vibe" ? null : "vibe")}
            onSelect={(key) => {
              selectVibe(key);
              setOpenMenu(null);
            }}
          />
          <QuickDropdown
            label="Budget"
            menu={BUDGET_MENU}
            value={budget}
            isOpen={openMenu === "budget"}
            onToggle={() => setOpenMenu(openMenu === "budget" ? null : "budget")}
            onSelect={(key) => {
              selectBudget(key);
              setOpenMenu(null);
            }}
          />
        </div>

        {/* Example items — swap this for real, AI-sourced +
            Places-verified results from app/api/plan/route.ts */}
        <div className="flex flex-col gap-3.5">
          {/* While live results are being found: an animated bar (near
              Galway the built-in venues show underneath meanwhile). After:
              away from Galway, say why if nothing came back. */}
          {liveLoading ? (
            <LoadingBar startedAt={searchStartedAt} label={`Finding live places near ${location.name}…`} />
          ) : (
            emptyMessage && (
              <span className="text-[13px] leading-snug" style={{ color: "#767676" }}>
                {emptyMessage}
              </span>
            )
          )}
          {visibleCategories
            .map((cat) => {
              const current = findOption(cat, picks[cat])!;
              return (
                <PlanItemCard
                  key={cat}
                  item={current}
                  area={location.name}
                  actionLabel="SWAP"
                  onAction={() => setOpenSwap(cat)}
                  onRemove={() => {
                    engagedRef.current = true;
                    setRemovedCategories((r) => [...r, cat]);
                  }}
                />
              );
            })}

          {(() => {
            const addable = CATEGORY_ORDER.filter((cat) => removedCategories.includes(cat));
            if (addable.length === 0) return null;
            return (
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowAddMenu((v) => !v)}
                  style={{ width: "100%", height: 70, borderRadius: 20, border: "2px dashed #B9B4A6", background: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}
                >
                  <span style={{ fontSize: 20, fontWeight: 700, color: "#767766", lineHeight: 1 }}>+</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#767766" }}>Add a category</span>
                </button>
                {showAddMenu && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "#FFFFFF", borderRadius: 16, boxShadow: "0 10px 28px rgba(0,0,0,0.16)", overflow: "hidden", zIndex: 20 }}>
                    {addable.map((cat, i) => (
                      <button
                        key={cat}
                        onClick={() => {
                          engagedRef.current = true;
                          setRemovedCategories((r) => r.filter((c) => c !== cat));
                          setShowAddMenu(false);
                        }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", background: "none", border: "none", borderBottom: i < addable.length - 1 ? "1px solid #EFEFEF" : "none", fontFamily: "inherit", fontWeight: 600, fontSize: 14, color: "#111111", cursor: "pointer" }}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <button
          onClick={handleBookPlan}
          className="w-full h-[60px] rounded-full flex items-center justify-between px-[22px]"
          style={{ background: bookingsConfirmed ? "#EAE7DF" : CTA_GRADIENT, marginTop: 24 }}
        >
          <span className="font-semibold text-[14px] text-ink">
            {bookingsConfirmed ? "✓ Plan confirmed" : "Book your plan"}
          </span>
          <span className="font-semibold text-[16px] leading-none text-ink">↘</span>
        </button>
      </div>
      )}

      {locationChosen && mode === "explore" && (
        <div ref={planRef} className="flex flex-col gap-3.5" style={{ paddingTop: "calc(5vh + 60px)", minHeight: "calc(100dvh - 8rem)" }}>
          <span className="font-semibold text-[18px] text-ink leading-none" style={{ marginBottom: 6, display: "block" }}>Explore plans↘</span>
          {/* See the matching comment on Your Plan's summary (the
              planSummary span above, in the search-mode block) — this
              minHeight is intentionally different from that one, not a
              leftover mismatch. */}
          <span className="font-semibold text-[40px] leading-tight text-ink" style={{ marginBottom: 16, minHeight: 250, display: "block" }}>
            Searching for plans within {radius}km of {location.label}
          </span>
          <div className="flex flex-col justify-center gap-2" style={{ marginBottom: 28, minHeight: 44 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="text-[12px]" style={{ color: "#767766" }}>Search radius</span>
              <span className="font-semibold text-[13px] text-ink">{radius} km</span>
            </div>
            <style>{`
              .landed-radius-slider {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 14px;
                border-radius: 999px;
                outline: none;
                cursor: pointer;
                background: linear-gradient(to right, #DEEB3A 0%, #EFF3A8 ${((radius - 1) / 24) * 100}%, #EAE7DF ${((radius - 1) / 24) * 100}%, #EAE7DF 100%);
              }
              .landed-radius-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 26px;
                height: 26px;
                border-radius: 50%;
                background: #DEEB3A;
                opacity: 0.85;
                border: none;
                cursor: pointer;
              }
              .landed-radius-slider::-moz-range-thumb {
                width: 26px;
                height: 26px;
                border-radius: 50%;
                background: #DEEB3A;
                opacity: 0.85;
                border: none;
                cursor: pointer;
              }
              .landed-radius-slider::-moz-range-track {
                height: 14px;
                border-radius: 999px;
                background: linear-gradient(to right, #DEEB3A 0%, #EFF3A8 ${((radius - 1) / 24) * 100}%, #EAE7DF ${((radius - 1) / 24) * 100}%, #EAE7DF 100%);
              }
            `}</style>
            <input
              type="range"
              className="landed-radius-slider"
              min={1}
              max={25}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
            />
          </div>
          {/* Plans other people have made nearby will be listed here once
              plans are shared between users; until then there are none. */}
          <span className="text-[13px] leading-snug" style={{ color: "#767676" }}>
            No plans in this area
          </span>
        </div>
      )}

      {/* Swap sheet — always mounted so the slide transition can run;
          hidden via opacity/transform/pointer-events when closed. */}
      <div
        className="fixed inset-0 flex items-end justify-center transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.45)",
          opacity: openSwap ? 1 : 0,
          pointerEvents: openSwap ? "auto" : "none",
          zIndex: 200,
        }}
        onClick={() => setOpenSwap(null)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded-t-[28px] flex flex-col"
          style={{
            background: "#FFFFFF",
            height: "92vh",
            maxHeight: "92vh",
            transform: openSwap ? `translateY(${swapDragY}px)` : "translateY(100%)",
            transition: swapDragging ? "none" : "transform 300ms",
          }}
        >
          <div
            onPointerDown={swapHandleDown}
            onPointerMove={swapHandleMove}
            onPointerUp={swapHandleUp}
            onPointerCancel={swapHandleUp}
            className="flex justify-center pt-3 pb-2"
            style={{ flexShrink: 0, touchAction: "none", cursor: swapDragging ? "grabbing" : "grab" }}
          >
            <div style={{ width: 40, height: 5, borderRadius: 999, background: "#D9D9D9" }} />
          </div>
          <div className="flex items-center justify-between px-5 pb-3" style={{ flexShrink: 0 }}>
            <span className="font-semibold text-[18px] text-ink">Other options</span>
            <button
              onClick={() => setOpenSwap(null)}
              aria-label="Close"
              className="font-semibold text-[16px] text-ink"
              style={{ background: "none", border: "none", padding: 8, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-5 pb-8 flex flex-col gap-4" style={{ flex: "1 1 auto", minHeight: 0 }}>
            {openSwap &&
              // Swaps come from the same budget tier as the plan: other
              // luxury options when Budget is Luxury, other low-cost ones
              // when it's Low.
              optionsForBudget(openSwap, budget, catalog)
                .filter((o) => o.id !== picks[openSwap])
                // The plan's pick plus up to 3 swaps.
                .slice(0, 3)
                .map((alt) => (
                  <div key={alt.id} style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={{ alignSelf: "flex-start", borderRadius: 999, padding: "6px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: alt.tagBg, color: "#111111" }}>
                      {alt.tag}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{alt.title}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <a href={mapsUrl(alt.title, location.name)} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                        <PinIcon />
                        <span style={{ fontSize: 11, color: "#767766" }}>{alt.address}</span>
                      </a>
                      <a href={telHref(alt.phone)} style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                        <PhoneIcon />
                        <span style={{ fontSize: 11, color: "#767766" }}>{alt.phone}</span>
                      </a>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {(alt.meta || []).map((m, i) => (
                        <span key={i} style={{ fontSize: 10, fontWeight: 600, borderRadius: 999, padding: "4px 10px", background: "#DFDACB", color: "#111111" }}>
                          {m}
                        </span>
                      ))}
                    </div>
                    <div style={{ height: 100, borderRadius: 12, background: alt.tagBg, border: "1px solid rgba(0,0,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <PhotoIcon kind="exterior" />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{alt.price}</span>
                        <span style={{ fontSize: 12, color: "#3E3E3A" }}>{alt.unit}</span>
                      </div>
                      <button
                        onClick={() => {
                          manualPicksRef.current = true;
                          engagedRef.current = true;
                          setPicks((p) => ({ ...p, [openSwap]: alt.id }));
                          setOpenSwap(null);
                        }}
                        style={{ borderRadius: 999, padding: "8px 16px", fontSize: 10, fontWeight: 700, border: "1.5px solid #B9B4A6", color: "#767676", background: "none", cursor: "pointer" }}
                      >
                        SELECT
                      </button>
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </div>

      {/* Booking sheet — lists every selected item with a category-specific
          action: reserve a time for the bar, ticket link for live, auto-
          booked status for the stay, and a maps link for parking. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
          opacity: bookingOpen ? 1 : 0,
          pointerEvents: bookingOpen ? "auto" : "none",
          transition: "opacity 300ms",
          zIndex: 200,
        }}
        onClick={() => setBookingOpen(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
                        borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            height: "92vh",
            maxHeight: "92vh",
            transform: bookingOpen ? `translateY(${bookingDragY}px)` : "translateY(100%)",
            transition: bookingDragging ? "none" : "transform 300ms",
          }}
        >
          <div
            onPointerDown={bookingHandleDown}
            onPointerMove={bookingHandleMove}
            onPointerUp={bookingHandleUp}
            onPointerCancel={bookingHandleUp}
            style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8, flexShrink: 0, touchAction: "none", cursor: bookingDragging ? "grabbing" : "grab" }}
          >
            <div style={{ width: 40, height: 5, borderRadius: 999, background: "#D9D9D9" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 20px 4px", flexShrink: 0 }}>
            <button onClick={() => setBookingOpen(false)} aria-label="Close" style={{ fontWeight: 600, fontSize: 18, color: "#111111", background: "none", border: "none", padding: 8, cursor: "pointer" }}>
              ✕
            </button>
          </div>
          <span style={{ padding: "0 20px 10px", fontSize: 18, fontWeight: 600, color: "#111111", flexShrink: 0 }}>Your bookings</span>
          <div style={{ overflowY: "auto", padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: 16, flex: "1 1 auto", minHeight: 0 }}>
            {bookableCategories.length === 0 && (
              <div style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 13, color: "#767766", lineHeight: 1.4 }}>
                  {locationChosen
                    ? emptyMessage
                      ? emptyMessage
                      : `Nothing to book near ${location.name} yet — try another place on the map.`
                    : "Search for a location on the map, and the places in your plan will appear here to book."}
                </span>
                <button
                  onClick={goToLocationSearch}
                  style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, border: "none", cursor: "pointer" }}
                >
                  Search a location ↖
                </button>
              </div>
            )}
            {bookableCategories
              .map((cat) => {
              const item = findOption(cat, picks[cat])!;
              return (
                <div key={cat} style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <span style={{ alignSelf: "flex-start", borderRadius: 999, padding: "6px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: item.tagBg, color: "#111111" }}>
                    {item.tag}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{item.title}</span>
                  <a href={telHref(item.phone)} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                    <PhoneIcon />
                    <span style={{ fontSize: 12, color: "#767766" }}>{item.phone}</span>
                  </a>

                  {cat === "stay" &&
                    (item.hasApiBooking ? (
                      bookingsConfirmed ? (
                        <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 700, background: "#DEEB3A", color: "#111111" }}>
                          ✓ Booked automatically — arriving {arrivalTime}
                        </span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#767766" }}>Arrival time</span>
                          <select
                            value={arrivalTime}
                            onChange={(e) => setArrivalTime(e.target.value)}
                            style={{ alignSelf: "flex-start", height: 40, borderRadius: 999, border: "1.5px solid #B9B4A6", background: "#FFFFFF", padding: "0 14px", fontSize: 13, fontWeight: 600, color: "#111111", fontFamily: "inherit" }}
                          >
                            {ARRIVAL_TIMES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    ) : (
                      <a
                        href={bookingSearchUrl(item.title, location.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, textDecoration: "none" }}
                      >
                        View & Book ↗
                      </a>
                    ))}

                  {cat === "restaurant" &&
                    (item.hasApiBooking ? (
                      bookingsConfirmed ? (
                        <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 700, background: "#DEEB3A", color: "#111111" }}>
                          ✓ Booked for {restaurantTime}
                        </span>
                      ) : (
                        <select
                          value={restaurantTime}
                          onChange={(e) => setRestaurantTime(e.target.value)}
                          style={{ alignSelf: "flex-start", height: 40, borderRadius: 999, border: "1.5px solid #B9B4A6", background: "#FFFFFF", padding: "0 14px", fontSize: 13, fontWeight: 600, color: "#111111", fontFamily: "inherit" }}
                        >
                          {RESTAURANT_TIMES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )
                    ) : (
                      <a
                        href={bookingSearchUrl(item.title, location.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, textDecoration: "none" }}
                      >
                        View & Book ↗
                      </a>
                    ))}

                  {cat === "bar" &&
                    (item.hasApiBooking ? (
                      bookingsConfirmed ? (
                        <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 700, background: "#DEEB3A", color: "#111111" }}>
                          ✓ Booked for {barTime}
                        </span>
                      ) : (
                        <select
                          value={barTime}
                          onChange={(e) => setBarTime(e.target.value)}
                          style={{ alignSelf: "flex-start", height: 40, borderRadius: 999, border: "1.5px solid #B9B4A6", background: "#FFFFFF", padding: "0 14px", fontSize: 13, fontWeight: 600, color: "#111111", fontFamily: "inherit" }}
                        >
                          {BAR_TIMES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )
                    ) : (
                      <a
                        href={bookingSearchUrl(item.title, location.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, textDecoration: "none" }}
                      >
                        View & Book ↗
                      </a>
                    ))}

                  {cat === "live" && (
                    <a
                      href={ticketSearchUrl(item.title, location.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, textDecoration: "none" }}
                    >
                      Get Tickets ↗
                    </a>
                  )}

                  {cat === "attractions" && (
                    <a
                      href={ticketSearchUrl(item.title, location.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, textDecoration: "none" }}
                    >
                      Get Tickets ↗
                    </a>
                  )}

                  {cat === "parking" && (
                    <a
                      href={mapsUrl(item.title, location.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ alignSelf: "flex-start", borderRadius: 999, padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#111111", background: CTA_GRADIENT, textDecoration: "none" }}
                    >
                      Get Directions ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          {bookableCategories.length > 0 && (
          <div style={{ padding: "12px 20px 20px", flexShrink: 0, borderTop: "1px solid #EFEFEF" }}>
            <span style={{ display: "block", fontSize: 12, color: "#767766", marginBottom: 12 }}>
              Anything with a live booking connection is booked automatically when you confirm — everything else opens a real booking page for you to finish there yourself.
            </span>
            <button
              onClick={() => {
                setConfirming(true);
                // Saved straight away as a confirmed booking (it appears
                // under "Your bookings"), updating this enquiry's draft.
                engagedRef.current = true;
                savePlan({ confirmed: true });
                window.setTimeout(() => {
                  setConfirming(false);
                  setBookingsConfirmed(true);
                }, 500);
              }}
              disabled={bookingsConfirmed || confirming}
              className="w-full h-[48px] rounded-full flex items-center justify-center"
              style={{ background: bookingsConfirmed ? "#EAE7DF" : CTA_GRADIENT, border: "none", cursor: bookingsConfirmed ? "default" : "pointer", opacity: confirming ? 0.7 : 1 }}
            >
              <span className="font-semibold text-[13px]" style={{ color: "#111111" }}>
                {bookingsConfirmed ? "✓ Bookings confirmed" : confirming ? "Confirming…" : "Confirm all your bookings"}
              </span>
            </button>
          </div>
          )}
        </div>
      </div>

      {/* Search/Explore toggle — fixed to the top so it's reachable from
          anywhere on the page, mirroring how the nav bar stays fixed to
          the bottom. Same left/right insets and safe-area-aware padding
          as the nav bar, just flipped to the top edge.

          That 21 (below) must match NavBar.tsx's own left/right, and both
          must match the `px-[21px]` edge padding used on every page's
          <main> — nothing enforces this automatically, so a change to one
          needs the same change everywhere else. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 21,
          right: 21,
          display: "flex",
          justifyContent: "center",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)",
          zIndex: 100,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: 4,
            height: 44,
            width: "100%",
            borderRadius: 999,
            background: "rgba(255,255,255,0.35)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            border: "1px solid rgba(255,255,255,0.5)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 4,
              bottom: 4,
              left: mode === "search" ? 4 : "50%",
              width: "calc(50% - 4px)",
              borderRadius: 999,
              background: "#FFFFFF",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              transition: "left 320ms cubic-bezier(0.4,0,0.2,1)",
            }}
          />
          <button
            onClick={() => setMode("search")}
            style={{
              position: "relative",
              zIndex: 1,
              flex: 1,
              height: "100%",
              borderRadius: 999,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span className="font-semibold text-[13px] text-ink">Search</span>
          </button>
          <button
            onClick={() => setMode("explore")}
            style={{
              position: "relative",
              zIndex: 1,
              flex: 1,
              height: "100%",
              borderRadius: 999,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span className="font-semibold text-[13px] text-ink">Explore</span>
          </button>
        </div>
      </div>
    </main>
  );
}

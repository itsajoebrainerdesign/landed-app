// Every outbound link in the app — maps, ticket search, booking search,
// and the Booking.com affiliate link for stays — funnels through here.
// `area` is the plan's location name (e.g. "St Albans"), added to searches
// so they find the right branch; it's left off when unknown.

const withArea = (name: string, area?: string) => (area ? `${name} ${area}` : name);

export function mapsUrl(name: string, area?: string) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(withArea(name, area));
}
// The venue's own website (from Google Places) when it has one, otherwise
// a Google search for booking / tickets.
export function ticketSearchUrl(name: string, area?: string, website?: string) {
  return safeWebsite(website) ?? "https://www.google.com/search?q=" + encodeURIComponent(withArea(name, area) + " tickets");
}
export function bookingSearchUrl(name: string, area?: string, website?: string) {
  return safeWebsite(website) ?? "https://www.google.com/search?q=" + encodeURIComponent(withArea(name, area) + " booking");
}

// A venue's own Google Maps page, where the person can tap Save. Google's
// venue id (in our option ids, "g-<category>-<placeId>") makes it the
// exact place rather than a name search.
export function placeMapsUrl(venue: { title: string; id?: string }, area?: string) {
  const placeId = venue.id?.match(/^g-[a-z]+-(.+)$/)?.[1];
  if (!placeId) return mapsUrl(venue.title, area);
  return mapsUrl(venue.title, area) + "&query_place_id=" + encodeURIComponent(placeId);
}

// Some venues list a platform's homepage (e.g. just "instagram.com")
// rather than their page on it — useless as a link.
const PLATFORM_HOSTS = ["instagram.com", "facebook.com", "tiktok.com", "twitter.com", "x.com", "linktr.ee", "google.com", "linkedin.com"];

// Only plain web links — never javascript: or other schemes.
function safeWebsite(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (PLATFORM_HOSTS.includes(host) && u.pathname.replace(/\/+$/, "") === "") return null;
    return u.href;
  } catch {
    return null;
  }
}

// ── Affiliate booking links ──────────────────────────────────────────────
// Stays open Booking.com with the hotel searched and the dates filled in.
// With NEXT_PUBLIC_BOOKING_AFFILIATE_ID set (your Booking.com Affiliate
// Partner ID, the "aid"), every link carries it and bookings earn
// commission; without it the links work the same, just untracked.
const BOOKING_AFFILIATE_ID = process.env.NEXT_PUBLIC_BOOKING_AFFILIATE_ID || "";
export const AFFILIATE_LINKS_ON = BOOKING_AFFILIATE_ID !== "";

// YYYY-MM-DD in the device's local time.
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "now"/"tonight" book tonight; "tomorrow" books tomorrow night. One night,
// 1 room, and the party size for the vibe (partyFor) — the person can
// change any of it on Booking.com.
//
// Booking.com's free-text search doesn't recognise hotel names (it falls
// back to its homepage), so a stay with a map position opens the results
// centred on it, closest first — the hotel is at or near the top when
// Booking.com sells it (Travelodge and Premier Inn don't; then it's the
// nearest alternatives). Older saved plans don't have the stay's
// position: those centre on the plan's own location (areaPos), or search
// the town by name, which Booking.com does understand.
// Who's going, by vibe: Family is 2 adults + 1 child, Solo is 1, and
// Date and Friends are 2 (a friends group varies — 2 is the default the
// person adjusts on the booking site).
const CHILD_AGE = 8;
export function partyFor(vibe?: string): { adults: number; children: number } {
  if (vibe === "family") return { adults: 2, children: 1 };
  if (vibe === "solo") return { adults: 1, children: 0 };
  return { adults: 2, children: 0 };
}

export function stayBookingUrl(
  stay: { title: string; lat?: number; lng?: number },
  area?: string,
  time: string = "tonight",
  vibe?: string,
  areaPos?: { lat?: number; lng?: number }
) {
  const checkinOffset = time === "tomorrow" ? 1 : 0;
  const params = new URLSearchParams();
  const hasPos = (p?: { lat?: number; lng?: number }): p is { lat: number; lng: number } =>
    typeof p?.lat === "number" && typeof p?.lng === "number" && !(p.lat === 0 && p.lng === 0);
  const pos = hasPos(stay) ? stay : hasPos(areaPos) ? areaPos : null;
  if (pos) {
    params.set("ss", pos === stay ? stay.title : area || stay.title);
    params.set("latitude", pos.lat.toFixed(6));
    params.set("longitude", pos.lng.toFixed(6));
    params.set("dest_type", "latlong");
    params.set("order", "distance_from_search");
  } else {
    params.set("ss", area || stay.title);
  }
  params.set("checkin", localDay(checkinOffset));
  params.set("checkout", localDay(checkinOffset + 1));
  const party = partyFor(vibe);
  params.set("group_adults", String(party.adults));
  params.set("no_rooms", "1");
  params.set("group_children", String(party.children));
  // Without an age Booking.com assumes a baby (0), which changes the rooms
  // and prices it shows — assume a school-age child instead.
  for (let i = 0; i < party.children; i++) params.append("age", String(CHILD_AGE));
  if (BOOKING_AFFILIATE_ID) {
    params.set("aid", BOOKING_AFFILIATE_ID);
    params.set("label", "landed-app"); // shows in your Booking.com reports
  }
  return "https://www.booking.com/searchresults.html?" + params.toString();
}

// The action button on a venue in a plan sheet (the booking sheet and a
// saved booking look the same): Booking.com for stays, tickets for
// attractions and live, directions for parking, and booking otherwise.
export function planItemLink(
  cat: string,
  item: { title: string; lat?: number; lng?: number; website?: string },
  area?: string,
  time?: string,
  vibe?: string,
  areaPos?: { lat?: number; lng?: number }
): { href: string; label: string; sponsored?: boolean } {
  if (cat === "stay") return { href: stayBookingUrl(item, area, time, vibe, areaPos), label: "Book ↗", sponsored: AFFILIATE_LINKS_ON };
  if (cat === "attractions" || cat === "live") return { href: ticketSearchUrl(item.title, area, item.website), label: "Get Tickets ↗" };
  if (cat === "parking") return { href: mapsUrl(item.title, area), label: "Get Directions ↗" };
  return { href: bookingSearchUrl(item.title, area, item.website), label: "Book ↗" };
}

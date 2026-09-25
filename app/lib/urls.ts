// Every outbound link in the app — maps, ticket search, booking search,
// and the Booking.com affiliate link for stays — funnels through here.
// `area` is the plan's location name (e.g. "St Albans"), added to searches
// so they find the right branch; it's left off when unknown.

const withArea = (name: string, area?: string) => (area ? `${name} ${area}` : name);

export function mapsUrl(name: string, area?: string) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(withArea(name, area));
}
export function ticketSearchUrl(name: string, area?: string) {
  return "https://www.google.com/search?q=" + encodeURIComponent(withArea(name, area) + " tickets");
}
export function bookingSearchUrl(name: string, area?: string) {
  return "https://www.google.com/search?q=" + encodeURIComponent(withArea(name, area) + " booking");
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
// 2 adults, 1 room — the person can change any of it on Booking.com.
//
// Booking.com's free-text search often doesn't recognise a hotel's name
// (it falls back to its homepage), so a stay with a map position opens
// the results centred on it, closest first — the hotel is at or near the
// top when Booking.com sells it (Travelodge and Premier Inn don't; then
// it's the nearest alternatives). Without a position (older saved plans),
// it searches the area by name.
export function stayBookingUrl(
  stay: { title: string; lat?: number; lng?: number },
  area?: string,
  time: string = "tonight"
) {
  const checkinOffset = time === "tomorrow" ? 1 : 0;
  const params = new URLSearchParams();
  if (typeof stay.lat === "number" && typeof stay.lng === "number") {
    params.set("ss", stay.title);
    params.set("latitude", stay.lat.toFixed(6));
    params.set("longitude", stay.lng.toFixed(6));
    params.set("dest_type", "latlong");
    params.set("order", "distance_from_search");
  } else {
    params.set("ss", area ? `${stay.title}, ${area}` : stay.title);
  }
  params.set("checkin", localDay(checkinOffset));
  params.set("checkout", localDay(checkinOffset + 1));
  params.set("group_adults", "2");
  params.set("no_rooms", "1");
  params.set("group_children", "0");
  if (BOOKING_AFFILIATE_ID) {
    params.set("aid", BOOKING_AFFILIATE_ID);
    params.set("label", "landed-app"); // shows in your Booking.com reports
  }
  return "https://www.booking.com/searchresults.html?" + params.toString();
}

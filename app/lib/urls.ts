// Every outbound link in the app — maps, ticket search, booking search,
// venue websites — funnels through here (affiliate partner links are in
// affiliates.ts).
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
//
// The search text is the name plus its full address when we have it: older
// Google Maps apps (e.g. on older iPhones) ignore query_place_id and search
// the text alone, so the address keeps them on the right place.
export function placeMapsUrl(venue: { title: string; id?: string; address?: string }, area?: string) {
  const placeId = venue.id?.match(/^g-[a-z]+-(.+)$/)?.[1];
  const text = venue.address ? `${venue.title}, ${venue.address}` : withArea(venue.title, area);
  const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(text);
  return placeId ? url + "&query_place_id=" + encodeURIComponent(placeId) : url;
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

// The action button on a venue in a plan sheet (the booking sheet and a
// saved booking look the same), when no affiliate partner has the venue
// (app/lib/affiliates.ts): the venue's own website — or tickets for
// attractions and live, directions for parking, and a web search for the
// venue when it has no website.
export function planItemLink(cat: string, item: { title: string; website?: string }, area?: string): { href: string; label: string; sponsored?: boolean } {
  if (cat === "attractions" || cat === "live") return { href: ticketSearchUrl(item.title, area, item.website), label: "Get Tickets ↗" };
  if (cat === "parking") return { href: mapsUrl(item.title, area), label: "Get Directions ↗" };
  return { href: bookingSearchUrl(item.title, area, item.website), label: "Book ↗" };
}

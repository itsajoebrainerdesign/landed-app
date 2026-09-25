// Server-side: which venues in a plan are listed on an affiliate partner,
// and their exact page there (CategoryOption.partnerUrl). Runs in
// /api/plan once a category's picks are made. The main button books
// through that page (app/lib/affiliates.ts); with no match it goes to the
// venue's own website — a partner's search is never used, so nobody is
// shown other venues.
//
// Each check runs only when its API key is set (server-only, never
// NEXT_PUBLIC_):
// - TICKETMASTER_API_KEY — Discovery API, free: developer.ticketmaster.com
// - SKIDDLE_API_KEY — Skiddle events API: skiddle.com/api/join.php
//   (non-commercial by default; commercial use needs Skiddle's written OK)
// - VIATOR_API_KEY — Viator Partner API (Basic Access comes with an
//   affiliate account)
// Booking.com, Expedia, Tiqets, GetYourGuide and OpenTable need their
// partner APIs approved first; their checks get added here then.
//
// A venue only counts as listed when the partner's venue/product name
// clearly matches ours (sameVenue) — better to miss a match than send
// someone to the wrong place.

import type { CategoryKey, CategoryOption } from "./categoryOptions";

const TIMEOUT_MS = 4000;

export const PARTNER_CHECKS = {
  ticketmaster: process.env.TICKETMASTER_API_KEY || "",
  skiddle: process.env.SKIDDLE_API_KEY || "",
  viator: process.env.VIATOR_API_KEY || "",
};

// Which checks are on — part of the results cache key, so switching one
// on doesn't keep serving results cached without it.
export function partnerChecksSignature(): string {
  return Object.entries(PARTNER_CHECKS)
    .filter(([, key]) => key)
    .map(([name]) => name[0])
    .join("");
}

type Place = { lat: number; lng: number; location: string };

// ── Name matching ────────────────────────────────────────────────────────

const STOPWORDS = new Set(["the", "a", "an", "at", "of", "and", "in", "on", "st", "saint", "ltd", "uk"]);
function words(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

// True when every meaningful word of the shorter name is in the longer
// one, and there are at least two (or the names are identical) — so
// "The Maltings Theatre" matches "OVO at The Maltings Theatre", but
// "Theatre" alone matches nothing.
export function sameVenue(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.length < 2 && short.join(" ") !== long.join(" ")) return false;
  const set = new Set(long);
  return short.every((w) => set.has(w));
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const isoDay = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

// ── Live: Ticketmaster, then Skiddle ─────────────────────────────────────

type Listing = { venue: string; event: string; url: string };

async function ticketmasterEvents(place: Place): Promise<Listing[]> {
  const params = new URLSearchParams({
    apikey: PARTNER_CHECKS.ticketmaster,
    latlong: `${place.lat},${place.lng}`,
    radius: "10",
    unit: "km",
    size: "100",
    sort: "date,asc",
    startDateTime: new Date().toISOString().slice(0, 19) + "Z",
    endDateTime: isoDay(2) + "T23:59:59Z",
  });
  const data = (await getJson("https://app.ticketmaster.com/discovery/v2/events.json?" + params)) as {
    _embedded?: { events?: { name?: string; url?: string; _embedded?: { venues?: { name?: string }[] } }[] };
  };
  return (data._embedded?.events ?? [])
    .filter((e) => e.url)
    .map((e) => ({ venue: e._embedded?.venues?.[0]?.name ?? "", event: e.name ?? "", url: e.url! }));
}

async function skiddleEvents(place: Place): Promise<Listing[]> {
  const params = new URLSearchParams({
    api_key: PARTNER_CHECKS.skiddle,
    latitude: String(place.lat),
    longitude: String(place.lng),
    radius: "6", // miles
    minDate: isoDay(0),
    maxDate: isoDay(1),
    order: "date",
    limit: "100",
    description: "0",
  });
  const data = (await getJson("https://www.skiddle.com/api/v1/events/search/?" + params)) as {
    results?: { eventname?: string; link?: string; venue?: { name?: string } }[];
  };
  return (data.results ?? [])
    .filter((e) => e.link)
    .map((e) => ({ venue: e.venue?.name ?? "", event: e.eventname ?? "", url: e.link! }));
}

async function checkLive(options: CategoryOption[], place: Place) {
  const sources = await Promise.all([
    PARTNER_CHECKS.ticketmaster ? ticketmasterEvents(place).catch((err) => (console.warn("[partners] Ticketmaster check failed", err), [])) : [],
    PARTNER_CHECKS.skiddle ? skiddleEvents(place).catch((err) => (console.warn("[partners] Skiddle check failed", err), [])) : [],
  ]);
  const listings = sources.flat(); // soonest first within each; Ticketmaster before Skiddle
  for (const option of options) {
    const hit = listings.find((l) => sameVenue(option.title, l.venue) || sameVenue(option.title, l.event));
    if (hit) option.partnerUrl = hit.url;
  }
}

// ── Attractions: Viator ──────────────────────────────────────────────────

async function viatorProduct(option: CategoryOption, place: Place): Promise<string | null> {
  const data = (await getJson("https://api.viator.com/partner/search/freetext", {
    method: "POST",
    headers: {
      "exp-api-key": PARTNER_CHECKS.viator,
      Accept: "application/json;version=2.0",
      "Accept-Language": "en-GB",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      searchTerm: `${option.title} ${place.location}`,
      searchTypes: [{ searchType: "PRODUCTS", pagination: { start: 1, count: 5 } }],
      currency: "GBP",
    }),
  })) as { products?: { results?: { title?: string; productUrl?: string }[] } };
  // Entry to this exact attraction: its name, plus only ticket words — so
  // "St Albans Cathedral Guided Tour" (a different product) doesn't count.
  const own = new Set(words(option.title));
  const hit = (data.products?.results ?? []).find(
    (p) => p.productUrl && p.title && sameVenue(option.title, p.title) && words(p.title).every((w) => own.has(w) || TICKET_WORDS.has(w))
  );
  return hit?.productUrl ?? null;
}
const TICKET_WORDS = new Set(["ticket", "tickets", "entry", "entrance", "admission", "general", "skip", "line", "pass", "day", "access", "e", "timed"]);

async function checkAttractions(options: CategoryOption[], place: Place) {
  if (!PARTNER_CHECKS.viator) return;
  await Promise.all(
    options.map(async (option) => {
      const url = await viatorProduct(option, place).catch((err) => (console.warn("[partners] Viator check failed", err), null));
      if (url) option.partnerUrl = url;
    })
  );
}

// ── Entry point ──────────────────────────────────────────────────────────

// Sets partnerUrl on a category's options (mutating them) where a partner
// lists the venue. Never throws; a failed check just leaves the venue's
// own website as the destination.
export async function findPartnerPages(cat: CategoryKey, options: CategoryOption[], place: Place): Promise<void> {
  if (options.length === 0) return;
  try {
    if (cat === "live" && (PARTNER_CHECKS.ticketmaster || PARTNER_CHECKS.skiddle)) await checkLive(options, place);
    if (cat === "attractions") await checkAttractions(options, place);
  } catch (err) {
    console.warn(`[partners] ${cat} check failed`, err);
  }
}

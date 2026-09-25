// The venue shape every live search result is mapped into (see
// /api/plan), plus the pick-a-venue logic (closest match, filtered by
// vibe, within the budget tier) used to fill "Your Plan". There are no
// built-in venues: every venue comes from a live search around the
// place the person chose.

import type { VibeKey, BudgetKey } from "./constants";

export type CategoryKey = "stay" | "restaurant" | "attractions" | "bar" | "live" | "parking";

// A Google Places photo: its resource name (served through /api/photo so
// the key stays on the server) and who took it, which Google requires
// shown alongside.
export type VenuePhoto = { name: string; author?: string };

export type CategoryOption = {
  id: string;
  tag: string;
  tagBg: string;
  title: string;
  price: string;
  unit: string;
  address: string;
  phone: string;
  vibes: VibeKey[];
  meta: string[];
  // Whether this specific venue is actually bookable through a connected
  // API (vs. just linking out). Not set anywhere yet — nothing is really
  // connected — but the booking sheet is wired to use it the moment it is:
  // flip this to true once a venue's platform (e.g. a Booking.com or
  // OpenTable-backed listing) is genuinely integrated.
  hasApiBooking?: boolean;
  // Budget tier, set by the live search (worked out from price if ever
  // missing — see budgetTierOf).
  budget?: BudgetKey;
  // Map position, from Google — used to open Booking.com centred on a
  // stay.
  lat?: number;
  lng?: number;
  // Photos from Google Places (one per venue — each one shown is billed).
  photos?: VenuePhoto[];
};

export const CATEGORY_ORDER: CategoryKey[] = ["stay", "restaurant", "attractions", "bar", "live", "parking"];
export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  stay: "Stay",
  restaurant: "Restaurant",
  attractions: "Attractions",
  bar: "Late Bar",
  live: "Live",
  parking: "Parking",
};

// Each category's tag label and colour on the venue cards.
export const CATEGORY_STYLE: Record<CategoryKey, { tag: string; tagBg: string }> = {
  stay: { tag: "STAY", tagBg: "#E7DEF7" },
  restaurant: { tag: "RESTAURANT", tagBg: "#F0CFCF" },
  attractions: { tag: "ATTRACTIONS", tagBg: "#D6E8F5" },
  bar: { tag: "LATE BAR", tagBg: "#F1F3C4" },
  live: { tag: "LIVE", tagBg: "#F6DCCB" },
  parking: { tag: "PARKING", tagBg: "#DCEAE3" },
};

// Picks the best venue for a category: rank everything by how close it is,
// then prefer whichever of the closest options also fits the vibe. If
// nothing nearby fits the vibe, it falls back to the closest option
// overall — a category is never left unfilled just because nothing
// perfectly matches the vibe.
function parseDistance(meta: string[]): number {
  const n = parseFloat((meta && meta[0]) || "");
  return isNaN(n) ? 999 : n;
}
// Note: bookings/page.tsx has its own, deliberately different parsePrice
// — that one returns 0 for an unparseable price (since it's summing a
// total, and 0 doesn't distort a sum), while this one returns Infinity
// (since it's only ever used for *sorting* cheapest/priciest first, where
// Infinity naturally sorts last regardless of direction). They look like
// duplicates but aren't — don't merge them.
function parsePrice(price: string): number {
  if (!price) return Infinity;
  if (/free/i.test(price)) return 0;
  const n = parseFloat(price.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? Infinity : n;
}
// The venues on offer per category (from a live search).
export type Catalog = Record<CategoryKey, CategoryOption[]>;

// No venues yet (before a search, or where it found nothing).
export function emptyCatalog(): Catalog {
  const result = {} as Catalog;
  CATEGORY_ORDER.forEach((cat) => (result[cat] = []));
  return result;
}

// An empty category picks "" — callers treat that as "nothing to show".
export function pickForVibe(cat: CategoryKey, vibe: VibeKey, catalog: Catalog): string {
  const options = catalog[cat];
  if (options.length === 0) return "";
  const byDistance = [...options].sort((a, b) => parseDistance(a.meta) - parseDistance(b.meta));
  const vibeMatch = byDistance.find((o) => o.vibes.includes(vibe));
  return (vibeMatch || byDistance[0]).id;
}
// Each budget tier is its own pool: the plan picks from the chosen tier,
// and the swap sheet offers the rest of that tier. Live results carry a
// tier from the search; if one ever doesn't, it's worked out from price —
// the priciest third luxury, everything else modest.
export function budgetTierOf(option: CategoryOption, all: CategoryOption[]): BudgetKey {
  if (option.budget) return option.budget;
  const byPrice = [...all].sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  const i = byPrice.findIndex((o) => o.id === option.id);
  return i >= (byPrice.length * 2) / 3 ? "luxury" : "modest";
}

// The options for a category at a budget. If the area has nothing at that
// tier, fall back to the nearest tier rather than leave the card empty.
const TIER_FALLBACK: Record<BudgetKey, BudgetKey[]> = {
  modest: ["modest", "luxury"],
  luxury: ["luxury", "modest"],
};
export function optionsForBudget(cat: CategoryKey, budget: BudgetKey, catalog: Catalog): CategoryOption[] {
  const all = catalog[cat];
  for (const tier of TIER_FALLBACK[budget]) {
    const pool = all.filter((o) => budgetTierOf(o, all) === tier);
    if (pool.length > 0) return pool;
  }
  return all;
}

// Within the budget tier, the usual closest-match-preferring-vibe pick.
export function pickForBudget(cat: CategoryKey, vibe: VibeKey, budget: BudgetKey, catalog: Catalog): string {
  const pool = optionsForBudget(cat, budget, catalog);
  if (pool.length === 0) return "";
  return pickForVibe(cat, vibe, { ...catalog, [cat]: pool });
}
export function computePicks(vibe: VibeKey, budget: BudgetKey, catalog: Catalog): Record<CategoryKey, string> {
  const result = {} as Record<CategoryKey, string>;
  CATEGORY_ORDER.forEach((cat) => {
    result[cat] = pickForBudget(cat, vibe, budget, catalog);
  });
  return result;
}

// The catalog from a live search's results (per category), with empty
// categories where it found nothing.
export function mergeCatalog(live: Partial<Catalog> | null): Catalog {
  const result = emptyCatalog();
  CATEGORY_ORDER.forEach((cat) => {
    result[cat] = live?.[cat] ?? [];
  });
  return result;
}

// The full venue catalog for the Galway pilot, plus the pick-a-venue
// logic (closest match, filtered by vibe, overridden by budget) used
// to auto-fill "Your Plan" whenever the vibe or budget selection
// changes. This is the largest data file in the project by far — if a
// second region ever ships, this whole shape (id/tag/tagBg/title/
// price/unit/address/phone/vibes/meta) is what a real Places API
// response would need to be mapped into.

import type { VibeKey, BudgetKey } from "./constants";

export type CategoryKey = "stay" | "restaurant" | "attractions" | "bar" | "live" | "parking";

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
  // Budget tier, set by the live search. Missing on the static catalog,
  // where it's worked out from price (see budgetTierOf).
  budget?: BudgetKey;
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

export const CATEGORY_OPTIONS: Record<CategoryKey, CategoryOption[]> = {
  stay: [
    { id: "stay-1", tag: "STAY", tagBg: "#E7DEF7", title: "O'sheas B&B hotel", price: "£210.00", unit: "per night", address: "9 Abbeygate Street, Galway", phone: "091 543 237", vibes: ["nightout", "family"], meta: ["0.2 mi", "★ 4.6 Reviews", "Free WiFi"] },
    { id: "stay-2", tag: "STAY", tagBg: "#E7DEF7", title: "The Harbour Inn", price: "£185.00", unit: "per night", address: "16 William Street, Galway", phone: "091 543 274", vibes: ["nightout", "family", "solo"], meta: ["0.4 mi", "★ 4.3 Reviews", "Breakfast included"] },
    { id: "stay-3", tag: "STAY", tagBg: "#E7DEF7", title: "Galway City Suites", price: "£245.00", unit: "per night", address: "23 Quay Street, Galway", phone: "091 543 311", vibes: ["date", "nightout"], meta: ["0.3 mi", "★ 4.8 Reviews", "City view"] },
    { id: "stay-4", tag: "STAY", tagBg: "#E7DEF7", title: "The Skeffington Arms", price: "£198.00", unit: "per night", address: "30 Merchants Road, Galway", phone: "091 543 348", vibes: ["nightout", "solo"], meta: ["0.5 mi", "★ 4.4 Reviews", "Late checkout"] },
    { id: "stay-5", tag: "STAY", tagBg: "#E7DEF7", title: "Salthill Seaview B&B", price: "£160.00", unit: "per night", address: "37 Cross Street, Galway", phone: "091 543 385", vibes: ["family", "date"], meta: ["1.1 mi", "★ 4.5 Reviews", "Sea view"] },
    { id: "stay-6", tag: "STAY", tagBg: "#E7DEF7", title: "The g Hotel", price: "£275.00", unit: "per night", address: "44 Dominick Street, Galway", phone: "091 543 422", vibes: ["date"], meta: ["0.6 mi", "★ 4.7 Reviews", "Parking on-site"] },
    { id: "stay-7", tag: "STAY", tagBg: "#E7DEF7", title: "Jurys Inn Galway", price: "£175.00", unit: "per night", address: "51 Bridge Street, Galway", phone: "091 543 459", vibes: ["family", "nightout"], meta: ["0.3 mi", "★ 4.1 Reviews", "Family rooms"] },
    { id: "stay-8", tag: "STAY", tagBg: "#E7DEF7", title: "Cluain Mhuire Guesthouse", price: "£140.00", unit: "per night", address: "58 Forster Street, Galway", phone: "091 543 496", vibes: ["solo", "family"], meta: ["0.8 mi", "★ 4.2 Reviews", "Pet friendly"] },
  ],
  restaurant: [
    { id: "restaurant-1", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Kai", price: "£45.00", unit: "per person", address: "9 High Street, Galway", phone: "091 579 237", vibes: ["date", "nightout"], meta: ["0.3 mi", "★ 4.7 Reviews", "Booking recommended"] },
    { id: "restaurant-2", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Ard Bia at Nimmos", price: "£38.00", unit: "per person", address: "16 Fairgreen Road, Galway", phone: "091 579 274", vibes: ["date", "family"], meta: ["0.4 mi", "★ 4.6 Reviews", "Riverside seating"] },
    { id: "restaurant-3", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Loam", price: "£85.00", unit: "per person", address: "23 Salthill Road, Galway", phone: "091 579 311", vibes: ["date"], meta: ["0.6 mi", "★ 4.8 Reviews", "Tasting menu"] },
    { id: "restaurant-4", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "McDonagh's Seafood House", price: "£22.00", unit: "per person", address: "30 Eyre Square, Galway", phone: "091 579 348", vibes: ["family", "solo", "nightout"], meta: ["0.2 mi", "★ 4.4 Reviews", "Casual"] },
    { id: "restaurant-5", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Cava Bodega", price: "£28.00", unit: "per person", address: "37 Shop Street, Galway", phone: "091 579 385", vibes: ["nightout", "date"], meta: ["0.3 mi", "★ 4.5 Reviews", "Tapas"] },
    { id: "restaurant-6", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "The Seafood Bar at Kirwans", price: "£35.00", unit: "per person", address: "44 Woodquay, Galway", phone: "091 579 422", vibes: ["family", "date"], meta: ["0.4 mi", "★ 4.5 Reviews", "Vegetarian options"] },
    { id: "restaurant-7", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Oscars Seafood Bistro", price: "£40.00", unit: "per person", address: "51 Abbeygate Street, Galway", phone: "091 579 459", vibes: ["date", "family"], meta: ["0.5 mi", "★ 4.6 Reviews", "Waterfront view"] },
    { id: "restaurant-8", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Brasserie on the Corner", price: "£32.00", unit: "per person", address: "58 William Street, Galway", phone: "091 579 496", vibes: ["family", "solo"], meta: ["0.3 mi", "★ 4.3 Reviews", "Early bird available"] },
  ],
  attractions: [
    { id: "attractions-1", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Galway City Museum", price: "£8.00", unit: "per person", address: "12 Spanish Parade, Galway", phone: "091 612 118", vibes: ["date", "family", "solo"], meta: ["0.3 mi", "★ 4.5 Reviews", "Cultural"] },
    { id: "attractions-2", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Galway Cathedral Walking Tour", price: "£12.00", unit: "per person", address: "Nun's Island, Galway", phone: "091 612 155", vibes: ["date", "family", "solo"], meta: ["0.4 mi", "★ 4.6 Reviews", "Guided tour"] },
    { id: "attractions-3", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Leisureland Salthill", price: "£10.00", unit: "per person", address: "Salthill Road, Galway", phone: "091 612 192", vibes: ["family", "solo"], meta: ["1.2 mi", "★ 4.3 Reviews", "Swimming & water park"] },
    { id: "attractions-4", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Galway Go-Karting Track", price: "£28.00", unit: "per person", address: "Briarhill, Galway", phone: "091 612 229", vibes: ["nightout", "family", "solo"], meta: ["1.8 mi", "★ 4.7 Reviews", "Go-karting"] },
    { id: "attractions-5", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Kai Ceramics Pottery Workshop", price: "£35.00", unit: "per person", address: "27 Cross Street, Galway", phone: "091 612 266", vibes: ["date", "solo"], meta: ["0.3 mi", "★ 4.8 Reviews", "Pottery making"] },
    { id: "attractions-6", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Blackrock Diving Tower & Prom Walk", price: "Free", unit: "", address: "Salthill Promenade, Galway", phone: "091 612 303", vibes: ["family", "solo", "date"], meta: ["1.4 mi", "★ 4.6 Reviews", "Outdoor & swimming"] },
    { id: "attractions-7", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Terryland Forest Park", price: "Free", unit: "", address: "Terryland, Galway", phone: "091 612 340", vibes: ["family", "solo"], meta: ["1.0 mi", "★ 4.4 Reviews", "Local park"] },
    { id: "attractions-8", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Grá Spa at The g Hotel", price: "£95.00", unit: "per person", address: "44 Dominick Street, Galway", phone: "091 612 377", vibes: ["date"], meta: ["0.6 mi", "★ 4.7 Reviews", "Spa"] },
  ],
  bar: [
    { id: "bar-1", tag: "LATE BAR", tagBg: "#F1F3C4", title: "Délá Pub", price: "£10.00", unit: "avg. per drink", address: "9 Abbeygate Street, Galway", phone: "091 463 237", vibes: ["nightout", "family"], meta: ["0.2 mi", "Open until 2am", "★ 4.5 Reviews", "Food served"] },
    { id: "bar-2", tag: "LATE BAR", tagBg: "#F1F3C4", title: "The Kasbah", price: "£11.00", unit: "avg. per drink", address: "16 William Street, Galway", phone: "091 463 274", vibes: ["date", "nightout"], meta: ["0.5 mi", "Open until 2am", "★ 4.4 Reviews", "Cocktail menu"] },
    { id: "bar-3", tag: "LATE BAR", tagBg: "#F1F3C4", title: "Charlie Byrne's", price: "£9.50", unit: "avg. per drink", address: "23 Quay Street, Galway", phone: "091 463 311", vibes: ["nightout", "solo"], meta: ["0.3 mi", "Open until 1am", "★ 4.6 Reviews", "Craft beer"] },
    { id: "bar-4", tag: "LATE BAR", tagBg: "#F1F3C4", title: "Front Door", price: "£9.00", unit: "avg. per drink", address: "30 Merchants Road, Galway", phone: "091 463 348", vibes: ["nightout", "solo"], meta: ["0.4 mi", "Open until 2am", "★ 4.3 Reviews", "Live sport"] },
    { id: "bar-5", tag: "LATE BAR", tagBg: "#F1F3C4", title: "The Quays Bar", price: "£10.50", unit: "avg. per drink", address: "37 Cross Street, Galway", phone: "091 463 385", vibes: ["nightout", "family"], meta: ["0.3 mi", "Open until 2:30am", "★ 4.4 Reviews", "Outdoor seating"] },
    { id: "bar-6", tag: "LATE BAR", tagBg: "#F1F3C4", title: "Tigh Neachtain", price: "£9.80", unit: "avg. per drink", address: "44 Dominick Street, Galway", phone: "091 463 422", vibes: ["nightout", "solo", "date"], meta: ["0.6 mi", "Open until 1am", "★ 4.7 Reviews", "Beer garden"] },
    { id: "bar-7", tag: "LATE BAR", tagBg: "#F1F3C4", title: "The King's Head", price: "£11.50", unit: "avg. per drink", address: "51 Bridge Street, Galway", phone: "091 463 459", vibes: ["nightout", "solo"], meta: ["0.4 mi", "Open until 2am", "★ 4.2 Reviews", "Quiz night"] },
    { id: "bar-8", tag: "LATE BAR", tagBg: "#F1F3C4", title: "Blue Note", price: "£8.50", unit: "avg. per drink", address: "58 Forster Street, Galway", phone: "091 463 496", vibes: ["nightout", "solo"], meta: ["0.7 mi", "Open until 1:30am", "★ 4.5 Reviews", "Dog friendly"] },
  ],
  live: [
    { id: "live-1", tag: "LIVE", tagBg: "#F6DCCB", title: "Monroe's — Trad session", price: "£19.50", unit: "per person", address: "9 High Street, Galway", phone: "091 424 237", vibes: ["nightout", "family", "solo"], meta: ["0.2 mi", "★ 4.7 Reviews", "Standing only"] },
    { id: "live-2", tag: "LIVE", tagBg: "#F6DCCB", title: "The Róisín Dubh", price: "£22.00", unit: "per person", address: "16 Fairgreen Road, Galway", phone: "091 424 274", vibes: ["nightout", "solo"], meta: ["0.6 mi", "★ 4.6 Reviews", "Full bar"] },
    { id: "live-3", tag: "LIVE", tagBg: "#F6DCCB", title: "An Púcán", price: "£15.00", unit: "per person", address: "23 Salthill Road, Galway", phone: "091 424 311", vibes: ["nightout", "family", "date"], meta: ["0.4 mi", "★ 4.4 Reviews", "Seated venue"] },
    { id: "live-4", tag: "LIVE", tagBg: "#F6DCCB", title: "The Crane Bar", price: "£12.00", unit: "per person", address: "30 Eyre Square, Galway", phone: "091 424 348", vibes: ["nightout", "solo"], meta: ["0.5 mi", "★ 4.5 Reviews", "Standing only"] },
    { id: "live-5", tag: "LIVE", tagBg: "#F6DCCB", title: "Taaffes Bar", price: "£10.00", unit: "per person", address: "37 Shop Street, Galway", phone: "091 424 385", vibes: ["nightout", "family", "solo"], meta: ["0.3 mi", "★ 4.3 Reviews", "All ages"] },
    { id: "live-6", tag: "LIVE", tagBg: "#F6DCCB", title: "Monroe's — Live band", price: "£18.00", unit: "per person", address: "44 Woodquay, Galway", phone: "091 424 422", vibes: ["nightout", "solo"], meta: ["0.2 mi", "★ 4.6 Reviews", "Dance floor"] },
    { id: "live-7", tag: "LIVE", tagBg: "#F6DCCB", title: "Massimo", price: "£25.00", unit: "per person", address: "51 Abbeygate Street, Galway", phone: "091 424 459", vibes: ["date", "nightout"], meta: ["0.8 mi", "★ 4.2 Reviews", "Balcony seating"] },
    { id: "live-8", tag: "LIVE", tagBg: "#F6DCCB", title: "Le Petit Bistro Sessions", price: "£20.00", unit: "per person", address: "58 William Street, Galway", phone: "091 424 496", vibes: ["date", "nightout"], meta: ["0.7 mi", "★ 4.4 Reviews", "18+"] },
    { id: "live-9", tag: "LIVE", tagBg: "#F6DCCB", title: "Rollercoaster Comedy Club", price: "£16.00", unit: "per person", address: "14 Middle Street, Galway", phone: "091 424 533", vibes: ["nightout", "date", "solo"], meta: ["0.4 mi", "★ 4.6 Reviews", "Comedy"] },
    { id: "live-10", tag: "LIVE", tagBg: "#F6DCCB", title: "Galway Arts Festival — Day Stage", price: "£14.00", unit: "per person", address: "Eyre Square, Galway", phone: "091 424 570", vibes: ["family", "date", "solo"], meta: ["0.3 mi", "★ 4.5 Reviews", "Day festival"] },
    { id: "live-11", tag: "LIVE", tagBg: "#F6DCCB", title: "Druid Theatre — Matinee", price: "£24.00", unit: "per person", address: "Druid Lane, Galway", phone: "091 424 607", vibes: ["family", "date", "solo"], meta: ["0.3 mi", "★ 4.8 Reviews", "Day show & theatre"] },
    { id: "live-12", tag: "LIVE", tagBg: "#F6DCCB", title: "Rooftop Cinema at Cinemobile", price: "£15.00", unit: "per person", address: "22 Dock Road, Galway", phone: "091 424 644", vibes: ["date", "solo", "nightout"], meta: ["0.6 mi", "★ 4.5 Reviews", "Rooftop cinema"] },
    { id: "live-13", tag: "LIVE", tagBg: "#F6DCCB", title: "Warehouse Day Rave", price: "£25.00", unit: "per person", address: "Foundry Yard, Galway", phone: "091 424 681", vibes: ["nightout", "solo"], meta: ["0.9 mi", "★ 4.3 Reviews", "Day rave"] },
  ],
  parking: [
    { id: "parking-1", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Cathedral Square", price: "£0.80", unit: "per hour", address: "9 Eyre Square, Galway", phone: "091 836 237", vibes: ["nightout", "date", "family", "solo"], meta: ["0.1 mi", "Free after 6pm", "24 hours", "★ 4.2 Reviews", "CCTV"] },
    { id: "parking-2", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Jury's Lane", price: "£0.60", unit: "per hour", address: "16 Shop Street, Galway", phone: "091 836 274", vibes: ["nightout", "date", "family", "solo"], meta: ["0.3 mi", "24 hours", "★ 4.0 Reviews", "Covered"] },
    { id: "parking-3", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Eyre Square", price: "£1.00", unit: "per hour", address: "23 Woodquay, Galway", phone: "091 836 311", vibes: ["nightout", "date", "family", "solo"], meta: ["0.2 mi", "Free after 8pm", "★ 4.3 Reviews", "Disabled access"] },
    { id: "parking-4", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Fairgreen", price: "£0.70", unit: "per hour", address: "30 Abbeygate Street, Galway", phone: "091 836 348", vibes: ["nightout", "date", "family", "solo"], meta: ["0.4 mi", "24 hours", "★ 4.1 Reviews", "Multi-storey"] },
    { id: "parking-5", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Merchants Road", price: "£0.90", unit: "per hour", address: "37 William Street, Galway", phone: "091 836 385", vibes: ["nightout", "date", "family", "solo"], meta: ["0.3 mi", "Free after 7pm", "★ 4.0 Reviews", "Street level"] },
    { id: "parking-6", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Docks", price: "£0.50", unit: "per hour", address: "44 Quay Street, Galway", phone: "091 836 422", vibes: ["nightout", "date", "family", "solo"], meta: ["0.6 mi", "24 hours", "★ 3.9 Reviews", "EV charging"] },
    { id: "parking-7", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Forster Street", price: "£0.85", unit: "per hour", address: "51 Merchants Road, Galway", phone: "091 836 459", vibes: ["nightout", "date", "family", "solo"], meta: ["0.2 mi", "Free after 6pm", "★ 4.2 Reviews", "Height limit 2.1m"] },
    { id: "parking-8", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Salmon Weir", price: "£0.65", unit: "per hour", address: "58 Cross Street, Galway", phone: "091 836 496", vibes: ["nightout", "date", "family", "solo"], meta: ["0.5 mi", "24 hours", "★ 4.1 Reviews", "Valet available"] },
  ],
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
// Every pick function takes an optional `catalog` so the same logic ranks
// live /api/plan results; it defaults to the static catalog above.
export type Catalog = Record<CategoryKey, CategoryOption[]>;

// An empty category (possible outside Galway, where there's no static
// fallback) picks "" — callers treat that as "nothing to show".
export function pickForVibe(cat: CategoryKey, vibe: VibeKey, catalog: Catalog = CATEGORY_OPTIONS): string {
  const options = catalog[cat];
  if (options.length === 0) return "";
  const byDistance = [...options].sort((a, b) => parseDistance(a.meta) - parseDistance(b.meta));
  const vibeMatch = byDistance.find((o) => o.vibes.includes(vibe));
  return (vibeMatch || byDistance[0]).id;
}
// Each budget tier is its own pool: the plan picks from the chosen tier,
// and the swap sheet offers the rest of that tier. Live results carry a
// tier from the search; the static catalog's is worked out from price —
// cheapest third low, middle third modest, priciest third luxury.
export function budgetTierOf(option: CategoryOption, all: CategoryOption[]): BudgetKey {
  if (option.budget) return option.budget;
  const byPrice = [...all].sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  const i = byPrice.findIndex((o) => o.id === option.id);
  if (i < byPrice.length / 3) return "low";
  if (i >= (byPrice.length * 2) / 3) return "luxury";
  return "modest";
}

// The options for a category at a budget. If the area has nothing at that
// tier, fall back to the nearest tier rather than leave the card empty.
const TIER_FALLBACK: Record<BudgetKey, BudgetKey[]> = {
  low: ["low", "modest", "luxury"],
  modest: ["modest", "low", "luxury"],
  luxury: ["luxury", "modest", "low"],
};
export function optionsForBudget(cat: CategoryKey, budget: BudgetKey, catalog: Catalog = CATEGORY_OPTIONS): CategoryOption[] {
  const all = catalog[cat];
  for (const tier of TIER_FALLBACK[budget]) {
    const pool = all.filter((o) => budgetTierOf(o, all) === tier);
    if (pool.length > 0) return pool;
  }
  return all;
}

// Within the budget tier, the usual closest-match-preferring-vibe pick.
export function pickForBudget(cat: CategoryKey, vibe: VibeKey, budget: BudgetKey, catalog: Catalog = CATEGORY_OPTIONS): string {
  const pool = optionsForBudget(cat, budget, catalog);
  if (pool.length === 0) return "";
  return pickForVibe(cat, vibe, { ...catalog, [cat]: pool });
}
export function computePicks(vibe: VibeKey, budget: BudgetKey, catalog: Catalog = CATEGORY_OPTIONS): Record<CategoryKey, string> {
  const result = {} as Record<CategoryKey, string>;
  CATEGORY_ORDER.forEach((cat) => {
    result[cat] = pickForBudget(cat, vibe, budget, catalog);
  });
  return result;
}

// Live /api/plan results replace a category's static options only when
// that category actually came back non-empty — anything the live search
// missed keeps the static Galway catalog as its fallback. Away from Galway
// (useStaticFallback = false) the static venues would be in the wrong
// place, so a category the live search missed is simply empty.
export function mergeCatalog(live: Partial<Catalog> | null, useStaticFallback = true): Catalog {
  const result = {} as Catalog;
  CATEGORY_ORDER.forEach((cat) => {
    const liveOpts = live?.[cat];
    result[cat] = liveOpts && liveOpts.length > 0 ? liveOpts : useStaticFallback ? CATEGORY_OPTIONS[cat] : [];
  });
  return result;
}

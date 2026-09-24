import type { VibeKey, TimeKey, BudgetKey } from "./constants";

export type CommunityItem = { id: string; tag: string; tagBg: string; title: string; price: string; unit: string };
export type CommunityBooking = {
  id: string;
  authorName: string;
  createdAt: string;
  items: Record<string, CommunityItem>;
  vibe: VibeKey;
  time: TimeKey;
  budget: BudgetKey;
};

// Illustrative "nearby plans" shown in Explore mode — there's no backend
// here, so this can't be genuinely populated by other real users yet.
//
// Every item's `id` here must be a real id from categoryOptions.ts, with
// a title/price that actually matches that catalog entry. "Copy this
// plan" reads `id` directly to populate picks, so a mismatched id
// silently points at the wrong venue, and a mismatched title/price just
// looks wrong. This has already bitten once (two of James's venues
// weren't real catalog entries at all) — if you add or edit an entry
// here, cross-check it against categoryOptions.ts.
export const COMMUNITY_BOOKINGS: CommunityBooking[] = [
  {
    id: "community-1",
    authorName: "James",
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    items: {
      stay: { id: "stay-7", tag: "STAY", tagBg: "#E7DEF7", title: "Jurys Inn Galway", price: "£175.00", unit: "per night" },
      restaurant: { id: "restaurant-4", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "McDonagh's Seafood House", price: "£22.00", unit: "per person" },
      attractions: { id: "attractions-6", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Blackrock Diving Tower & Prom Walk", price: "Free", unit: "" },
      bar: { id: "bar-6", tag: "LATE BAR", tagBg: "#F1F3C4", title: "Tigh Neachtain", price: "£9.80", unit: "avg. per drink" },
      parking: { id: "parking-3", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Eyre Square", price: "£1.00", unit: "per hour" },
    },
    vibe: "solo",
    time: "tonight",
    budget: "low",
  },
  {
    id: "community-2",
    authorName: "Priya",
    createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    items: {
      stay: { id: "stay-6", tag: "STAY", tagBg: "#E7DEF7", title: "The g Hotel", price: "£275.00", unit: "per night" },
      restaurant: { id: "restaurant-2", tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Ard Bia at Nimmos", price: "£38.00", unit: "per person" },
      attractions: { id: "attractions-1", tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Galway City Museum", price: "£8.00", unit: "per person" },
      bar: { id: "bar-2", tag: "LATE BAR", tagBg: "#F1F3C4", title: "The Kasbah", price: "£11.00", unit: "avg. per drink" },
      live: { id: "live-2", tag: "LIVE", tagBg: "#F6DCCB", title: "The Róisín Dubh", price: "£22.00", unit: "per person" },
      parking: { id: "parking-3", tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Eyre Square", price: "£1.00", unit: "per hour" },
    },
    vibe: "nightout",
    time: "tomorrow",
    budget: "luxury",
  },
];

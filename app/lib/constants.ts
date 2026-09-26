// Shared vocabulary and brand constants used across the booking flow,
// Bookings history, and Account pages. Centralised here because before
// this file existed, CTA_GRADIENT was copy-pasted into four separate
// files, and the vibe/budget labels existed as two different shapes in
// two different files (this array here, plus a separate Record<string,
// string> in bookings/page.tsx) — exactly the kind of thing that quietly
// drifts out of sync when only one copy gets updated.

export type TimeKey = "now" | "tonight" | "tomorrow";
export type VibeKey = "nightout" | "date" | "family" | "solo";
// Two tiers: Modest covers everything from cheap and free to mid-range;
// Luxury is for higher spends. (There used to be a separate Low tier —
// plans saved with "low" open as Modest, see normalizeBudget.)
export type BudgetKey = "modest" | "luxury";

export const TIME_OPTIONS: { key: TimeKey; label: string }[] = [
  { key: "now", label: "Now" },
  { key: "tonight", label: "Tonight" },
  { key: "tomorrow", label: "Tomorrow" },
];
export const VIBE_OPTIONS: { key: VibeKey; label: string }[] = [
  { key: "nightout", label: "Friends" },
  { key: "date", label: "Date" },
  { key: "family", label: "Family" },
  { key: "solo", label: "Solo" },
];
// How they're getting there, chosen on the map before searching. It
// decides what the Travel category finds: stations and taxis, or car parks.
export type TravelMode = "transit" | "car";
export const TRAVEL_OPTIONS: { key: TravelMode; label: string }[] = [
  { key: "transit", label: "Public transport" },
  { key: "car", label: "Car" },
];
export const DEFAULT_TRAVEL: TravelMode = "car";
export function normalizeTravel(t: unknown): TravelMode {
  // Plans saved in the old campervan mode open as car.
  return t === "transit" ? t : DEFAULT_TRAVEL;
}

// How far the search reaches, from "Closer" (1) to "Worth the trip" (5):
// a multiplier on each category's normal distance (restaurants and bars
// ~3km, attractions and live ~5km, stays ~8km at level 2). Whole steps, so
// results cache per level. Public transport starts closer, a car a little
// wider, until the person moves the slider themselves.
export type RadiusLevel = 1 | 2 | 3 | 4 | 5;
export const RADIUS_SCALE: Record<RadiusLevel, number> = { 1: 0.5, 2: 1, 3: 1.6, 4: 2.5, 5: 4 };
export function defaultRadius(travel: TravelMode): RadiusLevel {
  return travel === "transit" ? 2 : 3;
}
export function normalizeRadius(r: unknown, travel: TravelMode = DEFAULT_TRAVEL): RadiusLevel {
  return r === 1 || r === 2 || r === 3 || r === 4 || r === 5 ? r : defaultRadius(travel);
}

export const BUDGET_OPTIONS: { key: BudgetKey; label: string }[] = [
  { key: "modest", label: "Modest" },
  { key: "luxury", label: "Luxury" },
];

// The app's one brand gradient, used on every primary CTA button across
// every page.
export const CTA_GRADIENT = "linear-gradient(100deg,var(--accent-light) 0%,var(--accent) 100%)";

// Budgets saved before the Low tier was merged into Modest.
export function normalizeBudget(value: string | null | undefined): BudgetKey {
  return value === "luxury" ? "luxury" : "modest";
}

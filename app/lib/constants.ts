// Shared vocabulary and brand constants used across the booking flow,
// Bookings history, and Account pages. Centralised here because before
// this file existed, CTA_GRADIENT was copy-pasted into four separate
// files, and the vibe/budget labels existed as two different shapes in
// two different files (this array here, plus a separate Record<string,
// string> in bookings/page.tsx) — exactly the kind of thing that quietly
// drifts out of sync when only one copy gets updated.

export type TimeKey = "now" | "tonight" | "tomorrow";
export type VibeKey = "nightout" | "date" | "family" | "solo";
export type BudgetKey = "low" | "modest" | "luxury";

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
export const BUDGET_OPTIONS: { key: BudgetKey; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "modest", label: "Modest" },
  { key: "luxury", label: "Luxury" },
];

// The app's one brand gradient, used on every primary CTA button across
// every page.
export const CTA_GRADIENT = "linear-gradient(100deg,#EFF3A8 0%,#DEEB3A 100%)";

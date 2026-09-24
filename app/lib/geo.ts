// Location helpers shared by the map, the booking flow, and /api/plan.

export type LatLng = { lat: number; lng: number };

// A place the plan is built around — from the map's search box, or the
// Galway default.
export type PlanLocation = LatLng & {
  // Short name for sentences: "Here's your night out in {name}".
  name: string;
  // Fuller label for headings and cards: "Galway, Ireland".
  label: string;
};

// Galway city centre — the pilot region, and the only area the static
// catalog in categoryOptions.ts covers.
export const GALWAY: LatLng = { lat: 53.2707, lng: -9.0568 };
// The plan's placeholder location before one is chosen. Nothing shows it:
// the page stays locked at the map until the device location (or a
// search, or a saved plan) replaces it. Also the location of the Galway
// example plans in Explore.
export const DEFAULT_LOCATION: PlanLocation = { ...GALWAY, name: "Galway", label: "Galway, Ireland" };
export const GALWAY_AREA_KM = 25;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Whether the static Galway catalog is a sensible fallback for a location.
export function isNearGalway(p: LatLng): boolean {
  return haversineKm(GALWAY, p) <= GALWAY_AREA_KM;
}

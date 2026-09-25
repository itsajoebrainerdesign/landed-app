// Location helpers shared by the map, the booking flow, and /api/plan.

export type LatLng = { lat: number; lng: number };

// A place the plan is built around — from the map's search box, or the
// device location.
export type PlanLocation = LatLng & {
  // Short name for sentences: "Here's your night out in {name}".
  name: string;
  // Fuller label for headings and cards: "Leverstock Green, Hemel Hempstead".
  label: string;
};

// No place chosen yet (the page stays locked at the map until one is).
export const NO_LOCATION: PlanLocation = { lat: 0, lng: 0, name: "", label: "" };

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

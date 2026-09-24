// Every outbound link in the app — maps, ticket search, booking search —
// funnels through these three. `area` is the plan's location name (e.g.
// "Galway", or wherever the map search moved the plan); it defaults to
// Galway, the pilot region, for anything saved before locations existed.

export function mapsUrl(name: string, area = "Galway") {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name + " " + area);
}
export function ticketSearchUrl(name: string, area = "Galway") {
  return "https://www.google.com/search?q=" + encodeURIComponent(name + " tickets " + area);
}
export function bookingSearchUrl(name: string, area = "Galway") {
  return "https://www.google.com/search?q=" + encodeURIComponent(name + " " + area + " booking");
}

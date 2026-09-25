// Affiliate links.
//
// The results are chosen for the person — affiliates play no part in
// which venues are picked. Only where a button goes changes:
// - A venue's main button books through a partner only when the venue has
//   a confirmed page on that partner (`partnerUrl`, found by the checks in
//   app/lib/partnerChecks.ts when the plan is searched) — never a search
//   on the partner's site, which would show other venues. Otherwise it
//   goes to the venue's own website (urls.ts, planItemLink).
// - "Getting there" (travelLinks) offers train, coach, car hire and
//   parking for the plan's area, from each travel partner that's set up.
//
// ── Setup: one value per programme ─────────────────────────────────────
// In Vercel → Settings → Environment Variables (then redeploy), paste what
// that programme's dashboard gives you, in one of two forms:
// - A deep-link template with {url} where the destination goes — for the
//   networks: Awin, e.g.
//     https://www.awin1.com/cread.php?awinmid=123&awinaffid=456&ued={url}
//   Impact (Ticketmaster), e.g. https://ticketmaster.evyy.net/c/1/2/3?u={url}
//   Partnerize (Trainline), e.g. https://prf.hn/click/camref:ABC/destination:{url}
// - Or tracking parameters to add to the link, e.g. `aid=1234567` for
//   Booking.com, `partner_id=ABC123` for GetYourGuide.
// These values aren't secret — they're in every affiliate link. Next.js
// only fills in NEXT_PUBLIC_ values written out in full, as below.

type Programme = {
  name: string;
  // Hostnames whose pages this programme pays on.
  hosts: string[];
  tracking: string;
};

export const PROGRAMMES = {
  // Venues
  booking: { name: "Booking.com", hosts: ["booking.com"], tracking: process.env.NEXT_PUBLIC_AFF_BOOKING || "" },
  expedia: { name: "Expedia", hosts: ["expedia.co.uk", "expedia.com", "hotels.com"], tracking: process.env.NEXT_PUBLIC_AFF_EXPEDIA || "" },
  skiddle: { name: "Skiddle", hosts: ["skiddle.com"], tracking: process.env.NEXT_PUBLIC_AFF_SKIDDLE || "" },
  ticketmaster: { name: "Ticketmaster", hosts: ["ticketmaster.co.uk", "ticketmaster.ie"], tracking: process.env.NEXT_PUBLIC_AFF_TICKETMASTER || "" },
  tiqets: { name: "Tiqets", hosts: ["tiqets.com"], tracking: process.env.NEXT_PUBLIC_AFF_TIQETS || "" },
  viator: { name: "Viator", hosts: ["viator.com"], tracking: process.env.NEXT_PUBLIC_AFF_VIATOR || "" },
  getyourguide: { name: "GetYourGuide", hosts: ["getyourguide.co.uk", "getyourguide.com"], tracking: process.env.NEXT_PUBLIC_AFF_GETYOURGUIDE || "" },
  // Getting there
  trainline: { name: "Trainline", hosts: ["thetrainline.com"], tracking: process.env.NEXT_PUBLIC_AFF_TRAINLINE || "" },
  nationalexpress: { name: "National Express", hosts: ["nationalexpress.com"], tracking: process.env.NEXT_PUBLIC_AFF_NATIONALEXPRESS || "" },
  megabus: { name: "Megabus", hosts: ["megabus.com"], tracking: process.env.NEXT_PUBLIC_AFF_MEGABUS || "" },
  flixbus: { name: "FlixBus", hosts: ["flixbus.co.uk"], tracking: process.env.NEXT_PUBLIC_AFF_FLIXBUS || "" },
  rentalcars: { name: "Rentalcars.com", hosts: ["rentalcars.com"], tracking: process.env.NEXT_PUBLIC_AFF_RENTALCARS || "" },
  justpark: { name: "JustPark", hosts: ["justpark.com"], tracking: process.env.NEXT_PUBLIC_AFF_JUSTPARK || "" },
  yourparkingspace: { name: "YourParkingSpace", hosts: ["yourparkingspace.co.uk"], tracking: process.env.NEXT_PUBLIC_AFF_YOURPARKINGSPACE || "" },
} satisfies Record<string, Programme>;

// `url` with the programme's tracking applied, or null if it isn't set up.
function track(programme: Programme, url: URL): string | null {
  const t = programme.tracking.trim();
  if (!t) return null;
  if (t.includes("{url}")) return t.replace("{url}", encodeURIComponent(url.toString()));
  for (const [k, v] of new URLSearchParams(t.replace(/^[?&]/, ""))) url.searchParams.set(k, v);
  return url.toString();
}

function programmeFor(url: URL): Programme | null {
  const host = url.hostname.replace(/^www\./, "");
  return Object.values(PROGRAMMES).find((p) => p.hosts.some((h) => host === h || host.endsWith("." + h))) ?? null;
}

// ── Venue buttons ────────────────────────────────────────────────────────

// What the plan is for, used to fill in a booking page.
export type BookingContext = { time?: string; vibe?: string };

// Who's going, by vibe: Family is 2 adults + 1 child (aged 8 — Booking.com
// otherwise assumes a baby), Solo is 1, Date and Friends are 2. Only stays
// get the party filled in.
const CHILD_AGE = 8;
function partyFor(vibe?: string): { adults: number; children: number } {
  if (vibe === "family") return { adults: 2, children: 1 };
  if (vibe === "solo") return { adults: 1, children: 0 };
  return { adults: 2, children: 0 };
}

// YYYY-MM-DD in the device's local time.
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A hotel's Booking.com page for one night (tonight, or tomorrow night for
// Tomorrow), one room, and the party for the vibe.
function fillBookingCom(url: URL, ctx: BookingContext) {
  const checkin = ctx.time === "tomorrow" ? 1 : 0;
  const party = partyFor(ctx.vibe);
  url.searchParams.set("label", "landed-app");
  url.searchParams.set("checkin", localDay(checkin));
  url.searchParams.set("checkout", localDay(checkin + 1));
  url.searchParams.set("no_rooms", "1");
  url.searchParams.set("group_adults", String(party.adults));
  url.searchParams.set("group_children", String(party.children));
  url.searchParams.delete("age");
  for (let i = 0; i < party.children; i++) url.searchParams.append("age", String(CHILD_AGE));
}

type PartnerLink = { href: string; label: string; sponsored: true };
const LABELS: Record<string, string> = { stay: "Book ↗", restaurant: "Book ↗", bar: "Book ↗", live: "Get Tickets ↗", attractions: "Get Tickets ↗", parking: "Book Parking ↗" };

// The tracked partner link for a venue's main button: only when the venue
// has a confirmed partner page and that partner's programme is set up.
export function partnerLink(cat: string, venue: { partnerUrl?: string }, ctx: BookingContext = {}): PartnerLink | null {
  if (!venue.partnerUrl || !LABELS[cat]) return null;
  let url: URL;
  try {
    url = new URL(venue.partnerUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const programme = programmeFor(url);
  if (!programme) return null;
  if (programme === PROGRAMMES.booking) fillBookingCom(url, ctx);
  const href = track(programme, url);
  return href ? { href, label: LABELS[cat], sponsored: true } : null;
}

// ── Getting there ────────────────────────────────────────────────────────

export type TravelLink = { href: string; label: string; detail: string };

// Travel options for the plan's area, from each travel partner that's set
// up. Journey planners open on their own search (they need the person's
// starting point); parking searches around the plan's pin. Megabus only
// runs in Scotland and on a few cross-border routes now, so it's offered
// for plans in Scotland only.
// By travel mode: public transport gets trains and coaches, a car gets car
// hire and parking.
export function travelLinks(place: { lat?: number; lng?: number; name?: string }, travel: string = "car"): TravelLink[] {
  const hasPos = typeof place.lat === "number" && typeof place.lng === "number" && !(place.lat === 0 && place.lng === 0);
  const inScotland = hasPos && place.lat! >= 55.0 && place.lng! < -1.8;
  const options: [Programme, string, string, string][] = [
    [PROGRAMMES.trainline, "https://www.thetrainline.com/", "Train", "Trainline"],
    [PROGRAMMES.nationalexpress, "https://www.nationalexpress.com/en", "Coach", "National Express"],
    [PROGRAMMES.flixbus, "https://www.flixbus.co.uk/", "Coach", "FlixBus"],
    ...(inScotland ? [[PROGRAMMES.megabus, "https://uk.megabus.com/", "Coach", "Megabus"] as [Programme, string, string, string]] : []),
    [PROGRAMMES.rentalcars, "https://www.rentalcars.com/", "Car hire", "Rentalcars.com"],
    [
      PROGRAMMES.justpark,
      hasPos ? `https://www.justpark.com/search/?lat=${place.lat!.toFixed(6)}&lng=${place.lng!.toFixed(6)}${place.name ? `&q=${encodeURIComponent(place.name)}` : ""}` : "https://www.justpark.com/",
      "Pre-book parking",
      "JustPark",
    ],
    [PROGRAMMES.yourparkingspace, "https://www.yourparkingspace.co.uk/", "Pre-book parking", "YourParkingSpace"],
  ];
  const forMode = (label: string) =>
    travel === "transit" ? label === "Train" || label === "Coach" : label === "Car hire" || label === "Pre-book parking";
  const links: TravelLink[] = [];
  for (const [programme, destination, label, detail] of options) {
    if (!forMode(label)) continue;
    const href = track(programme, new URL(destination));
    if (href) links.push({ href, label, detail });
  }
  return links;
}

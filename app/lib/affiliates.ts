// Affiliate booking links: Booking.com (stays), OpenTable (restaurants,
// bars), Ticketmaster (live), GetYourGuide (attractions), JustPark
// (parking).
//
// The results are chosen for the person — affiliates play no part in
// which venues are picked. Only the button's destination changes:
// the main button on a venue card books through a partner only when the
// venue has a confirmed page on that partner (`partnerUrl`, found by
// checking the partner when the plan is searched) — never a search on
// the partner's site, which would show other venues. The link is then
// wrapped in our tracking so the booking earns commission. Otherwise the
// button goes to the venue's own website (urls.ts, planItemLink).
//
// Setup (Vercel → Settings → Environment Variables, then redeploy):
// - Booking.com: your Affiliate Partner ID (the "aid") in
//   NEXT_PUBLIC_BOOKING_AFFILIATE_ID.
// - Awin programmes (OpenTable, Ticketmaster, JustPark): your Awin
//   publisher ID in NEXT_PUBLIC_AWIN_PUBLISHER_ID, plus each advertiser's
//   ID ("mid", on its programme page in Awin once you're approved).
// - GetYourGuide: your partner ID from the GetYourGuide Partner Portal.
// These IDs aren't secret — they appear in every affiliate link.
//
// Next.js only fills in NEXT_PUBLIC_ values written out in full like
// this, so don't look them up dynamically.
const AWIN_PUBLISHER_ID = process.env.NEXT_PUBLIC_AWIN_PUBLISHER_ID || "";
const AWIN_MID = {
  opentable: process.env.NEXT_PUBLIC_AWIN_MID_OPENTABLE || "",
  ticketmaster: process.env.NEXT_PUBLIC_AWIN_MID_TICKETMASTER || "",
  justpark: process.env.NEXT_PUBLIC_AWIN_MID_JUSTPARK || "",
};
const GETYOURGUIDE_PARTNER_ID = process.env.NEXT_PUBLIC_GETYOURGUIDE_PARTNER_ID || "";
const BOOKING_AFFILIATE_ID = process.env.NEXT_PUBLIC_BOOKING_AFFILIATE_ID || "";

// What the plan is for, used to fill in a booking page.
export type BookingContext = { time?: string; vibe?: string };

// Who's going, by vibe: Family is 2 adults + 1 child (aged 8 — Booking.com
// otherwise assumes a baby), Solo is 1, Date and Friends are 2.
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

// A hotel's Booking.com page with our aid, one night (tonight, or
// tomorrow night for Tomorrow), one room, and the party for the vibe.
function bookingComLink(url: URL, ctx: BookingContext): string | null {
  if (!BOOKING_AFFILIATE_ID) return null;
  const checkin = ctx.time === "tomorrow" ? 1 : 0;
  const party = partyFor(ctx.vibe);
  url.searchParams.set("aid", BOOKING_AFFILIATE_ID);
  url.searchParams.set("label", "landed-app");
  url.searchParams.set("checkin", localDay(checkin));
  url.searchParams.set("checkout", localDay(checkin + 1));
  url.searchParams.set("no_rooms", "1");
  url.searchParams.set("group_adults", String(party.adults));
  url.searchParams.set("group_children", String(party.children));
  url.searchParams.delete("age");
  for (let i = 0; i < party.children; i++) url.searchParams.append("age", String(CHILD_AGE));
  return url.toString();
}

type Venue = { partnerUrl?: string };

// Awin's deep link: sends the person to `destination`, tracked to us.
function awin(mid: string, destination: string): string | null {
  if (!AWIN_PUBLISHER_ID || !mid) return null;
  const params = new URLSearchParams({ awinmid: mid, awinaffid: AWIN_PUBLISHER_ID, clickref: "landed-app", ued: destination });
  return "https://www.awin1.com/cread.php?" + params.toString();
}

type PartnerLink = { href: string; label: string; sponsored: true };

// Which programme each partner's pages belong to.
function trackedLink(url: string, ctx: BookingContext): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "booking.com") return bookingComLink(parsed, ctx);
  if (host.endsWith("opentable.co.uk") || host.endsWith("opentable.com")) return awin(AWIN_MID.opentable, url);
  if (host.endsWith("ticketmaster.co.uk")) return awin(AWIN_MID.ticketmaster, url);
  if (host.endsWith("justpark.com")) return awin(AWIN_MID.justpark, url);
  if (host.endsWith("getyourguide.co.uk") || host.endsWith("getyourguide.com")) {
    if (!GETYOURGUIDE_PARTNER_ID) return null;
    const u = new URL(url);
    u.searchParams.set("partner_id", GETYOURGUIDE_PARTNER_ID);
    u.searchParams.set("utm_medium", "online_publisher");
    return u.toString();
  }
  return null;
}

const LABELS: Record<string, string> = { stay: "Book ↗", restaurant: "Book ↗", bar: "Book ↗", live: "Get Tickets ↗", attractions: "Get Tickets ↗", parking: "Book Parking ↗" };

// The tracked partner link for a venue's main button: only when the venue
// has a confirmed partner page and that partner's programme is set up.
export function partnerLink(cat: string, venue: Venue, ctx: BookingContext = {}): PartnerLink | null {
  if (!venue.partnerUrl || !LABELS[cat]) return null;
  const href = trackedLink(venue.partnerUrl, ctx);
  return href ? { href, label: LABELS[cat], sponsored: true } : null;
}

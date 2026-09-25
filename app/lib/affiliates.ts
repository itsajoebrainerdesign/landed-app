// Affiliate booking links beyond Booking.com (stays — see urls.ts).
//
// The main button on a venue card books through a partner only when the
// venue has a confirmed page on that partner (`partnerUrl`, found by
// checking the partner when the plan is searched) — never a search on
// the partner's site, which would show other venues. The link is then
// wrapped in our tracking so the booking earns commission. Otherwise the
// button goes to the venue's own website (or ticket search / directions).
//
// Setup (Vercel → Settings → Environment Variables, then redeploy):
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

type Venue = { partnerUrl?: string };

// Awin's deep link: sends the person to `destination`, tracked to us.
function awin(mid: string, destination: string): string | null {
  if (!AWIN_PUBLISHER_ID || !mid) return null;
  const params = new URLSearchParams({ awinmid: mid, awinaffid: AWIN_PUBLISHER_ID, clickref: "landed-app", ued: destination });
  return "https://www.awin1.com/cread.php?" + params.toString();
}

type PartnerLink = { href: string; label: string; sponsored: true };

// Which programme each partner's pages belong to.
function trackedLink(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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

const LABELS: Record<string, string> = { restaurant: "Book ↗", bar: "Book ↗", live: "Get Tickets ↗", attractions: "Get Tickets ↗", parking: "Book Parking ↗" };

// The tracked partner link for a venue's main button: only when the venue
// has a confirmed partner page and that partner's programme is set up.
export function partnerLink(cat: string, venue: Venue): PartnerLink | null {
  if (!venue.partnerUrl || !LABELS[cat]) return null;
  const href = trackedLink(venue.partnerUrl);
  return href ? { href, label: LABELS[cat], sponsored: true } : null;
}

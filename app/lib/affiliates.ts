// Affiliate booking links beyond Booking.com (stays — see urls.ts).
//
// Each venue card in the plan sheets keeps its main button (the venue's
// own website, tickets search, or directions) and, once a programme below
// is set up, gets a second link to book through that partner, carrying
// our tracking so bookings earn commission. Nothing shows until the
// programme's IDs are set, so the app works the same without them.
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

type Venue = { title: string; lat?: number; lng?: number };

// Awin's deep link: sends the person to `destination`, tracked to us.
function awin(mid: string, destination: string): string | null {
  if (!AWIN_PUBLISHER_ID || !mid) return null;
  const params = new URLSearchParams({ awinmid: mid, awinaffid: AWIN_PUBLISHER_ID, clickref: "landed-app", ued: destination });
  return "https://www.awin1.com/cread.php?" + params.toString();
}

const withArea = (name: string, area?: string) => (area ? `${name} ${area}` : name);

// The partner link for a venue in a plan, or null when that category's
// programme isn't set up.
export function partnerLink(cat: string, venue: Venue, area?: string): { href: string; label: string } | null {
  if (cat === "restaurant" || cat === "bar") {
    const href = awin(AWIN_MID.opentable, "https://www.opentable.co.uk/s?term=" + encodeURIComponent(withArea(venue.title, area)));
    return href ? { href, label: "Book on OpenTable ↗" } : null;
  }
  if (cat === "live") {
    const href = awin(AWIN_MID.ticketmaster, "https://www.ticketmaster.co.uk/search?q=" + encodeURIComponent(withArea(venue.title, area)));
    return href ? { href, label: "Tickets on Ticketmaster ↗" } : null;
  }
  if (cat === "attractions") {
    if (!GETYOURGUIDE_PARTNER_ID) return null;
    const params = new URLSearchParams({ q: withArea(venue.title, area), partner_id: GETYOURGUIDE_PARTNER_ID, utm_medium: "online_publisher" });
    return { href: "https://www.getyourguide.co.uk/s/?" + params.toString(), label: "Tickets on GetYourGuide ↗" };
  }
  if (cat === "parking") {
    const params = new URLSearchParams({ q: withArea(venue.title, area) });
    if (typeof venue.lat === "number" && typeof venue.lng === "number") {
      params.set("lat", venue.lat.toFixed(6));
      params.set("lng", venue.lng.toFixed(6));
    }
    const href = awin(AWIN_MID.justpark, "https://www.justpark.com/search/?" + params.toString());
    return href ? { href, label: "Book on JustPark ↗" } : null;
  }
  return null;
}

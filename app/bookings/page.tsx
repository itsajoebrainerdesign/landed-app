"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VIBE_OPTIONS, BUDGET_OPTIONS, CTA_GRADIENT, normalizeBudget } from "../lib/constants";
import { mapsUrl, ticketSearchUrl, bookingSearchUrl } from "../lib/urls";
import { formatDate } from "../lib/format";
import type { SavedBooking } from "../lib/bookingsStore";
import { listBookings, writeDeviceBookings } from "../lib/bookingsStore";
import { onAuthChange } from "../lib/accountStore";

// Seeded the first time a signed-out guest opens this page with nothing
// saved on their device yet, so the two sections below aren't empty by
// default — same shape as a real saved entry (including resolved items),
// so both "Edit" and "View" work exactly as they would on something you
// actually booked. Never seeded into a real account (and dropped, not
// imported, when a guest signs in — see bookingsStore.ts).
const EXAMPLE_BOOKINGS: SavedBooking[] = [
  {
    id: "example-1",
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    planSummary: "Here's your night out in Galway tonight with a stay to round it off.",
    picks: {
      stay: "stay-2",
      restaurant: "restaurant-1",
      attractions: "attractions-1",
      bar: "bar-2",
      live: "live-2",
      parking: "parking-3",
    },
    items: {
      stay: { tag: "STAY", tagBg: "#E7DEF7", title: "The Harbour Inn", price: "£185.00", unit: "per night" },
      restaurant: { tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Kai", price: "£45.00", unit: "per person" },
      attractions: { tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Galway City Museum", price: "£8.00", unit: "per person" },
      bar: { tag: "LATE BAR", tagBg: "#F1F3C4", title: "The Kasbah", price: "£11.00", unit: "avg. per drink" },
      live: { tag: "LIVE", tagBg: "#F6DCCB", title: "The Róisín Dubh", price: "£22.00", unit: "per person" },
      parking: { tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Eyre Square", price: "£1.00", unit: "per hour" },
    },
    vibe: "nightout",
    time: "tonight",
    budget: "modest",
    removedCategories: [],
    confirmed: true,
  },
  {
    id: "example-2",
    createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    planSummary: "Here's your date night in Galway now with a stay to round it off.",
    picks: {
      stay: "stay-6",
      restaurant: "restaurant-3",
      attractions: "attractions-1",
      bar: "bar-2",
      live: "live-9",
      parking: "parking-3",
    },
    items: {
      stay: { tag: "STAY", tagBg: "#E7DEF7", title: "The g Hotel", price: "£275.00", unit: "per night" },
      restaurant: { tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Loam", price: "£85.00", unit: "per person" },
      attractions: { tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Galway City Museum", price: "£8.00", unit: "per person" },
      bar: { tag: "LATE BAR", tagBg: "#F1F3C4", title: "The Kasbah", price: "£11.00", unit: "avg. per drink" },
      live: { tag: "LIVE", tagBg: "#F6DCCB", title: "Rollercoaster Comedy Club", price: "£16.00", unit: "per person" },
      parking: { tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Eyre Square", price: "£1.00", unit: "per hour" },
    },
    vibe: "date",
    time: "now",
    budget: "luxury",
    removedCategories: [],
    confirmed: true,
  },
  {
    id: "example-3",
    createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    planSummary: "Here's your family day out in Galway tomorrow with a stay to round it off.",
    picks: {
      stay: "stay-2",
      restaurant: "restaurant-8",
      attractions: "attractions-3",
      live: "live-10",
      parking: "parking-3",
    },
    items: {
      stay: { tag: "STAY", tagBg: "#E7DEF7", title: "The Harbour Inn", price: "£185.00", unit: "per night" },
      restaurant: { tag: "RESTAURANT", tagBg: "#F0CFCF", title: "Brasserie on the Corner", price: "£32.00", unit: "per person" },
      attractions: { tag: "ATTRACTIONS", tagBg: "#D6E8F5", title: "Leisureland Salthill", price: "£10.00", unit: "per person" },
      live: { tag: "LIVE", tagBg: "#F6DCCB", title: "Galway Arts Festival — Day Stage", price: "£14.00", unit: "per person" },
      parking: { tag: "PARKING", tagBg: "#DCEAE3", title: "Parking — Eyre Square", price: "£1.00", unit: "per hour" },
    },
    vibe: "family",
    time: "tomorrow",
    budget: "modest",
    removedCategories: ["bar"],
    confirmed: false,
  },
];

// Note: lib/categoryOptions.ts has its own, deliberately different
// parsePrice — that one returns Infinity for an unparseable price (since
// it's only ever used for sorting cheapest/priciest first), while this
// one returns 0 (since it's summing a total here, and 0 doesn't distort
// a sum the way Infinity would). They look like duplicates but aren't —
// don't merge them.
function parsePrice(price: string): number {
  if (!price) return 0;
  if (/free/i.test(price)) return 0;
  const n = parseFloat(price.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Nothing actually books or pays through the app yet — every category
// just links out to book elsewhere — so this is a planning estimate
// summed across everything in the plan, not a record of real payments.
function estimatedTotal(booking: SavedBooking): number {
  return Object.values(booking.items).reduce((sum, item) => sum + parsePrice(item.price), 0);
}

function BookingCard({
  booking,
  onView,
  cardBg,
}: {
  booking: SavedBooking;
  onView?: (b: SavedBooking) => void;
  cardBg?: string;
}) {
  return (
    <div
      style={{
        borderRadius: 20,
        background: cardBg || "#F7F5EE",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              borderRadius: 999,
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
              background: booking.confirmed ? "#DEEB3A" : "#EAE7DF",
              color: "#111111",
            }}
          >
            {booking.confirmed ? "CONFIRMED" : "DRAFT"}
          </span>
          <span className="text-[11px]" style={{ color: "#767766" }}>
            {formatDate(booking.createdAt)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span className="text-[10px]" style={{ color: "#767766" }}>Estimated total</span>
          <span className="font-semibold text-[14px] text-ink">£{estimatedTotal(booking).toFixed(2)}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="font-semibold text-[15px] leading-snug text-ink">{booking.location?.label ?? "Galway, Ireland"}</span>
        <span className="text-[12px]" style={{ color: "#767766" }}>
          {VIBE_OPTIONS.find((o) => o.key === booking.vibe)?.label || booking.vibe} ·{" "}
          {BUDGET_OPTIONS.find((o) => o.key === normalizeBudget(booking.budget))?.label}
        </span>
      </div>
      {booking.confirmed ? (
        <button
          onClick={() => onView && onView(booking)}
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 700,
            color: "#111111",
            background: CTA_GRADIENT,
            border: "none",
            cursor: "pointer",
          }}
        >
          View
        </button>
      ) : (
        <Link
          href={`/?load=${booking.id}`}
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 700,
            color: "#111111",
            background: CTA_GRADIENT,
            textDecoration: "none",
          }}
        >
          Edit
        </Link>
      )}
    </div>
  );
}

// `area` is the booking's location name (Galway for plans saved before
// the map search could move a plan).
function linkForCategory(cat: string, name: string, area?: string) {
  if (cat === "attractions" || cat === "live") return { href: ticketSearchUrl(name, area), label: "Get Tickets ↗" };
  if (cat === "parking") return { href: mapsUrl(name, area), label: "Get Directions ↗" };
  return { href: bookingSearchUrl(name, area), label: "Book ↗" };
}

function ViewBookingSheet({
  booking,
  onClose,
}: {
  booking: SavedBooking | null;
  onClose: () => void;
}) {
  const open = !!booking;
  const items = booking ? Object.entries(booking.items) : [];
  const total = items.reduce((sum, [, item]) => sum + parsePrice(item.price), 0);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition: "opacity 300ms",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          display: "flex",
          flexDirection: "column",
          background: "#FFFFFF",
          height: "85vh",
          maxHeight: "85vh",
          transform: open ? "translateY(0%)" : "translateY(100%)",
          transition: "transform 300ms",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8, flexShrink: 0 }}>
          <div style={{ width: 40, height: 5, borderRadius: 999, background: "#D9D9D9" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 4px", flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>Your plan</span>
          <button onClick={onClose} aria-label="Close" style={{ fontWeight: 600, fontSize: 18, color: "#111111", background: "none", border: "none", padding: 8, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <span style={{ padding: "0 20px 16px", fontSize: 12, color: "#767766" }}>
          {booking?.planSummary}
        </span>
        <div style={{ overflowY: "auto", padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 16, flex: "1 1 auto", minHeight: 0 }}>
          {items.map(([cat, item]) => {
            const link = linkForCategory(cat, item.title, booking?.location?.name);
            return (
              <div key={cat} style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ alignSelf: "flex-start", borderRadius: 999, padding: "6px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: item.tagBg, color: "#111111" }}>
                  {item.tag}
                </span>
                <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{item.title}</span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 16, color: "#111111" }}>{item.price}</span>
                    <span style={{ fontSize: 12, color: "#3E3E3A" }}>{item.unit}</span>
                  </div>
                  {item.hasApiBooking ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "8px 14px", fontSize: 11, fontWeight: 700, background: "#DEEB3A", color: "#111111" }}>
                      ✓ Booked
                    </span>
                  ) : (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ borderRadius: 999, padding: "8px 14px", fontSize: 11, fontWeight: 700, background: CTA_GRADIENT, color: "#111111", textDecoration: "none" }}
                    >
                      {link.label}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid #EFEFEF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="font-semibold text-[14px]" style={{ color: "#111111" }}>Estimated total</span>
          <span className="font-semibold text-[18px]" style={{ color: "#111111" }}>£{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Bookings() {
  const [bookings, setBookings] = useState<SavedBooking[] | null>(null);
  const [viewing, setViewing] = useState<SavedBooking | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // From the account when signed in, this device when not — and reloaded
  // whenever someone signs in or out.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { bookings: list, source, error } = await listBookings();
      if (cancelled) return;
      if (source === "device" && !list) {
        writeDeviceBookings(EXAMPLE_BOOKINGS);
        setBookings(EXAMPLE_BOOKINGS);
      } else {
        setBookings(list || []);
      }
      setLoadError(error ?? null);
    }
    load().catch((err) => {
      console.error("[Landed] couldn't load bookings", err);
      if (!cancelled) {
        setBookings([]);
        setLoadError("Couldn't load your bookings.");
      }
    });
    const unsubscribe = onAuthChange(() => {
      load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const drafts = bookings ? bookings.filter((b) => !b.confirmed) : [];
  const confirmed = bookings ? bookings.filter((b) => b.confirmed) : [];

  return (
    // This 21px must match NavBar.tsx's left/right insets and the same
    // 21px used in page.tsx and account/page.tsx — see the longer
    // comment on the Search/Explore toggle in page.tsx for why.
    <main className="w-full min-h-screen bg-white px-[21px] flex flex-col gap-8" style={{ paddingTop: 24 }}>
      {/* Replace with your real logo asset. Plain <img> on purpose: a 30px
          local icon gains nothing from next/image's optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/landed-icon.png" alt="Landed" className="w-[30px] h-auto" />

      {bookings === null && (
        <span className="text-[13px] leading-snug" style={{ color: "#767676" }}>
          Loading…
        </span>
      )}

      {loadError && (
        <span className="text-[13px] leading-snug" style={{ color: "#767676" }}>
          {loadError}
        </span>
      )}

      {bookings !== null && drafts.length > 0 && (
        <div className="flex flex-col gap-3.5">
          <span className="font-semibold text-[20px] leading-none text-ink">Draft Bookings</span>
          {drafts.map((b) => (
            <BookingCard key={b.id} booking={b} />
          ))}
        </div>
      )}

      {bookings !== null && (
        <div
          style={{
            background: "#F1F0EA",
            width: "100vw",
            marginLeft: "calc(50% - 50vw)",
            marginRight: "calc(50% - 50vw)",
            paddingBottom: 140,
            flex: "1 1 auto",
          }}
        >
          <div className="w-full px-[21px] flex flex-col gap-3.5" style={{ paddingTop: 36 }}>
            <span className="font-semibold text-[20px] leading-none text-ink">Your bookings</span>
            {confirmed.length === 0 ? (
              <span className="text-[13px] leading-snug" style={{ color: "#767676" }}>
                Nothing confirmed yet — tap the + button to start a plan.
              </span>
            ) : (
              confirmed.map((b) => (
                <BookingCard key={b.id} booking={b} onView={setViewing} cardBg="#FFFFFF" />
              ))
            )}
          </div>
        </div>
      )}

      <ViewBookingSheet booking={viewing} onClose={() => setViewing(null)} />
    </main>
  );
}

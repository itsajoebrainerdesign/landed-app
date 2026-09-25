"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VIBE_OPTIONS, BUDGET_OPTIONS, CTA_GRADIENT, normalizeBudget } from "../lib/constants";
import { formatDate } from "../lib/format";
import type { SavedBooking } from "../lib/bookingsStore";
import { listBookings, deleteBooking } from "../lib/bookingsStore";
import { SwipeToRemove } from "../components/SwipeToRemove";
import { PlanSheetItems } from "../components/PlanSheetItems";
import { useSheetLock, SHEET_SCROLL_STYLE } from "../lib/useSheetLock";
import { onAuthChange } from "../lib/accountStore";

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
        <span className="font-semibold text-[15px] leading-snug text-ink">{booking.location?.label ?? ""}</span>
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

function ViewBookingSheet({
  booking,
  onClose,
}: {
  booking: SavedBooking | null;
  onClose: () => void;
}) {
  const open = !!booking;
  // Nothing behind the sheet can be scrolled or touched while it's open.
  useSheetLock(open);

  // Drag-to-close, as on the home page's sheets: the handle bar tracks a
  // downward drag, and letting go past 110px closes the sheet — otherwise
  // it springs back.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const dragYRef = useRef(0);
  function handleDown(e: React.PointerEvent) {
    setDragging(true);
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleMove(e: React.PointerEvent) {
    if (!dragging) return;
    dragYRef.current = Math.max(0, e.clientY - startY.current);
    setDragY(dragYRef.current);
  }
  function handleUp() {
    setDragging(false);
    if (dragYRef.current > 110) onClose();
    dragYRef.current = 0;
    setDragY(0);
  }
  const items = booking ? Object.entries(booking.items) : [];

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
          height: "92vh",
          maxHeight: "92vh",
          transform: open ? `translateY(${dragY}px)` : "translateY(100%)",
          transition: dragging ? "none" : "transform 300ms",
        }}
      >
        <div
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8, flexShrink: 0, touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
        >
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
        <div style={{ overflowY: "auto", padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: 16, flex: "1 1 auto", minHeight: 0, ...SHEET_SCROLL_STYLE }}>
          <PlanSheetItems items={items} area={booking?.location?.name} time={booking?.time} vibe={booking?.vibe} />
        </div>
      </div>
    </div>
  );
}

export default function Bookings() {
  const [bookings, setBookings] = useState<SavedBooking[] | null>(null);
  const [viewing, setViewing] = useState<SavedBooking | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The last card swiped away. It's only deleted for real once the Undo
  // toast goes (or on leaving the page), so a slip is easy to take back.
  const [removed, setRemoved] = useState<SavedBooking | null>(null);
  const pendingDelete = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  function commitDelete() {
    const pending = pendingDelete.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDelete.current = null;
    setRemoved(null);
    deleteBooking(pending.id).then(({ error }) => {
      if (error) setLoadError(`Couldn't remove that plan: ${error}`);
    });
  }

  function remove(booking: SavedBooking) {
    commitDelete(); // one undo at a time
    setBookings((list) => (list ? list.filter((b) => b.id !== booking.id) : list));
    setRemoved(booking);
    pendingDelete.current = { id: booking.id, timer: setTimeout(commitDelete, 5000) };
  }

  function undoRemove() {
    const pending = pendingDelete.current;
    if (!pending || !removed) return;
    clearTimeout(pending.timer);
    pendingDelete.current = null;
    const restored = removed;
    setBookings((list) => (list ? [...list, restored].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : list));
    setRemoved(null);
  }

  // Leaving the page (or closing the tab) finishes a pending removal.
  useEffect(() => {
    window.addEventListener("pagehide", commitDelete);
    return () => {
      window.removeEventListener("pagehide", commitDelete);
      commitDelete();
    };
  }, []);

  // From the account when signed in, this device when not — and reloaded
  // whenever someone signs in or out.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { bookings: list, error } = await listBookings();
      if (cancelled) return;
      setBookings(list || []);
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
            <SwipeToRemove key={b.id} onRemove={() => remove(b)}>
              <BookingCard booking={b} />
            </SwipeToRemove>
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
                <SwipeToRemove key={b.id} onRemove={() => remove(b)}>
                  <BookingCard booking={b} onView={setViewing} cardBg="#FFFFFF" />
                </SwipeToRemove>
              ))
            )}
          </div>
        </div>
      )}

      {removed && (
        <div
          role="status"
          // Clears the nav bar (NavBar.tsx: 20px + safe area below a ~76px
          // pill) and sits above it, so it's never hidden behind it.
          style={{ position: "fixed", left: 21, right: 21, bottom: "calc(env(safe-area-inset-bottom, 0px) + 112px)", zIndex: 101, borderRadius: 999, background: "#111111", color: "#FFFFFF", padding: "10px 10px 10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}
        >
          <span>{removed.confirmed ? "Booking" : "Draft"} removed</span>
          <button onClick={undoRemove} style={{ borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "none", background: "#DEEB3A", color: "#111111", cursor: "pointer" }}>
            Undo
          </button>
        </div>
      )}

      <ViewBookingSheet booking={viewing} onClose={() => setViewing(null)} />
    </main>
  );
}

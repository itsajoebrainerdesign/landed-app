"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CTA_GRADIENT } from "./lib/constants";

function BookingsIcon({ color }: { color: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  );
}

function AccountIcon({ color }: { color: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/bookings", label: "Bookings", icon: BookingsIcon, match: (p: string) => p.startsWith("/bookings") },
  { href: "/account", label: "Account", icon: AccountIcon, match: (p: string) => p.startsWith("/account") },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  function renderTab({ href, label, icon: Icon, match }: (typeof NAV_ITEMS)[number]) {
    const active = match(pathname || "/");
    return (
      <Link
        key={href}
        href={href}
        aria-label={label}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 48,
          height: 48,
          borderRadius: 999,
          background: active ? "#FFFFFF" : "transparent",
          boxShadow: active ? "0 2px 8px rgba(0,0,0,0.1)" : "none",
          flexShrink: 0,
        }}
      >
        <Icon color={active ? "#111111" : "#6B6558"} />
      </Link>
    );
  }

  // On the booking page itself, "+" saves the current plan as a draft and
  // resets in place (via a custom event page.tsx listens for) rather than
  // navigating, since navigating to the same route wouldn't remount it.
  // From anywhere else, it just takes you to the booking page fresh.
  function handleAddBooking() {
    if (pathname === "/") {
      window.dispatchEvent(new Event("landed:new-booking"));
    } else {
      router.push("/");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        // This 21 must match every page's own edge padding (currently
        // `px-[21px]` on the <main> in page.tsx, bookings/page.tsx, and
        // account/page.tsx) and the Search/Explore toggle's own left/right
        // in page.tsx, or the nav bar's edges stop lining up with the
        // content above it. Nothing enforces this automatically — if you
        // change one, change all of them.
        left: 21,
        right: 21,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 8,
          width: "100%",
          borderRadius: 999,
          background: "rgba(255,255,255,0.35)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,0.5)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          pointerEvents: "auto",
        }}
      >
        <button
          onClick={handleAddBooking}
          aria-label="Add booking"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            minWidth: 56,
            borderRadius: "50%",
            background: CTA_GRADIENT,
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span className="font-semibold text-[24px] leading-none" style={{ color: "#111111" }}>+</span>
        </button>
        <div style={{ flex: "1 1 auto" }} />
        {renderTab(NAV_ITEMS[0])}
        {renderTab(NAV_ITEMS[1])}
      </div>
    </div>
  );
}

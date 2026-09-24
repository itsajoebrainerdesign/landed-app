// Small inline icons used on plan item cards (address pin, phone, and the
// three placeholder photo-slot icons). Kept as plain inline SVG rather
// than an icon package since the set is small and fixed.

export function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#767766" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#767766" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function PhotoIcon({ kind }: { kind: "exterior" | "interior" | "crowd" }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth={2} opacity={0.65}>
      {kind === "exterior" && (
        <>
          <path d="M4 10l1-5h14l1 5" />
          <path d="M4 10v9a1 1 0 0 0 1 1h4v-6h6v6h4a1 1 0 0 0 1-1v-9" />
        </>
      )}
      {kind === "interior" && (
        <>
          <path d="M6 12V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5" />
          <path d="M4 12h16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z" />
          <path d="M6 18v2M18 18v2" />
        </>
      )}
      {kind === "crowd" && (
        <>
          <circle cx="8" cy="9" r="3" />
          <circle cx="16" cy="9" r="3" />
          <path d="M2 20c0-3 2.7-5 6-5s6 2 6 5M10 20c0-3 2.7-5 6-5" />
        </>
      )}
    </svg>
  );
}

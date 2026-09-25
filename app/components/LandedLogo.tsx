import { useId } from "react";

// The Landed logo — the ↘ arrow on a rounded square that fades from the
// accent colour to white — drawn as SVG so it follows the App colour set
// in Account (--accent). Traced from public/landed-icon.png, which is
// still used for the home-screen icons (those can't change colour).
export function LandedLogo({ size = 30 }: { size?: number }) {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 316 316" role="img" aria-label="Landed">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0.03 }} />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="306" height="306" rx="45" fill={`url(#${gradientId})`} />
      <polygon
        fill="#111111"
        points="89,57 213,181 213,78 252,117 252,249 118,249 82,212 187,212 62,87"
      />
    </svg>
  );
}

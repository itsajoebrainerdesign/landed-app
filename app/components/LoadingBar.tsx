"use client";

import { useEffect, useState } from "react";
import { CTA_GRADIENT } from "../lib/constants";

// Progress bar shown while live results are being found. A live search
// takes ~50 seconds and reports no progress, so the bar eases toward (but
// never reaches) the end on a curve tuned to that — about 60% at 20s, 90%
// at 50s — with a shimmer so it always looks alive.
//
// Progress is worked out from `startedAt` (when the search began), not
// from when the bar appeared, so leaving and coming back — e.g. switching
// to Explore and back to Search — carries on where it was.
const EXPECTED_MS = 22_000; // time constant: 1 - e^(-t/τ)

const progressAt = (startedAt: number) => 4 + 92 * (1 - Math.exp(-(Date.now() - startedAt) / EXPECTED_MS));

export function LoadingBar({ label, startedAt }: { label: string; startedAt: number }) {
  const [progress, setProgress] = useState(() => progressAt(startedAt));

  useEffect(() => {
    setProgress(progressAt(startedAt));
    const tick = window.setInterval(() => setProgress(progressAt(startedAt)), 250);
    return () => window.clearInterval(tick);
  }, [startedAt]);

  return (
    <div role="status" aria-live="polite" className="flex flex-col" style={{ gap: 8 }}>
      <span className="text-[13px] leading-snug" style={{ color: "#767676" }}>
        {label}
      </span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        style={{ position: "relative", height: 8, borderRadius: 999, background: "#EAE7DF", overflow: "hidden" }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${progress}%`,
            borderRadius: 999,
            background: CTA_GRADIENT,
            transition: "width 400ms ease-out",
            overflow: "hidden",
          }}
        >
          <div className="landed-loading-shimmer" />
        </div>
      </div>
      <style>{`
        .landed-loading-shimmer {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 40%;
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.65) 50%, rgba(255,255,255,0) 100%);
          animation: landed-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes landed-shimmer {
          from { transform: translateX(-100%); }
          to { transform: translateX(260%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .landed-loading-shimmer { animation: none; display: none; }
        }
      `}</style>
    </div>
  );
}

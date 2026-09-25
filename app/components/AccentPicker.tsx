"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ACCENT, getAccent, setAccent, hueToHex, hexToHue } from "../lib/accent";

// Account → App colour: one hue slider for the accent used in the
// gradients and buttons throughout the app. Saved on this device; changes
// apply straight away.
const RAINBOW = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => hueToHex(h)).join(", ")})`;

export function AccentPicker() {
  const [accent, setAccentState] = useState(DEFAULT_ACCENT);
  useEffect(() => setAccentState(getAccent()), []);

  function choose(hex: string) {
    setAccent(hex);
    setAccentState(hex.toUpperCase());
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="font-semibold text-[16px] text-ink">App colour</span>
      <div style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Preview of the gradient it'll use. */}
        <div style={{ height: 44, borderRadius: 999, background: "linear-gradient(100deg,#FFFFFF 0%,var(--accent-pale) 45%,var(--accent) 100%)", border: "1px solid rgba(0,0,0,0.06)" }} />
        <input
          type="range"
          className="landed-hue-slider"
          min={0}
          max={359}
          value={hexToHue(accent)}
          onChange={(e) => choose(hueToHex(Number(e.target.value)))}
          aria-label="App colour"
        />
        <style>{`
          .landed-hue-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 14px;
            border-radius: 999px;
            outline: none;
            cursor: pointer;
            background: ${RAINBOW};
          }
          .landed-hue-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: var(--accent);
            border: 3px solid #FFFFFF;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            cursor: pointer;
          }
          .landed-hue-slider::-moz-range-thumb {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: var(--accent);
            border: 3px solid #FFFFFF;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            cursor: pointer;
          }
          .landed-hue-slider::-moz-range-track {
            height: 14px;
            border-radius: 999px;
            background: ${RAINBOW};
          }
        `}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="text-[12px]" style={{ color: "#767766" }}>Saved on this device</span>
          {accent !== DEFAULT_ACCENT && (
            <button
              onClick={() => choose(DEFAULT_ACCENT)}
              style={{ fontSize: 12, fontWeight: 700, color: "#111111", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

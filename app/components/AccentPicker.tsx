"use client";

import { useEffect, useState } from "react";
import { ACCENT_PRESETS, DEFAULT_ACCENT, getAccent, setAccent } from "../lib/accent";

// Account → App colour: the accent used in the gradients and buttons
// throughout the app. Saved on this device; changes apply straight away.
export function AccentPicker() {
  const [accent, setAccentState] = useState(DEFAULT_ACCENT);
  useEffect(() => setAccentState(getAccent()), []);

  function choose(hex: string) {
    setAccent(hex);
    setAccentState(hex.toUpperCase());
  }

  const isPreset = ACCENT_PRESETS.some((p) => p.hex === accent);
  return (
    <div className="flex flex-col gap-4">
      <span className="font-semibold text-[16px] text-ink">App colour</span>
      <div
        style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
      >
        {/* Preview of the gradient it'll use. */}
        <div style={{ height: 44, borderRadius: 999, background: "linear-gradient(100deg,#FFFFFF 0%,var(--accent-pale) 45%,var(--accent) 100%)", border: "1px solid rgba(0,0,0,0.06)" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              onClick={() => choose(p.hex)}
              aria-label={p.name}
              aria-pressed={accent === p.hex}
              title={p.name}
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: p.hex,
                border: "none",
                cursor: "pointer",
                boxShadow: accent === p.hex ? "0 0 0 2px #FFFFFF, 0 0 0 4px #111111" : "inset 0 0 0 1px rgba(0,0,0,0.1)",
              }}
            />
          ))}
          {/* Any colour: the system colour picker, behind a rainbow swatch. */}
          <label
            title="Custom colour"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              position: "relative",
              overflow: "hidden",
              cursor: "pointer",
              background: isPreset ? "conic-gradient(#F5A8C4, #F7D84A, #DEEB3A, #7FE0B0, #8CCBF5, #C7A8F5, #F5A8C4)" : accent,
              boxShadow: !isPreset ? "0 0 0 2px #FFFFFF, 0 0 0 4px #111111" : "inset 0 0 0 1px rgba(0,0,0,0.1)",
            }}
          >
            <input
              type="color"
              aria-label="Custom colour"
              value={accent.toLowerCase()}
              onChange={(e) => choose(e.target.value)}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", padding: 0 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="text-[12px]" style={{ color: "#767766" }}>
            {isPreset ? ACCENT_PRESETS.find((p) => p.hex === accent)?.name : "Custom"} · saved on this device
          </span>
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

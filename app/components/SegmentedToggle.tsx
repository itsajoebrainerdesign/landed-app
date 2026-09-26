"use client";

// A slim switch between a few options (Now / Tonight / Tomorrow…), in the
// style of the Search/Explore switch: a white pill slides to the chosen
// option. Thinner and smaller, for the plan's settings.
export function SegmentedToggle<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  // What the choice is, for screen readers ("When", "Vibe", "Budget").
  label: string;
}) {
  const n = options.length;
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ position: "relative", display: "flex", padding: 3, height: 34, borderRadius: 999, background: "#EFEDE6" }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 3,
          bottom: 3,
          left: `calc(3px + ${index} * (100% - 6px) / ${n})`,
          width: `calc((100% - 6px) / ${n})`,
          borderRadius: 999,
          background: "#FFFFFF",
          boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
          transition: "left 280ms cubic-bezier(0.4,0,0.2,1)",
        }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={o.key === value}
          onClick={() => onChange(o.key)}
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            height: "100%",
            borderRadius: 999,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: o.key === value ? 700 : 500,
            color: o.key === value ? "#111111" : "#767766",
            fontFamily: "inherit",
            transition: "color 200ms",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

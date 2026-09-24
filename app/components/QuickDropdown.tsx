// The pill-shaped "When / Vibe / Budget" dropdown used on the booking
// flow's search summary. Generic over the option key type so it works
// for TimeKey, VibeKey, and BudgetKey alike without three near-identical
// copies.

export function QuickDropdown<T extends string>({
  label,
  menu,
  value,
  isOpen,
  onToggle,
  onSelect,
}: {
  label: string;
  menu: { key: T; label: string }[];
  value: T;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (key: T) => void;
}) {
  const currentLabel = menu.find((o) => o.key === value)?.label || label;
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <button
        onClick={onToggle}
        style={{ width: "100%", height: 44, borderRadius: 999, background: "#EAE7DF", border: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", cursor: "pointer" }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: "#111111" }}>{currentLabel}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8478" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#FFFFFF", borderRadius: 16, boxShadow: "0 10px 28px rgba(0,0,0,0.16)", overflow: "hidden", zIndex: 20 }}>
          {menu.map((opt, i) => {
            const selected = opt.key === value;
            return (
              <button
                key={opt.key}
                onClick={() => onSelect(opt.key)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", padding: "12px 16px", background: selected ? "#F1F3C4" : "none", border: "none", borderBottom: i < menu.length - 1 ? "1px solid #EFEFEF" : "none", fontFamily: "inherit", fontWeight: 600, fontSize: 14, color: "#111111", cursor: "pointer" }}
              >
                <span>{opt.label}</span>
                {selected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

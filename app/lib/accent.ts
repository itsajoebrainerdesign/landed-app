// The accent colour picked in Account, kept on this device. It's applied
// by setting --accent on <html> (see globals.css); layout.tsx also applies
// the saved one before the page paints, so there's no flash of green.

export const DEFAULT_ACCENT = "#DEEB3A";
const KEY = "landed_accent";
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: "Lime", hex: DEFAULT_ACCENT },
  { name: "Mint", hex: "#7FE0B0" },
  { name: "Sky", hex: "#8CCBF5" },
  { name: "Lilac", hex: "#C7A8F5" },
  { name: "Blush", hex: "#F5A8C4" },
  { name: "Peach", hex: "#F7B98A" },
  { name: "Sunshine", hex: "#F7D84A" },
];

export function getAccent(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && HEX_RE.test(saved)) return saved.toUpperCase();
  } catch {
    // storage unavailable
  }
  return DEFAULT_ACCENT;
}

export function setAccent(hex: string) {
  if (!HEX_RE.test(hex)) return;
  document.documentElement.style.setProperty("--accent", hex);
  try {
    if (hex.toUpperCase() === DEFAULT_ACCENT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, hex);
  } catch {
    // storage unavailable — still applies for this visit
  }
}

// Runs inline in <head> before first paint (keep it tiny and dependency-free).
export const ACCENT_BOOT_SCRIPT = `try{var a=localStorage.getItem("${KEY}");if(a&&/^#[0-9a-f]{6}$/i.test(a))document.documentElement.style.setProperty("--accent",a)}catch(e){}`;

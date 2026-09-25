// The accent colour picked in Account, kept on this device. It's applied
// by setting --accent on <html> (see globals.css); layout.tsx also applies
// the saved one before the page paints, so there's no flash of green.

export const DEFAULT_ACCENT = "#DEEB3A";
const KEY = "landed_accent";
const HEX_RE = /^#[0-9a-f]{6}$/i;

// The hue slider keeps the default's saturation and lightness and only
// turns the hue, so every choice is as bright as the original lime.
const SATURATION = 0.82;
const LIGHTNESS = 0.575;

export function hueToHex(hue: number): string {
  const c = (1 - Math.abs(2 * LIGHTNESS - 1)) * SATURATION;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = LIGHTNESS - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export function hexToHue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

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

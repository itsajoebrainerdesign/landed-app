import { PinIcon, PhoneIcon } from "./icons";
import { VenuePhotoTile } from "./VenuePhotoTile";
import { mapsUrl } from "../lib/urls";
import { telHref } from "../lib/format";
import type { CategoryOption } from "../lib/categoryOptions";

// A single venue card in "Your Plan" — the ✕ (remove) button only renders
// when onRemove is passed; `corner` fills the bottom-right (the carousel's
// position dots).
export function PlanItemCard({
  item,
  corner,
  onRemove,
  area,
}: {
  item: CategoryOption;
  // The plan's location name, for the address's Google Maps link.
  area?: string;
  corner?: React.ReactNode;
  onRemove?: () => void;
}) {
  const meta = item && item.meta ? item.meta : [];
  return (
    // Fills its height: in a carousel, every option is as tall as the
    // tallest, with the price bar kept at the bottom.
    <div style={{ borderRadius: 20, overflow: "hidden", width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remove from plan"
          style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, background: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 5 }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111111", lineHeight: 1 }}>✕</span>
        </button>
      )}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "#F7F5EE", flex: "1 1 auto" }}>
        <span style={{ alignSelf: "flex-start", borderRadius: 999, padding: "6px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: item.tagBg, color: "#111111" }}>
          {item.tag}
        </span>
        <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{item.title}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <a href={mapsUrl(item.title, area)} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <PinIcon />
            <span style={{ fontSize: 11, color: "#767766" }}>{item.address}</span>
          </a>
          <a href={telHref(item.phone)} style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <PhoneIcon />
            <span style={{ fontSize: 11, color: "#767766" }}>{item.phone}</span>
          </a>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {meta.map((m, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 600, borderRadius: 999, padding: "4px 10px", background: "#DFDACB", color: "#111111" }}>
              {m}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <VenuePhotoTile kind="exterior" photo={item.photos?.[0]} height={140} background={item.tagBg} width={800} />
        </div>
      </div>
      <div style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#EAE7DF" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{item.price}</span>
          <span style={{ fontSize: 12, color: "#3E3E3A" }}>{item.unit}</span>
        </div>
        {corner}
      </div>
    </div>
  );
}

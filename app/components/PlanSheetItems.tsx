import { PhoneIcon } from "./icons";
import { SaveInMapsLink } from "./SaveInMapsLink";
import { CTA_GRADIENT } from "../lib/constants";
import { planItemLink, AFFILIATE_LINKS_ON } from "../lib/urls";
import { telHref } from "../lib/format";

type SheetItem = {
  tag: string;
  tagBg: string;
  title: string;
  price: string;
  unit: string;
  phone?: string;
  id?: string;
  lat?: number;
  lng?: number;
  website?: string;
  hasApiBooking?: boolean;
};

// The venues in a plan sheet — shared by the booking sheet on the home
// page and a saved booking's sheet on Bookings, so the two always match.
export function PlanSheetItems({
  items,
  area,
  time,
  vibe,
}: {
  items: [string, SheetItem][];
  area?: string;
  time?: string;
  vibe?: string;
}) {
  return (
    <>
      {items.map(([cat, item]) => {
        const link = planItemLink(cat, item, area, time, vibe);
        return (
          <div key={cat} style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ alignSelf: "flex-start", borderRadius: 999, padding: "6px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: item.tagBg, color: "#111111" }}>
              {item.tag}
            </span>
            <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>{item.title}</span>
            {item.phone && (
              <a href={telHref(item.phone)} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                <PhoneIcon />
                <span style={{ fontSize: 12, color: "#767766" }}>{item.phone}</span>
              </a>
            )}
            <SaveInMapsLink venue={item} area={area} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 16, color: "#111111" }}>{item.price}</span>
                <span style={{ fontSize: 12, color: "#3E3E3A" }}>{item.unit}</span>
              </div>
              {item.hasApiBooking ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "8px 14px", fontSize: 11, fontWeight: 700, background: "#DEEB3A", color: "#111111" }}>
                  ✓ Booked
                </span>
              ) : (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ borderRadius: 999, padding: "8px 14px", fontSize: 11, fontWeight: 700, background: CTA_GRADIENT, color: "#111111", textDecoration: "none" }}
                >
                  {link.label}
                </a>
              )}
            </div>
          </div>
        );
      })}
      {/* Affiliate disclosure (UK advertising rules), once affiliate links are live. */}
      {AFFILIATE_LINKS_ON && items.some(([cat]) => cat === "stay") && (
        <span style={{ fontSize: 11, color: "#767766" }}>We may earn a commission if you book a stay through these links.</span>
      )}
    </>
  );
}

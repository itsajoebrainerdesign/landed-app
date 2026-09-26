import { PhoneIcon } from "./icons";
import { SaveInMapsLink } from "./SaveInMapsLink";
import { CTA_GRADIENT } from "../lib/constants";
import { planItemLink } from "../lib/urls";
import { telHref } from "../lib/format";
import { partnerLink, travelLinks } from "../lib/affiliates";
import { withCategoryStyle } from "../lib/categoryOptions";

type SheetItem = {
  tag: string;
  tagBg: string;
  title: string;
  price: string;
  unit: string;
  phone?: string;
  address?: string;
  id?: string;
  lat?: number;
  lng?: number;
  website?: string;
  partnerUrl?: string;
  hasApiBooking?: boolean;
};

// The venues in a plan sheet — shared by the booking sheet on the home
// page and a saved booking's sheet on Bookings, so the two always match.
export function PlanSheetItems({
  items,
  area,
  time,
  vibe,
  place,
  travel = "car",
}: {
  items: [string, SheetItem][];
  area?: string;
  time?: string;
  vibe?: string;
  // The plan's location, for "Getting there".
  place?: { lat?: number; lng?: number; name?: string };
  // How they're travelling (transit / car).
  travel?: string;
}) {
  // Train, coach, car hire and parking from the travel partners that are
  // set up (nothing shows until one is).
  const travelOptions = items.length > 0 && place ? travelLinks(place, travel) : [];
  const tracked = travelOptions.length > 0 || items.some(([cat, item]) => !item.hasApiBooking && partnerLink(cat, item, { time, vibe }));
  return (
    <>
      {items.map(([cat, saved]) => {
        const item = withCategoryStyle(cat, saved);
        // Through the venue's confirmed partner page when there is one
        // (and that programme is set up); otherwise the venue's website /
        // ticket search / directions.
        const link = partnerLink(cat, item, { time, vibe }) ?? planItemLink(cat, item, area);
        return (
          // The card's action runs the full width of its bottom edge.
          // flexShrink 0: in the sheet's scrolling column, a card with
          // overflow hidden would otherwise be squashed to fit.
          <div key={cat} style={{ borderRadius: 20, background: "#F7F5EE", overflow: "hidden", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
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
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 16, color: "#111111" }}>{item.price}</span>
                <span style={{ fontSize: 12, color: "#3E3E3A" }}>{item.unit}</span>
              </div>
            </div>
            {item.hasApiBooking ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 52, fontSize: 15, fontWeight: 700, background: "var(--accent)", color: "#111111" }}>
                ✓ Booked
              </span>
            ) : (
              <a
                href={link.href}
                target="_blank"
                rel={link.sponsored ? "noopener noreferrer sponsored" : "noopener noreferrer"}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 52, fontSize: 15, fontWeight: 700, letterSpacing: "0.01em", background: CTA_GRADIENT, color: "#111111", textDecoration: "none" }}
              >
                {link.label}
              </a>
            )}
          </div>
        );
      })}
      {travelOptions.length > 0 && (
        <div style={{ borderRadius: 20, background: "#F7F5EE", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 18, color: "#111111" }}>Getting there</span>
          {travelOptions.map((t) => (
            <a
              key={t.detail}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer sponsored"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textDecoration: "none", color: "#111111" }}
            >
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</span>
                <span style={{ fontSize: 12, color: "#767766" }}>{t.detail}</span>
              </span>
              <span style={{ borderRadius: 999, padding: "8px 14px", fontSize: 11, fontWeight: 700, background: CTA_GRADIENT }}>Open ↗</span>
            </a>
          ))}
        </div>
      )}
      {/* Affiliate disclosure (UK advertising rules), whenever a tracked
          link is showing. */}
      {tracked && (
        <span style={{ fontSize: 11, color: "#767766" }}>We may earn a commission if you book through some of these links.</span>
      )}
    </>
  );
}

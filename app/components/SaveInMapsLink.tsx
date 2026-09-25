import { PinIcon } from "./icons";
import { placeMapsUrl } from "../lib/urls";

// Opens the venue's own Google Maps page, where the person taps Save to
// keep it on their map. (Google has no way for an app to save places for
// them, so it's one tap per venue.)
export function SaveInMapsLink({ venue, area }: { venue: { title: string; id?: string }; area?: string }) {
  return (
    <a
      href={placeMapsUrl(venue, area)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 12px", fontSize: 11, fontWeight: 700, border: "1.5px solid #B9B4A6", color: "#111111", background: "#FFFFFF", textDecoration: "none" }}
    >
      <PinIcon />
      Save in Maps ↗
    </a>
  );
}

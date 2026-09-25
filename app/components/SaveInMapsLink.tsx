"use client";

import { useEffect, useState } from "react";
import { PinIcon } from "./icons";
import { placeMapsUrl, appleMapsUrl, geoUrl } from "../lib/urls";

type Venue = { title: string; id?: string; address?: string; lat?: number; lng?: number };
type Platform = "ios" | "android" | "other";

// A web page can't tell which map apps are installed, so:
// - iPhone/iPad: Apple Maps is always there and there's no default maps
//   app setting, so both are offered side by side.
// - Android: a geo: link opens the phone's default maps app (or asks).
// - Anything else: Google Maps in the browser.
// Each opens the venue's place page, where the person taps Save.
function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

const PILL: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 12px", fontSize: 11, fontWeight: 700, border: "1.5px solid #B9B4A6", color: "#111111", background: "#FFFFFF", textDecoration: "none" };

export function SaveInMapsLink({ venue, area }: { venue: Venue; area?: string }) {
  // Decided after mounting, so the server render and first client render match.
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => setPlatform(detectPlatform()), []);

  if (platform === "ios") {
    return (
      <div style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#767766" }}>
          <PinIcon />
          Save in
        </span>
        <a href={appleMapsUrl(venue, area)} target="_blank" rel="noopener noreferrer" style={PILL}>
          Apple Maps ↗
        </a>
        <a href={placeMapsUrl(venue, area)} target="_blank" rel="noopener noreferrer" style={PILL}>
          Google Maps ↗
        </a>
      </div>
    );
  }
  return (
    <a
      href={platform === "android" ? geoUrl(venue, area) : placeMapsUrl(venue, area)}
      target={platform === "android" ? undefined : "_blank"}
      rel="noopener noreferrer"
      style={{ ...PILL, alignSelf: "flex-start" }}
    >
      <PinIcon />
      Save in Maps ↗
    </a>
  );
}

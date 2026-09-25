"use client";

import { useState } from "react";
import { PhotoIcon } from "./icons";
import type { VenuePhoto } from "../lib/categoryOptions";

// One photo slot on a venue card: the Google Places photo when there is
// one (with the photographer's name, which Google requires), otherwise the
// placeholder icon on the category colour.
export function VenuePhotoTile({
  photo,
  kind,
  height,
  background,
  width = 400,
}: {
  photo?: VenuePhoto;
  kind: "exterior" | "interior" | "crowd";
  height: number;
  background: string;
  // Roughly how wide the tile shows, in CSS pixels — picks the image size.
  width?: number;
}) {
  const [failed, setFailed] = useState(false);
  const show = photo && !failed;
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, height, borderRadius: 12, overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background, border: "1px solid rgba(0,0,0,0.12)" }}>
      {show ? (
        <>
          {/* Plain <img>: the image already comes resized from /api/photo. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photo?name=${encodeURIComponent(photo.name)}&w=${width}`}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {photo.author && (
            <span style={{ position: "absolute", left: 4, right: 4, bottom: 3, fontSize: 7, lineHeight: 1.2, color: "#FFFFFF", textShadow: "0 0 3px rgba(0,0,0,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {photo.author}
            </span>
          )}
        </>
      ) : (
        <PhotoIcon kind={kind} />
      )}
    </div>
  );
}

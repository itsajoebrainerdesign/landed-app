import type { MetadataRoute } from "next";

// The web app manifest (served at /manifest.webmanifest). This is what
// makes Landed installable: "Add to Home Screen" on iPhone, "Install app"
// on Android/Chrome. It then opens full-screen with its own icon, no
// browser bars.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Landed",
    short_name: "Landed",
    description: "Know what's here, right now.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

"use client";

import { useEffect } from "react";

// Registers public/sw.js — production only, so it never caches pages
// under `npm run dev`.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[Landed] service worker not registered", err));
  }, []);
  return null;
}

"use client";

import { useEffect } from "react";

// While a bottom sheet is open, the page behind it mustn't move. iOS
// Safari ignores `overflow: hidden` on <body> for touch scrolling, so the
// body is pinned in place with position: fixed (offset by the current
// scroll so nothing visibly jumps) and put back exactly where it was when
// the sheet closes. Several sheets can hold the lock at once.
let holders = 0;
let savedY = 0;
let savedStyle = "";

export function useSheetLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (holders++ === 0) {
      savedY = window.scrollY;
      savedStyle = body.getAttribute("style") ?? "";
      Object.assign(body.style, {
        position: "fixed",
        top: `-${savedY}px`,
        left: "0",
        right: "0",
        width: "100%",
        overflow: "hidden",
      });
    }
    return () => {
      if (--holders > 0) return;
      body.setAttribute("style", savedStyle);
      window.scrollTo({ top: savedY, behavior: "instant" });
    };
  }, [active]);
}

// For a sheet's own scroll area: reaching its top or bottom doesn't hand
// the scroll on to the page (or bounce it) behind.
export const SHEET_SCROLL_STYLE = { overscrollBehavior: "contain" } as const;

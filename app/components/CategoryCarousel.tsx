"use client";

import { useEffect, useRef } from "react";
import { PlanItemCard } from "./PlanItemCard";
import type { CategoryOption } from "../lib/categoryOptions";

// One category in "Your Plan": its options as separate cards side by side,
// swiped left and right (scroll-snap, so it's the browser's own smooth
// swipe). The strip runs the full width of the screen, so the next card
// slides in from the edge. Whichever card is showing is the plan's pick.
// Dots underneath show where you are.
//
// EDGE must match the page's side padding (px-[21px] on <main>).
const EDGE = 21;
const GAP = 12;
export function CategoryCarousel({
  options,
  selectedId,
  onSelect,
  onRemove,
  area,
}: {
  options: CategoryOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRemove: () => void;
  area?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === selectedId));

  // Keep the showing card in line with the pick when it changes from
  // outside (Vibe, Budget, a loaded draft, new results) — and when the
  // carousel changes size (rotating the phone), since its scroll position
  // is in pixels.
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  // Distance from one card to the next.
  function step(el: HTMLDivElement): number {
    const first = el.children[1] as HTMLElement | undefined; // [0] is the <style>
    return first ? first.offsetWidth + GAP : 0;
  }
  function alignToSelected() {
    const el = scrollerRef.current;
    if (!el || step(el) === 0) return;
    const target = selectedIndexRef.current * step(el);
    if (Math.abs(el.scrollLeft - target) > 2) el.scrollTo({ left: target, behavior: "instant" });
  }
  useEffect(alignToSelected, [selectedIndex, options.length]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => alignToSelected());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Once a swipe settles, the card showing becomes the pick.
  function onScroll() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = scrollerRef.current;
      if (!el || step(el) === 0) return;
      const index = Math.round(el.scrollLeft / step(el));
      const option = options[Math.min(options.length - 1, Math.max(0, index))];
      if (option && option.id !== selectedId) onSelect(option.id);
    }, 120);
  }

  const dots =
    options.length > 1 ? (
      <div aria-label={`Option ${selectedIndex + 1} of ${options.length}`} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}>
        {options.map((o, i) => (
          <span
            key={o.id}
            style={{
              width: i === selectedIndex ? 14 : 5,
              height: 5,
              borderRadius: 999,
              background: i === selectedIndex ? "#111111" : "#B9B4A6",
              transition: "width 200ms, background 200ms",
            }}
          />
        ))}
      </div>
    ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="landed-carousel"
        style={{
          display: "flex",
          gap: GAP,
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          overscrollBehaviorX: "contain",
          scrollbarWidth: "none",
          // Full screen width, with the cards still lined up with the page.
          width: "100vw",
          marginLeft: "calc(50% - 50vw)",
          paddingInline: EDGE,
          scrollPaddingInline: EDGE,
        }}
      >
        <style>{`.landed-carousel::-webkit-scrollbar { display: none; }`}</style>
        {options.map((option) => (
          <div key={option.id} style={{ flex: `0 0 calc(100vw - ${EDGE * 2}px)`, scrollSnapAlign: "start", scrollSnapStop: "always" }}>
            <PlanItemCard item={option} area={area} onRemove={onRemove} />
          </div>
        ))}
      </div>
      {dots}
    </div>
  );
}

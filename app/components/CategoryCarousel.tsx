"use client";

import { useEffect, useRef } from "react";
import { PlanItemCard } from "./PlanItemCard";
import type { CategoryOption } from "../lib/categoryOptions";

// One category in "Your Plan": its options side by side, swiped left and
// right (scroll-snap, so it's the browser's own smooth swipe). Whichever
// card is showing is the plan's pick. Dots in the card's corner show
// where you are.
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
  // outside (Vibe, Budget, a loaded draft, new results).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = selectedIndex * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2) el.scrollTo({ left: target, behavior: "instant" });
  }, [selectedIndex, options.length]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Once a swipe settles, the card showing becomes the pick.
  function onScroll() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = scrollerRef.current;
      if (!el || el.clientWidth === 0) return;
      const index = Math.round(el.scrollLeft / el.clientWidth);
      const option = options[Math.min(options.length - 1, Math.max(0, index))];
      if (option && option.id !== selectedId) onSelect(option.id);
    }, 120);
  }

  const dots =
    options.length > 1 ? (
      <div aria-label={`Option ${selectedIndex + 1} of ${options.length}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {options.map((o, i) => (
          <span
            key={o.id}
            style={{
              width: i === selectedIndex ? 18 : 7,
              height: 7,
              borderRadius: 999,
              background: i === selectedIndex ? "#111111" : "#B9B4A6",
              transition: "width 200ms, background 200ms",
            }}
          />
        ))}
      </div>
    ) : null;

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="landed-carousel"
      style={{
        display: "flex",
        overflowX: "auto",
        scrollSnapType: "x mandatory",
        overscrollBehaviorX: "contain",
        scrollbarWidth: "none",
        borderRadius: 20,
      }}
    >
      <style>{`.landed-carousel::-webkit-scrollbar { display: none; }`}</style>
      {options.map((option) => (
        <div key={option.id} style={{ flex: "0 0 100%", scrollSnapAlign: "start", scrollSnapStop: "always" }}>
          <PlanItemCard item={option} area={area} corner={dots} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

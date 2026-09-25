"use client";

import { useEffect, useRef, useState } from "react";
import { PlanItemCard } from "./PlanItemCard";
import type { CategoryOption } from "../lib/categoryOptions";

// One category in "Your Plan": its options as separate cards on a strip
// that runs the full width of the screen, swiped left and right
// (scroll-snap, so it's the browser's own smooth swipe). The cards either
// side peek in at the edges, faded, to show there's more. Whichever card
// is centred is the plan's pick; dots underneath show where you are.
//
// It loops endlessly: the options are laid out many times over, and each
// time a swipe settles it jumps (invisibly — the cards are identical) to
// the same card in the middle copy. With 4 copies either side, even a
// run of quick swipes never reaches the end before it recentres.

// How far each card sits in from the screen edge; with the gap, this is
// how much of the neighbouring cards shows (INSET - GAP).
const INSET = 34;
const GAP = 12;
const COPIES = 9; // odd, so there is a middle copy

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
  const count = options.length;
  const loops = count > 1;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === selectedId));
  // The strip: the options three times over when looping.
  const strip = loops ? Array.from({ length: COPIES }, () => options).flat() : options;
  const MIDDLE = Math.floor(COPIES / 2);
  const home = (index: number) => (loops ? MIDDLE * count + index : index); // position in the middle copy
  const inMiddle = (position: number) => position >= MIDDLE * count && position < (MIDDLE + 1) * count;

  // The card nearest the centre right now (updates while swiping, for the
  // fading and the dots).
  const [centred, setCentred] = useState(home(selectedIndex));

  function step(el: HTMLDivElement): number {
    const first = el.children[0] as HTMLElement | undefined;
    return first ? first.offsetWidth + GAP : 0;
  }
  function jumpTo(position: number) {
    const el = scrollerRef.current;
    if (!el || step(el) === 0) return;
    el.scrollTo({ left: position * step(el), behavior: "instant" });
    setCentred(position);
  }

  // Line up with the pick when it changes from outside (Vibe, Budget, a
  // loaded draft, new results) or the strip is resized (rotating the
  // phone — scroll positions are in pixels).
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  function alignToSelected() {
    const el = scrollerRef.current;
    if (!el || step(el) === 0) return;
    // Already there: on the pick, in the middle copy, and snapped.
    const target = home(selectedIndexRef.current);
    if (Math.abs(el.scrollLeft - target * step(el)) > 2) jumpTo(target);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(alignToSelected, [selectedIndex, count]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Width only — heights change as photos load, which mustn't pull the
    // strip back mid-swipe.
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      alignToSelected();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el || step(el) === 0) return;
    setCentred(Math.round(el.scrollLeft / step(el)));
    // Once the swipe settles: loop back to the middle copy if needed, and
    // make the centred card the pick.
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const position = Math.round(el.scrollLeft / step(el));
      const index = ((position % count) + count) % count;
      if (loops && !inMiddle(position)) jumpTo(home(index));
      const option = options[index];
      if (option && option.id !== selectedId) onSelect(option.id);
    }, 150);
  }

  const dotIndex = ((centred % count) + count) % count;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Outside the strip: step() measures the strip's first child. */}
      <style>{`.landed-carousel::-webkit-scrollbar { display: none; }`}</style>
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
          // Full screen width; the padding centres the first/last card.
          width: "100vw",
          marginLeft: "calc(50% - 50vw)",
          paddingInline: INSET,
        }}
      >
        {strip.map((option, position) => (
          <div
            key={`${position}-${option.id}`}
            style={{
              flex: `0 0 calc(100vw - ${INSET * 2}px)`,
              scrollSnapAlign: "center",
              scrollSnapStop: "always",
              opacity: position === centred ? 1 : 0.4,
              transition: "opacity 200ms",
            }}
            // The copies are only there for looping — keep them out of the
            // accessibility tree.
            aria-hidden={loops && !inMiddle(position) ? true : undefined}
          >
            <PlanItemCard item={option} area={area} onRemove={onRemove} />
          </div>
        ))}
      </div>
      {count > 1 && (
        <div aria-label={`Option ${dotIndex + 1} of ${count}`} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}>
          {options.map((o, i) => (
            <span
              key={o.id}
              style={{
                width: i === dotIndex ? 14 : 5,
                height: 5,
                borderRadius: 999,
                background: i === dotIndex ? "#111111" : "#B9B4A6",
                transition: "width 200ms, background 200ms",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

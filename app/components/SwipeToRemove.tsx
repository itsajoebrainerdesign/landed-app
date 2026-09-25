"use client";

import { useRef, useState, type ReactNode } from "react";

// Swipe a card left to reveal a Remove button behind it; swipe far enough
// and it removes straight away. Vertical scrolling is left to the browser
// (touch-action: pan-y), so only sideways drags move the card.
const REVEAL = 88; // how far the card rests open, in px
const DRAG_START = 8; // movement before a drag counts as a swipe, not a tap

export function SwipeToRemove({ children, onRemove, radius = 20 }: { children: ReactNode; onRemove: () => void; radius?: number }) {
  const [offset, setOffsetState] = useState(0);
  // Mirrors `offset` so pointer-up sees the latest drag even when it lands
  // before React re-renders (a quick flick).
  const offsetRef = useRef(0);
  const setOffset = (v: number) => {
    offsetRef.current = v;
    setOffsetState(v);
  };
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; offset: number } | null>(null);
  const swiped = useRef(false);

  function remove() {
    setRemoving(true);
    setOffset(-(wrapRef.current?.offsetWidth ?? 400));
    setTimeout(onRemove, 200);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (removing) return;
    start.current = { x: e.clientX, y: e.clientY, offset: offsetRef.current };
    swiped.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!swiped.current) {
      // Mostly vertical: it's a scroll, not a swipe.
      if (Math.abs(dy) > DRAG_START && Math.abs(dy) > Math.abs(dx)) {
        start.current = null;
        return;
      }
      if (Math.abs(dx) < DRAG_START) return;
      swiped.current = true;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setOffset(Math.min(0, s.offset + dx));
  }
  function onPointerUp() {
    const s = start.current;
    start.current = null;
    if (!s || !swiped.current) return;
    setDragging(false);
    const width = wrapRef.current?.offsetWidth ?? 400;
    const at = offsetRef.current;
    if (at < -width * 0.55) remove();
    else setOffset(at < -REVEAL / 2 ? -REVEAL : 0);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", borderRadius: radius, overflow: "hidden" }}>
      <button
        onClick={remove}
        aria-label="Remove"
        tabIndex={offset < 0 ? 0 : -1}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: Math.max(REVEAL, -offset), visibility: offset < 0 ? "visible" : "hidden", border: "none", background: "#D9412B", color: "#FFFFFF", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        Remove
      </button>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // A swipe that ends over a button or link mustn't also press it;
        // a tap on an open card just closes it.
        onClickCapture={(e) => {
          if (swiped.current) {
            // The click a mouse fires at the end of its drag.
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          } else if (offsetRef.current !== 0) {
            e.preventDefault();
            e.stopPropagation();
            if (!removing) setOffset(0);
          }
        }}
        style={{
          position: "relative",
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 200ms ease",
          touchAction: "pan-y",
          userSelect: dragging ? "none" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

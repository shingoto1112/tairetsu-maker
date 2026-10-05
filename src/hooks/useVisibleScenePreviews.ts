import { useLayoutEffect, useState, type RefObject } from "react";
import type { FormationFrame } from "../types";

/** Keep every card mounted for scrolling, keyboard navigation and presence.
 * Only the expensive preview contents are limited to the viewport + 100px. */
export function useVisibleScenePreviews(
  listRef: RefObject<HTMLDivElement>, frames: FormationFrame[], collapsed: boolean,
) {
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root || collapsed) { setVisible(new Set()); return; }
    const cards = [...root.querySelectorAll<HTMLElement>("[data-thumbnail-frame-id]")];
    if (typeof IntersectionObserver === "undefined") {
      setVisible(new Set(frames.map(frame => frame.id))); return;
    }
    const bounds = root.getBoundingClientRect();
    const initial = new Set<string>();
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (box.bottom >= bounds.top - 100 && box.top <= bounds.bottom + 100 &&
          box.right >= bounds.left - 100 && box.left <= bounds.right + 100) initial.add(card.dataset.thumbnailFrameId!);
    }
    setVisible(initial);
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      setVisible(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.thumbnailFrameId!;
          if (entry.isIntersecting) next.add(id); else next.delete(id);
        }
        return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next;
      });
    }, { root, rootMargin: "100px" });
    cards.forEach(card => observer.observe(card));
    return () => { active = false; observer.disconnect(); };
  }, [listRef, frames, collapsed]);
  return visible;
}

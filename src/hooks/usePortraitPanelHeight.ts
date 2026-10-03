import { useLayoutEffect, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from "react";

export const PORTRAIT_PANEL_KEY = "stageflow.ui.portraitPanel.v1";
export const portraitPanelBounds = (height: number, gap: number) => {
  const stageMinimum = Math.min(320, height * 0.35);
  const max = Math.max(0, Math.min(height * 0.65, height - gap - stageMinimum));
  const min = Math.min(280, max);
  // H is the workspace's inner height, excluding toolbar and workspace padding.
  const initial = Math.min(460, Math.max(320, height * 0.40));
  return { min, max, defaultHeight: Math.min(max, Math.max(min, initial)) };
};
export const readPortraitPanelRatio = (): number | null => {
  try {
    const value = JSON.parse(localStorage.getItem(PORTRAIT_PANEL_KEY) ?? "null");
    return value?.version === 1 && typeof value.ratio === "number" && Number.isFinite(value.ratio) && value.ratio > 0 && value.ratio <= 0.65 ? value.ratio : null;
  } catch { return null; }
};

export const usePortraitPanelHeight = (panelRef: RefObject<HTMLElement>, portrait: boolean, keyboardOpen: boolean) => {
  const [initialRatio] = useState(readPortraitPanelRatio);
  const ratio = useRef(initialRatio);
  const metrics = useRef({ height: 0, gap: 8, ...portraitPanelBounds(0, 8) });
  const value = useRef(0);
  const drag = useRef<{ id: number; y: number; x: number; start: number; element: HTMLElement; moved: boolean; time: number } | null>(null);
  const tap = useRef<{ time: number; x: number; y: number } | null>(null);
  const raf = useRef(0);
  const [aria, setAria] = useState({ min: 0, max: 0, value: 0 });
  const apply = (height: number) => {
    value.current = Math.min(metrics.current.max, Math.max(metrics.current.min, height));
    panelRef.current?.style.setProperty("--portrait-panel-height", `${value.current}px`);
  };
  const publish = () => setAria({ min: Math.round(metrics.current.min), max: Math.round(metrics.current.max), value: Math.round(value.current) });
  const cancel = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    const current = drag.current;
    drag.current = null;
    if (current) {
      apply(current.start);
      if (current.element.hasPointerCapture?.(current.id)) current.element.releasePointerCapture(current.id);
      publish();
    }
    tap.current = null;
  };
  const persist = (reset = false) => {
    if (keyboardOpen || !portrait || metrics.current.height <= 0) return;
    ratio.current = reset ? null : value.current / metrics.current.height;
    try {
      if (reset) localStorage.removeItem(PORTRAIT_PANEL_KEY);
      else localStorage.setItem(PORTRAIT_PANEL_KEY, JSON.stringify({ version: 1, ratio: ratio.current }));
    } catch { /* UI stays usable when storage is unavailable. */ }
  };
  const reset = () => { cancel(); apply(metrics.current.defaultHeight); persist(true); publish(); };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const workspace = panel?.closest<HTMLElement>(".workspace");
    if (!panel || !workspace || !portrait) { panel?.style.removeProperty("--portrait-panel-height"); return; }
    const measure = () => {
      cancel();
      const style = getComputedStyle(workspace);
      const height = workspace.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      const gap = parseFloat(style.rowGap) || 8;
      metrics.current = { height, gap, ...portraitPanelBounds(height, gap) };
      apply(ratio.current === null ? metrics.current.defaultHeight : ratio.current * height);
      publish();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(workspace);
    const secondPointer = (event: globalThis.PointerEvent) => { if (drag.current && drag.current.id !== event.pointerId) cancel(); };
    document.addEventListener("pointerdown", secondPointer, true);
    window.addEventListener("orientationchange", measure);
    window.addEventListener("resize", measure);
    return () => {
      cancel(); observer?.disconnect(); panel.style.removeProperty("--portrait-panel-height");
      document.removeEventListener("pointerdown", secondPointer, true);
      window.removeEventListener("orientationchange", measure); window.removeEventListener("resize", measure);
    };
  }, [panelRef, portrait, keyboardOpen]);

  return {
    aria, reset,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!portrait || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      drag.current = { id: event.pointerId, y: event.clientY, x: event.clientX, start: value.current, element: event.currentTarget, moved: false, time: performance.now() };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const next = current.start + current.y - event.clientY;
      if (Math.hypot(event.clientY - current.y, event.clientX - current.x) > 6) current.moved = true;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => { raf.current = 0; apply(next); });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      cancelAnimationFrame(raf.current); raf.current = 0;
      apply(current.start + current.y - event.clientY);
      drag.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      const now = performance.now();
      if (Math.hypot(event.clientY - current.y, event.clientX - current.x) > 6) current.moved = true;
      if (!current.moved && now - current.time < 350) {
        if (tap.current && now - tap.current.time < 350 && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) < 12) { reset(); return; }
        tap.current = { time: now, x: event.clientX, y: event.clientY };
      } else tap.current = null;
      persist(); publish();
    },
    onPointerCancel: cancel,
    onLostPointerCapture: () => { if (drag.current) cancel(); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const heights: Record<string, number> = { ArrowUp: value.current + 16, ArrowDown: value.current - 16, Home: metrics.current.min, End: metrics.current.max };
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); reset(); }
      else if (event.key in heights) {
        event.preventDefault(); event.stopPropagation(); cancel(); apply(heights[event.key]);
        // Keep keyboard adjustments for this session; disk writes are reserved for drag end/reset.
        if (portrait && !keyboardOpen && metrics.current.height > 0) ratio.current = value.current / metrics.current.height;
        publish();
      }
    },
  };
};

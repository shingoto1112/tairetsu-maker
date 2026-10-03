import { useEffect, useRef, type RefObject } from "react";

/** React's delegated wheel listener is passive; canvas pinch needs to prevent browser zoom. */
export const useCanvasWheelZoom = (
  viewport: RefObject<HTMLElement>, locked: RefObject<boolean>,
  onZoom: (factor: number, anchor: { clientX: number; clientY: number }) => void,
) => {
  const callback = useRef(onZoom);
  callback.current = onZoom;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || locked.current) return;
      event.preventDefault();
      callback.current(event.deltaY < 0 ? 1.14 : 1 / 1.14, { clientX: event.clientX, clientY: event.clientY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [viewport, locked]);
};

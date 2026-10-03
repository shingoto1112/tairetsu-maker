import { useEffect } from "react";

export const restoreAppShellScroll = () => {
  if (!document.querySelector(".app-shell")) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable)) return;
  // WKWebView can move the layout viewport while its keyboard is open/closing.
  // Wait for the visual viewport to recover before correcting document scroll.
  const viewport = window.visualViewport;
  if (viewport && (viewport.height < window.innerHeight - 100 || viewport.offsetTop > 1)) return;
  const root = document.scrollingElement;
  if (root && (root.scrollTop || root.scrollLeft)) {
    root.scrollTop = 0;
    root.scrollLeft = 0;
  }
};

export const useAppShellScrollGuard = () => {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; restoreAppShellScroll(); });
    };
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("focusout", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("focusout", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, []);
};

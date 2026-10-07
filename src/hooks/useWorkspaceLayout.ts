import { useEffect, useState } from "react";
import { getAppRuntime } from "../platform/runtime";

const PORTRAIT_QUERY = "(orientation: portrait) and (max-width: 1400px)";
const SETTLE_MS = 180;
const FOCUS_TRANSFER_MS = 100;
const TEXT_INPUT_TYPES = new Set(["text", "search", "number", "email", "password", "tel", "url"]);

/** Only an editable text focus can justify shrinking the native portrait workspace. */
export const hasTextInputFocus = () => {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLInputElement) return !element.disabled && !element.readOnly && TEXT_INPUT_TYPES.has(element.type);
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  return element.isContentEditable === true;
};

type ViewportState = { isPortrait: boolean; height: number | undefined; keyboardOpen: boolean };
export const useWorkspaceLayout = () => {
  const [layout, setLayout] = useState<ViewportState>(() => ({
    isPortrait: window.matchMedia(PORTRAIT_QUERY).matches,
    height: undefined,
    keyboardOpen: false,
  }));

  useEffect(() => {
    const query = window.matchMedia(PORTRAIT_QUERY);
    const native = getAppRuntime() === "capacitor-ios";
    const viewport = window.visualViewport;
    let frame = 0;
    let settleTimer = 0;
    let focusTimer = 0;
    const measure = () => {
      frame = 0;
      // A stale visualViewport after blur must never restore the shrunken height.
      const keyboardOpen = native && query.matches && hasTextInputFocus() && !!viewport &&
        Math.abs(viewport.scale - 1) < 0.05 && window.innerHeight - viewport.height >= 160;
      const next = { isPortrait: query.matches, keyboardOpen, height: keyboardOpen ? viewport!.height : undefined };
      setLayout(previous => previous.isPortrait === next.isPortrait && previous.keyboardOpen === next.keyboardOpen && previous.height === next.height ? previous : next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const remeasure = () => {
      schedule();
      window.clearTimeout(settleTimer);
      // Safari may deliver lifecycle events before its viewport has settled.
      settleTimer = window.setTimeout(schedule, SETTLE_MS);
    };
    const focusIn = () => { window.clearTimeout(focusTimer); remeasure(); };
    const focusOut = () => {
      window.clearTimeout(focusTimer);
      // Allow a direct transfer between text inputs without a transient reset.
      focusTimer = window.setTimeout(remeasure, FOCUS_TRANSFER_MS);
    };
    query.addEventListener("change", remeasure);
    window.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);
    window.addEventListener("pageshow", remeasure);
    document.addEventListener("visibilitychange", remeasure);
    if (native) {
      viewport?.addEventListener("resize", remeasure);
      document.addEventListener("focusin", focusIn);
      document.addEventListener("focusout", focusOut);
    }
    remeasure();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(focusTimer);
      query.removeEventListener("change", remeasure);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("orientationchange", remeasure);
      window.removeEventListener("pageshow", remeasure);
      document.removeEventListener("visibilitychange", remeasure);
      viewport?.removeEventListener("resize", remeasure);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
    };
  }, []);

  return layout;
};

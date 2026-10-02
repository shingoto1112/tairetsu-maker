import { useEffect, type KeyboardEvent, type RefObject } from "react";

const focusable = 'button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export const useModalFocus = (ref: RefObject<HTMLElement>, active = true) => {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>(focusable)?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);

  return (event: KeyboardEvent<HTMLElement>) => {
    const dialog = ref.current;
    // An inner dialog owns its own Tab cycle.
    if (event.key !== "Tab" || !dialog || !(event.target instanceof Element) ||
        event.target.closest('[aria-modal="true"]') !== dialog) return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusable))
      .filter((control) => !control.matches(":disabled") && !control.closest('[hidden], [aria-hidden="true"]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault(); first.focus();
    }
  };
};

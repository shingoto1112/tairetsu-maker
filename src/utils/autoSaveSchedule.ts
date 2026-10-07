export const AUTO_SAVE_DEBOUNCE_MS = 800;
export const AUTO_SAVE_MAX_WAIT_MS = 5000;

/** The first dirty edit owns the deadline; subsequent edits cannot postpone it. */
export function autoSaveDelay(firstEditAt: number, now: number): number {
  const remaining = Math.max(0, AUTO_SAVE_MAX_WAIT_MS - (now - firstEditAt));
  return Math.min(AUTO_SAVE_DEBOUNCE_MS, remaining);
}

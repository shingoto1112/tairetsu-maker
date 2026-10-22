import type { Position, ViewerPerspective } from "../types";
import { roundMeters } from "./coordinates";

const KEYBOARD_NUDGE_SMALL = 0.01;
const KEYBOARD_NUDGE_DEFAULT = 0.25;
const KEYBOARD_NUDGE_LARGE_FALLBACK = 0.5;

const getKeyboardNudgeMeters = (
  event: KeyboardEvent,
  gridSizeMeters?: number,
): number => {
  if (event.ctrlKey || event.metaKey) {
    return KEYBOARD_NUDGE_SMALL;
  }
  if (event.shiftKey) {
    return typeof gridSizeMeters === "number" && gridSizeMeters > 0
      ? gridSizeMeters
      : KEYBOARD_NUDGE_LARGE_FALLBACK;
  }
  return KEYBOARD_NUDGE_DEFAULT;
};

export const getKeyboardNudgeDelta = (
  event: KeyboardEvent,
  viewerPerspective: ViewerPerspective,
  gridSizeMeters?: number,
): Position | null => {
  const step = getKeyboardNudgeMeters(event, gridSizeMeters);
  const displayDelta =
    event.key === "ArrowUp"
      ? { x: 0, y: -step }
      : event.key === "ArrowDown"
        ? { x: 0, y: step }
        : event.key === "ArrowLeft"
          ? { x: -step, y: 0 }
          : event.key === "ArrowRight"
            ? { x: step, y: 0 }
            : null;
  if (!displayDelta) {
    return null;
  }

  // 踊る人側視点では表示が反転しているため、画面上の矢印方向を優先して内部座標を反転する。
  const direction = viewerPerspective === "performer" ? -1 : 1;
  return {
    x: roundMeters(displayDelta.x * direction),
    y: roundMeters(displayDelta.y * direction),
  };
};


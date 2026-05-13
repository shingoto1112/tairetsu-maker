export const TOUCH_LONG_PRESS_DELAY_MS = 500;
export const TOUCH_LONG_PRESS_CANCEL_DISTANCE_PX = 10;

export const hasTouchLongPressMoved = (
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
): boolean =>
  Math.hypot(clientX - startClientX, clientY - startClientY) >
  TOUCH_LONG_PRESS_CANCEL_DISTANCE_PX;

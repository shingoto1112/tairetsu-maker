type EdgeAutoScrollOptions = {
  edgePx?: number;
  maxSpeedPx?: number;
  onScroll?: () => void;
};

export type EdgeAutoScroller = {
  stop: () => void;
  update: (clientX: number, clientY: number) => void;
};

const DEFAULT_EDGE_PX = 72;
const DEFAULT_MAX_SPEED_PX = 18;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const getEdgeVelocity = (
  position: number,
  start: number,
  end: number,
  edgePx: number,
  maxSpeedPx: number,
): number => {
  if (position < start + edgePx) {
    const ratio = clamp((start + edgePx - position) / edgePx, 0, 1);
    return -maxSpeedPx * ratio;
  }
  if (position > end - edgePx) {
    const ratio = clamp((position - (end - edgePx)) / edgePx, 0, 1);
    return maxSpeedPx * ratio;
  }
  return 0;
};

export const createEdgeAutoScroller = (
  container: HTMLElement,
  options: EdgeAutoScrollOptions = {},
): EdgeAutoScroller => {
  const edgePx = options.edgePx ?? DEFAULT_EDGE_PX;
  const maxSpeedPx = options.maxSpeedPx ?? DEFAULT_MAX_SPEED_PX;
  let frameId: number | null = null;
  let lastPointer: { clientX: number; clientY: number } | null = null;

  const stopFrame = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  const tick = () => {
    frameId = null;
    if (!lastPointer) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const velocityX =
      maxScrollLeft > 0
        ? getEdgeVelocity(lastPointer.clientX, rect.left, rect.right, edgePx, maxSpeedPx)
        : 0;
    const velocityY =
      maxScrollTop > 0
        ? getEdgeVelocity(lastPointer.clientY, rect.top, rect.bottom, edgePx, maxSpeedPx)
        : 0;

    if (velocityX === 0 && velocityY === 0) {
      return;
    }

    const previousLeft = container.scrollLeft;
    const previousTop = container.scrollTop;
    container.scrollLeft = clamp(previousLeft + velocityX, 0, maxScrollLeft);
    container.scrollTop = clamp(previousTop + velocityY, 0, maxScrollTop);

    const didScroll =
      container.scrollLeft !== previousLeft || container.scrollTop !== previousTop;
    if (!didScroll) {
      return;
    }

    options.onScroll?.();
    frameId = window.requestAnimationFrame(tick);
  };

  const update = (clientX: number, clientY: number) => {
    lastPointer = { clientX, clientY };
    if (frameId === null) {
      frameId = window.requestAnimationFrame(tick);
    }
  };

  const stop = () => {
    lastPointer = null;
    stopFrame();
  };

  return { stop, update };
};

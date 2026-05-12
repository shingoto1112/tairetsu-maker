type EdgeAutoScrollOptions = {
  edgePx?: number;
  maxSpeedPx?: number;
  onScroll?: () => void;
};

export type EdgeAutoScroller = {
  stop: () => void;
  update: (clientX: number, clientY: number) => void;
};

const DEFAULT_EDGE_PX = 96;
const DEFAULT_MAX_SPEED_PX = 16;
const FRAME_RATE_BASELINE = 60;
const MAX_FRAME_DELTA_SECONDS = 0.032;
const MIN_VELOCITY_PX_PER_SECOND = 1;
const VELOCITY_SMOOTHING_PER_SECOND = 18;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const easeEdgeRatio = (ratio: number): number => {
  const t = clamp(ratio, 0, 1);
  return t * t * (3 - 2 * t);
};

const getEdgeVelocity = (
  position: number,
  start: number,
  end: number,
  edgePx: number,
  maxSpeedPxPerSecond: number,
): number => {
  if (position < start + edgePx) {
    const ratio = (start + edgePx - position) / edgePx;
    return -maxSpeedPxPerSecond * easeEdgeRatio(ratio);
  }
  if (position > end - edgePx) {
    const ratio = (position - (end - edgePx)) / edgePx;
    return maxSpeedPxPerSecond * easeEdgeRatio(ratio);
  }
  return 0;
};

export const createEdgeAutoScroller = (
  container: HTMLElement,
  options: EdgeAutoScrollOptions = {},
): EdgeAutoScroller => {
  const edgePx = options.edgePx ?? DEFAULT_EDGE_PX;
  const maxSpeedPxPerSecond =
    (options.maxSpeedPx ?? DEFAULT_MAX_SPEED_PX) * FRAME_RATE_BASELINE;
  let frameId: number | null = null;
  let lastPointer: { clientX: number; clientY: number } | null = null;
  let lastFrameTime: number | null = null;
  let velocityX = 0;
  let velocityY = 0;

  const stopFrame = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  const tick = (timestamp: number) => {
    frameId = null;
    if (!lastPointer) {
      lastFrameTime = null;
      return;
    }

    const deltaSeconds =
      lastFrameTime === null
        ? 1 / FRAME_RATE_BASELINE
        : clamp((timestamp - lastFrameTime) / 1000, 0.001, MAX_FRAME_DELTA_SECONDS);
    lastFrameTime = timestamp;

    const rect = container.getBoundingClientRect();
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetVelocityX =
      maxScrollLeft > 0
        ? getEdgeVelocity(
            lastPointer.clientX,
            rect.left,
            rect.right,
            edgePx,
            maxSpeedPxPerSecond,
          )
        : 0;
    const targetVelocityY =
      maxScrollTop > 0
        ? getEdgeVelocity(
            lastPointer.clientY,
            rect.top,
            rect.bottom,
            edgePx,
            maxSpeedPxPerSecond,
          )
        : 0;
    const smoothing = 1 - Math.exp(-VELOCITY_SMOOTHING_PER_SECOND * deltaSeconds);
    velocityX += (targetVelocityX - velocityX) * smoothing;
    velocityY += (targetVelocityY - velocityY) * smoothing;

    if (targetVelocityX === 0 && Math.abs(velocityX) < MIN_VELOCITY_PX_PER_SECOND) {
      velocityX = 0;
    }
    if (targetVelocityY === 0 && Math.abs(velocityY) < MIN_VELOCITY_PX_PER_SECOND) {
      velocityY = 0;
    }

    if (velocityX === 0 && velocityY === 0) {
      lastFrameTime = null;
      return;
    }

    const previousLeft = container.scrollLeft;
    const previousTop = container.scrollTop;
    container.scrollLeft = clamp(
      previousLeft + velocityX * deltaSeconds,
      0,
      maxScrollLeft,
    );
    container.scrollTop = clamp(previousTop + velocityY * deltaSeconds, 0, maxScrollTop);

    const didScroll =
      container.scrollLeft !== previousLeft || container.scrollTop !== previousTop;
    if (!didScroll) {
      velocityX = 0;
      velocityY = 0;
      lastFrameTime = null;
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
    lastFrameTime = null;
    velocityX = 0;
    velocityY = 0;
    stopFrame();
  };

  return { stop, update };
};

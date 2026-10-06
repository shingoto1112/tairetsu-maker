import { memo, useLayoutEffect, useRef } from "react";
import type { WaveformData } from "../utils/audioWaveform";
import "./waveformCanvas.css";

export type WaveformCanvasProps = {
  data: WaveformData | null; className?: string;
  /** Windowed mode uses a three-viewport canvas, independent of song length. */
  currentTime?: number; visibleSeconds?: number; songDuration?: number;
};

/** Decorative waveform only. Playback cursor/scene markers belong to the caller.
 * Treat peaks as immutable: replace the Float32Array when changing the waveform.
 */
export const WaveformCanvas = memo(function WaveformCanvas({ data, className, currentTime = 0, visibleSeconds, songDuration }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDraw = useRef<{ peaks: Float32Array | undefined; width: number; height: number; ratio: number; start: number; duration: number }>();
  const peaks = data?.peaks;
  const position = useRef(currentTime); position.current = currentTime;
  const update = useRef<() => void>(() => {});
  const duration = visibleSeconds ? (songDuration ?? data?.durationSec ?? 0) : 0;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let size = { width: 0, height: 0 };
    const draw = (width: number, height: number) => {
      if (!active || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const deviceRatio = window.devicePixelRatio;
      const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
      const span = visibleSeconds ? visibleSeconds * 3 : duration;
      // Rebasing once per visible span leaves at least half a viewport buffered.
      const start = visibleSeconds ? Math.floor(position.current / visibleSeconds) * visibleSeconds - visibleSeconds : 0;
      if (visibleSeconds) canvas.style.transform = `translate3d(${width / 6 + (start - position.current) * width / span}px,0,0)`;
      const previous = lastDraw.current;
      if (previous && previous.peaks === peaks && previous.width === width && previous.height === height && previous.ratio === ratio && previous.start === start && previous.duration === duration) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#64748b";
      context.globalAlpha = 0.7;
      const count = visibleSeconds ? Math.ceil(width / 5) : Math.min(Math.ceil(width), peaks?.length ?? 0);
      for (let column = 0; column < count; column++) {
        const from = visibleSeconds ? start + column / count * span : column / count;
        const to = visibleSeconds ? start + (column + 1) / count * span : (column + 1) / count;
        if (!peaks || (visibleSeconds && (to <= 0 || from >= duration || duration <= 0))) continue;
        const first = Math.max(0, Math.floor((visibleSeconds ? from / duration : from) * peaks.length));
        const end = Math.min(peaks.length, Math.max(first + 1, Math.ceil((visibleSeconds ? to / duration : to) * peaks.length)));
        let peak = 0;
        for (let point = first; point < end; point++) {
          if (Number.isFinite(peaks[point])) peak = Math.max(peak, peaks[point]);
        }
        const barHeight = Math.min(1, peak) * Math.max(0, height - 2);
        if (barHeight > 0) context.fillRect(column * width / count, (height - barHeight) / 2, visibleSeconds ? Math.min(2, width / count) : width / count, barHeight);
      }
      lastDraw.current = { peaks, width, height, ratio, start, duration };
    };
    update.current = () => draw(size.width, size.height);
    const measure = () => {
      const { width, height } = canvas.getBoundingClientRect();
      size = { width, height };
      draw(width, height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === canvas) { size = { width: entry.contentRect.width, height: entry.contentRect.height }; update.current(); }
      }
    });
    observer?.observe(canvas);
    // Also catches DPR changes on window resize; no playback animation loop.
    window.addEventListener("resize", measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [peaks, visibleSeconds, duration]);

  useLayoutEffect(() => { update.current(); }, [currentTime]);

  return <canvas ref={canvasRef} style={visibleSeconds ? { width: "300%" } : undefined} className={["waveform-canvas", className].filter(Boolean).join(" ")} aria-hidden="true" />;
});

import { memo, useLayoutEffect, useRef } from "react";
import type { WaveformData } from "../utils/audioWaveform";
import "./waveformCanvas.css";

export type WaveformCanvasProps = { data: WaveformData | null; className?: string };

/** Decorative waveform only. Playback cursor/scene markers belong to the caller.
 * Treat peaks as immutable: replace the Float32Array when changing the waveform.
 */
export const WaveformCanvas = memo(function WaveformCanvas({ data, className }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDraw = useRef<{ peaks: Float32Array | undefined; width: number; height: number; ratio: number }>();
  const peaks = data?.peaks;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    const draw = (width: number, height: number) => {
      if (!active || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const deviceRatio = window.devicePixelRatio;
      const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
      const previous = lastDraw.current;
      if (previous && previous.peaks === peaks && previous.width === width && previous.height === height && previous.ratio === ratio) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#94a3b8";
      context.globalAlpha = 0.45;
      const count = Math.min(Math.ceil(width), peaks?.length ?? 0);
      for (let column = 0; column < count; column++) {
        const start = Math.floor(column * peaks!.length / count);
        const end = Math.floor((column + 1) * peaks!.length / count);
        let peak = 0;
        for (let point = start; point < end; point++) {
          if (Number.isFinite(peaks![point])) peak = Math.max(peak, peaks![point]);
        }
        const barHeight = Math.min(1, peak) * Math.max(0, height - 2);
        if (barHeight > 0) context.fillRect(column * width / count, (height - barHeight) / 2, width / count, barHeight);
      }
      lastDraw.current = { peaks, width, height, ratio };
    };
    const measure = () => {
      const { width, height } = canvas.getBoundingClientRect();
      draw(width, height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === canvas) draw(entry.contentRect.width, entry.contentRect.height);
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
  }, [peaks]);

  return <canvas ref={canvasRef} className={["waveform-canvas", className].filter(Boolean).join(" ")} aria-hidden="true" />;
});

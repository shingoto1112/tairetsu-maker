import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { FormationFrame } from "../types";
import type { WaveformData } from "../utils/audioWaveform";
import { formatTime } from "../utils/time";
import { WaveformCanvas } from "./WaveformCanvas";
import "./audioSceneTimeline.css";

type Props = {
  frames: FormationFrame[]; duration: number; currentTime: number; selectedFrameId: string | null; canEdit: boolean;
  audioKey?: string | null; waveform?: WaveformData | null; waveformNote?: string;
  onSeek: (time: number) => void; onSelectScene: (frameId: string) => void;
  /** One release = one history entry. Scrubbing never calls this. */
  onRetimeScene: (frameId: string, timeSec: number) => void;
  /** Pause synchronously; return whether this gesture should resume. */
  onPausePlayback?: () => boolean; onResumePlayback?: () => void;
};
type Gesture = {
  kind: "seek" | "scene"; pointerId: number; target: HTMLElement; startX: number; startY: number;
  base: number; scale: number; moved: boolean; time: number; resume: boolean; id?: string;
};
type Draft = { id: string; time: number };
type Segment = { id: string; number: number; label: string; start: number; end: number; outside: boolean };
const clamp = (time: number, total: number) => Math.max(0, Math.min(total, time));
const tenth = (time: number, total: number) => Math.max(0, Math.min(Math.round(time * 10) / 10, Math.floor(total * 10) / 10));
export const timelineX = (time: number, current: number, width: number, seconds: number) => width / 2 + (time - current) * width / seconds;

export const AudioSceneTimeline = (props: Props) => {
  const { frames, duration, currentTime, selectedFrameId, canEdit, waveform, waveformNote, audioKey } = props;
  const latest = useRef(props); latest.current = props;
  const known = Number.isFinite(duration) && duration > 0;
  const total = known ? duration : Math.max(30, ...frames.map(frame => Number.isFinite(frame.timeSec) ? frame.timeSec + 10 : 0));
  const [seconds, setSeconds] = useState(30);
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const scale = width / seconds;

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Match the canvas/absolute-position containing block, excluding the pill border.
    const measure = () => setWidth(element.clientWidth || element.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const cancel = useCallback(() => {
    const g = gesture.current; gesture.current = null;
    if (g) {
      suppressClick.current = g.moved;
      if (g.target.hasPointerCapture?.(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
    }
    setDraft(null);
    // Cancellation never resumes, including unmount/song replacement.
  }, []);
  useEffect(() => {
    cancel();
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", escape); window.addEventListener("blur", cancel);
    return () => { cancel(); window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel); };
  }, [audioKey, cancel]);
  useEffect(() => { if (!canEdit && gesture.current?.kind === "scene") cancel(); }, [canEdit, cancel]);

  const segments = useMemo<Segment[]>(() => {
    const items = frames.map((frame, index) => ({ id: frame.id, index, label: frame.label || "無題",
      time: draft?.id === frame.id ? draft.time : Number.isFinite(frame.timeSec) ? frame.timeSec : 0,
    })).sort((a, b) => a.time - b.time || a.index - b.index);
    return items.map((item, index) => ({ id: item.id, number: index + 1, label: item.label,
      start: clamp(item.time, total), end: clamp(items[index + 1]?.time ?? total, total), outside: known && item.time > duration + 0.05 }));
  }, [frames, draft, total, known, duration]);
  const begin = (event: PointerEvent<HTMLElement>, id?: string, time?: number) => {
    if (gesture.current || event.button !== 0 || event.isPrimary === false || scale <= 0) return;
    if (id && !canEdit) return;
    if (!id && (event.target as HTMLElement).closest("button")) return;
    event.stopPropagation(); suppressClick.current = false;
    gesture.current = { kind: id ? "scene" : "seek", pointerId: event.pointerId, target: event.currentTarget,
      startX: event.clientX, startY: event.clientY, base: time ?? latest.current.currentTime, scale,
      moved: false, time: time ?? latest.current.currentTime, resume: false, id };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - g.startX;
    if (!g.moved) {
      if (g.kind === "seek" && Math.abs(event.clientY - g.startY) > Math.max(6, Math.abs(dx))) { cancel(); return; }
      if (Math.abs(dx) < 6) return;
      g.moved = true;
      if (g.kind === "seek") g.resume = latest.current.onPausePlayback?.() ?? false;
    }
    g.time = tenth(g.base + (g.kind === "seek" ? -dx : dx) / g.scale, total);
    if (g.kind === "scene") setDraft({ id: g.id!, time: g.time });
    else latest.current.onSeek(g.time);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    event.stopPropagation(); gesture.current = null; setDraft(null);
    if (g.target.hasPointerCapture?.(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
    if (!g.moved) return;
    suppressClick.current = true;
    if (g.kind === "scene") {
      if (Math.abs(g.time - g.base) >= 0.05) latest.current.onRetimeScene(g.id!, g.time);
    } else if (g.resume) latest.current.onResumePlayback?.();
  };
  const select = (id: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    latest.current.onSelectScene(id);
  };
  const key = (id: string, original: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!canEdit || gesture.current || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    latest.current.onRetimeScene(id, tenth(original + (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1), total));
  };
  // Stable handlers: playback changes only the containing track transform.
  const actions = useRef({ begin, move, finish, cancel, select, key });
  actions.current = { begin, move, finish, cancel, select, key };
  const handlers = useMemo(() => ({
    begin: (e: PointerEvent<HTMLElement>, id?: string, time?: number) => actions.current.begin(e, id, time),
    move: (e: PointerEvent<HTMLElement>) => actions.current.move(e), finish: (e: PointerEvent<HTMLElement>) => actions.current.finish(e),
    cancel: () => actions.current.cancel(), select: (id: string) => actions.current.select(id),
    key: (id: string, time: number, e: KeyboardEvent<HTMLButtonElement>) => actions.current.key(id, time, e),
  }), []);

  return <section className="audio-timeline" aria-label="曲とシーンの区切り">
    <div className="audio-timeline__bar">
      <span className="audio-timeline__hint">波形を左右に動かして再生位置を合わせます</span>
      <div className="audio-timeline__zoom" role="group" aria-label="表示する秒数">
        {[10, 30, 60].map(value => <button key={value} type="button" aria-pressed={seconds === value}
          onClick={() => { cancel(); setSeconds(value); }}>{value}秒</button>)}
      </div>
    </div>
    <div className="audio-timeline__viewport" ref={viewport} onPointerDown={begin} onPointerMove={move}
      onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onClick={event => {
        if ((event.target as HTMLElement).closest("button")) return;
        if (suppressClick.current) { suppressClick.current = false; return; }
        const rect = viewport.current?.getBoundingClientRect();
        if (rect && scale > 0) props.onSeek(tenth(currentTime + (event.clientX - rect.left - width / 2) / scale, total));
      }}>
      <div className="audio-timeline__wave" aria-hidden="true">
        {waveform && <WaveformCanvas data={waveform} className="audio-timeline__waveform" currentTime={currentTime} visibleSeconds={seconds} songDuration={total} />}
      </div>
      <div className="audio-timeline__track" style={{ width: total * scale, transform: `translate3d(${timelineX(0, currentTime, width, seconds)}px,0,0)` }}>
        <TimelineScenes segments={segments} scale={scale} selectedFrameId={selectedFrameId} canEdit={canEdit} known={known}
          originalTimes={frames} draftId={draft?.id ?? null} handlers={handlers} />
      </div>
      <div className="audio-timeline__playhead" aria-hidden="true" />
    </div>
    <div className="audio-timeline__overview" role="slider" tabIndex={0} aria-label="曲全体の再生位置"
      aria-valuemin={0} aria-valuemax={total} aria-valuenow={clamp(currentTime, total)} aria-valuetext={formatTime(currentTime)}
      onClick={event => { if (gesture.current) return; const rect = event.currentTarget.getBoundingClientRect(); if (rect.width) props.onSeek(clamp((event.clientX - rect.left) / rect.width * total, total)); }}
      onKeyDown={event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? total : event.key === "ArrowLeft" ? currentTime - 5 : event.key === "ArrowRight" ? currentTime + 5 : null;
        if (next !== null) { event.preventDefault(); if (!gesture.current) props.onSeek(clamp(next, total)); }
      }}>
      {frames.map(frame => <i key={frame.id} style={{ left: `${clamp(frame.timeSec, total) / total * 100}%` }} />)}
      <b style={{ transform: `translateX(${clamp(currentTime, total) / total * 100}%)` }} />
    </div>
    <p className="audio-timeline__hint">{canEdit ? "▼をドラッグして区切りを変更（0.1秒単位）。名前・▼を押すとシーンへ。" : "名前・▼を押すとシーンへ移動します。"}</p>
    {draft && <p className="audio-timeline__drag" role="status">{formatTime(draft.time)}</p>}
    {waveformNote && <p className="audio-timeline__note">{waveformNote}</p>}
  </section>;
};

type ScenesProps = {
  segments: Segment[]; scale: number; selectedFrameId: string | null; canEdit: boolean; known: boolean;
  originalTimes: FormationFrame[]; draftId: string | null;
  handlers: { begin: (e: PointerEvent<HTMLElement>, id?: string, time?: number) => void; move: (e: PointerEvent<HTMLElement>) => void;
    finish: (e: PointerEvent<HTMLElement>) => void; cancel: () => void; select: (id: string) => void; key: (id: string, time: number, e: KeyboardEvent<HTMLButtonElement>) => void };
};
const TimelineScenes = memo(function TimelineScenes({ segments, scale, selectedFrameId, canEdit, known, originalTimes, draftId, handlers }: ScenesProps) {
  return <>{segments.map((segment, index) => {
    const width = Math.max(0, segment.end - segment.start) * scale;
    const length = index === segments.length - 1 && !known ? "—" : `${Math.floor(Math.max(0, segment.end - segment.start))}秒`;
    const original = originalTimes.find(frame => frame.id === segment.id)?.timeSec ?? segment.start;
    return <div key={segment.id} className={`audio-timeline__scene${segment.id === selectedFrameId ? " is-selected" : ""}${segment.outside ? " is-outside" : ""}${segment.id === draftId ? " is-dragging" : ""}`}
      style={{ left: segment.start * scale, width }}>
      <span className="audio-timeline__line" aria-hidden="true" />
      <button type="button" className="audio-timeline__handle"
        aria-label={`${segment.number}. ${segment.label}の区切り（${formatTime(original)}）${canEdit ? "。左右キーで0.1秒ずつ動かせます" : ""}`}
        onClick={event => { event.stopPropagation(); handlers.select(segment.id); }}
        onPointerDown={event => handlers.begin(event, segment.id, original)} onPointerMove={handlers.move}
        onPointerUp={handlers.finish} onPointerCancel={handlers.cancel} onLostPointerCapture={handlers.cancel}
        onKeyDown={event => handlers.key(segment.id, original, event)}>▼</button>
      <button type="button" className="audio-timeline__label" title={`${segment.number}. ${segment.label}（${length}）`}
        aria-label={`${segment.number}. ${segment.label}（${formatTime(original)}から ${length}）を選ぶ`}
        onClick={event => { event.stopPropagation(); handlers.select(segment.id); }}>
        {width >= 36 && <span className="audio-timeline__name"><b>{segment.number}</b> {segment.label}</span>}
        {width >= 56 && <small>{segment.outside ? "曲の外" : length}</small>}
      </button>
    </div>;
  })}</>;
});

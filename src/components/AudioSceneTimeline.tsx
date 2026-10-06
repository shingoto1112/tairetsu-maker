import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { FormationFrame } from "../types";
import { formatTimeTenths } from "../utils/time";
import "./audioSceneTimeline.css";

type Props = {
  /** Scenes in time order (display order). */
  frames: FormationFrame[];
  /** Song length in seconds; 0 or NaN when no song is loaded. */
  duration: number;
  currentTime: number;
  selectedFrameId: string | null;
  canEdit: boolean;
  /** Waveform drawing for the track background (sized to the track). */
  waveform?: ReactNode;
  waveformNote?: string;
  onSeek: (time: number) => void;
  onSelectScene: (frameId: string) => void;
  /** Called once per drag (on release) or per arrow-key step. */
  onRetimeScene: (frameId: string, timeSec: number) => void;
};

type Draft = { id: string; time: number; startX: number; moved: boolean };
type Segment = { id: string; number: number; label: string; start: number; end: number; outside: boolean };

const roundTenth = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ZOOMED = 4;

/**
 * Song bar for building formations: scene boundaries (with names and how long each
 * scene lasts) over the waveform. Tap the bar to move the playhead, tap a scene to
 * select it, drag a boundary (▼) to change that scene's time. Only the playhead
 * follows playback; the scenes and waveform do not re-render every frame.
 */
export const AudioSceneTimeline = (props: Props) => {
  const { frames, duration, currentTime, selectedFrameId, canEdit, waveform, waveformNote } = props;
  const latest = useRef(props);
  latest.current = props;
  const known = Number.isFinite(duration) && duration > 0;
  const lastTime = frames.reduce((max, frame) => Math.max(max, Number.isFinite(frame.timeSec) ? frame.timeSec : 0), 0);
  const total = known ? duration : Math.max(30, lastTime + 10);
  const [zoomed, setZoomed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const setDraft = useCallback((next: Draft | null) => { draftRef.current = next; setDraftState(next); }, []);
  const suppressClick = useRef(false);
  const trackWidth = viewWidth * (zoomed ? ZOOMED : 1);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => setViewWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // When zoomed, keep the playhead in view during playback.
  useEffect(() => {
    const element = scrollRef.current;
    if (!zoomed || draft || !element || trackWidth <= 0) return;
    const x = (clamp(currentTime, 0, total) / total) * trackWidth;
    if (x < element.scrollLeft + 24 || x > element.scrollLeft + element.clientWidth - 24) {
      element.scrollLeft = Math.max(0, x - element.clientWidth * 0.3);
    }
  }, [currentTime, zoomed, total, trackWidth, draft]);

  const timeAt = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * total, 0, total);
  }, [total]);

  const segments = useMemo<Segment[]>(() => {
    const items = frames.map((frame, index) => ({
      id: frame.id, index, label: frame.label || "無題",
      time: draft?.id === frame.id ? draft.time : Number.isFinite(frame.timeSec) ? frame.timeSec : 0,
    })).sort((a, b) => a.time - b.time || a.index - b.index);
    return items.map((item, index) => {
      const next = items[index + 1];
      const start = clamp(item.time, 0, total);
      return { id: item.id, number: index + 1, label: item.label, start,
        end: next ? clamp(next.time, start, total) : total, outside: known && item.time > duration + 0.05 };
    });
  }, [frames, draft, total, known, duration]);

  const handlers = useMemo(() => ({
    select: (id: string) => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      latest.current.onSelectScene(id);
    },
    pointerDown: (id: string, time: number, event: PointerEvent<HTMLButtonElement>) => {
      if (!latest.current.canEdit || event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDraft({ id, time, startX: event.clientX, moved: false });
    },
    pointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const current = draftRef.current;
      if (!current) return;
      const moved = current.moved || Math.abs(event.clientX - current.startX) > 3;
      setDraft({ ...current, moved, time: moved ? timeAt(event.clientX) : current.time });
    },
    pointerUp: (id: string, original: number) => {
      const current = draftRef.current;
      setDraft(null);
      if (current?.id !== id || !current.moved) return;
      suppressClick.current = true;
      const next = roundTenth(current.time);
      if (Math.abs(next - original) >= 0.05) latest.current.onRetimeScene(id, next);
    },
    cancel: () => setDraft(null),
    key: (id: string, original: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (!latest.current.canEdit || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      const step = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1);
      latest.current.onRetimeScene(id, roundTenth(clamp(original + step, 0, total)));
    },
  }), [timeAt, total, setDraft]);

  const originalTimes = useMemo(() => new Map(frames.map((frame) => [frame.id, frame.timeSec])), [frames]);

  return <section className="audio-timeline" aria-label="曲とシーンの区切り">
    <div className="audio-timeline__bar">
      <span className="audio-timeline__hint">
        {canEdit ? "▼をドラッグすると、そのシーンの時刻を合わせられます" : "シーンを押すと、その位置へ移動します"}
      </span>
      <div className="audio-timeline__zoom" role="group" aria-label="表示の大きさ">
        <button type="button" aria-pressed={!zoomed} onClick={() => setZoomed(false)}>全体</button>
        <button type="button" aria-pressed={zoomed} onClick={() => setZoomed(true)}>拡大</button>
      </div>
    </div>
    <div className={`audio-timeline__scroll${zoomed ? " is-zoomed" : ""}`} ref={scrollRef}>
      <div className="audio-timeline__track" ref={trackRef} style={{ width: zoomed ? `${ZOOMED * 100}%` : "100%" }}
        onClick={(event) => {
          if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest(".audio-timeline__wave")) return;
          latest.current.onSeek(roundTenth(timeAt(event.clientX)));
        }}>
        <div className="audio-timeline__wave" aria-hidden="true">{waveform}</div>
        <TimelineScenes segments={segments} total={total} trackWidth={trackWidth} selectedFrameId={selectedFrameId}
          draftId={draft?.id ?? null} canEdit={canEdit} known={known} originalTimes={originalTimes} handlers={handlers} />
        <div className="audio-timeline__playhead" aria-hidden="true"
          style={{ left: `${(clamp(currentTime, 0, total) / total) * 100}%` }} />
      </div>
    </div>
    {draft?.moved && <p className="audio-timeline__drag" role="status">{formatTimeTenths(draft.time)}</p>}
    {waveformNote && <p className="audio-timeline__note">{waveformNote}</p>}
  </section>;
};

type ScenesProps = {
  segments: Segment[];
  total: number;
  trackWidth: number;
  selectedFrameId: string | null;
  draftId: string | null;
  canEdit: boolean;
  known: boolean;
  originalTimes: Map<string, number>;
  handlers: {
    select: (id: string) => void;
    pointerDown: (id: string, time: number, event: PointerEvent<HTMLButtonElement>) => void;
    pointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
    pointerUp: (id: string, original: number) => void;
    cancel: () => void;
    key: (id: string, original: number, event: KeyboardEvent<HTMLButtonElement>) => void;
  };
};

const TimelineScenes = memo(function TimelineScenes({ segments, total, trackWidth, selectedFrameId, draftId, canEdit, known, originalTimes, handlers }: ScenesProps) {
  return <>
    {segments.map((segment, index) => {
      const left = (segment.start / total) * 100;
      const width = ((segment.end - segment.start) / total) * 100;
      const widthPx = (width / 100) * trackWidth;
      const isLast = index === segments.length - 1;
      const length = isLast && !known ? "—" : `${(segment.end - segment.start).toFixed(1)}秒`;
      const original = originalTimes.get(segment.id) ?? segment.start;
      const selected = segment.id === selectedFrameId;
      return <div key={segment.id} className={`audio-timeline__scene${selected ? " is-selected" : ""}${segment.outside ? " is-outside" : ""}${segment.id === draftId ? " is-dragging" : ""}`}
        style={{ left: `${left}%`, width: `${width}%` }}>
        <span className="audio-timeline__line" aria-hidden="true" />
        <button type="button" className="audio-timeline__handle"
          aria-label={`${segment.number}. ${segment.label}の区切り（${formatTimeTenths(original)}）${canEdit ? "。左右キーで0.1秒ずつ動かせます" : ""}`}
          onClick={() => handlers.select(segment.id)}
          onPointerDown={(event) => handlers.pointerDown(segment.id, original, event)}
          onPointerMove={handlers.pointerMove}
          onPointerUp={() => handlers.pointerUp(segment.id, original)}
          onPointerCancel={handlers.cancel}
          onKeyDown={(event) => handlers.key(segment.id, original, event)}>▼</button>
        <button type="button" className="audio-timeline__label" title={`${segment.number}. ${segment.label}（${length}）`}
          aria-label={`${segment.number}. ${segment.label}（${formatTimeTenths(original)}から ${length}）を選ぶ`}
          onClick={(event) => { event.stopPropagation(); handlers.select(segment.id); }}>
          {widthPx >= 36 && <span className="audio-timeline__name"><b>{segment.number}</b> {segment.label}</span>}
          {widthPx >= 56 && <small>{segment.outside ? "曲の外" : length}</small>}
        </button>
      </div>;
    })}
  </>;
});

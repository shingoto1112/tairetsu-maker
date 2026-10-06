import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatTime } from "../utils/time";
import "./audioTimeDial.css";

const ROW = 44;
const limit = (value: number, max: number) => Math.max(0, Math.min(max, value));
type WheelHandle = { read: () => number };
type WheelProps = { name: string; value: number; max: number; onChange: (value: number) => void };

const TimeWheel = forwardRef<WheelHandle, WheelProps>(function TimeWheel({ name, value, max, onChange }, ref) {
  const element = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef(false);
  const latest = useRef({ value, max, onChange }); latest.current = { value, max, onChange };
  const read = () => limit(Math.round((element.current?.scrollTop ?? value * ROW) / ROW), latest.current.max);
  useImperativeHandle(ref, () => ({ read }));
  const settle = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    const next = read();
    if (element.current) element.current.scrollTop = next * ROW;
    if (next !== latest.current.value) latest.current.onChange(next);
  };
  const settleRef = useRef(settle); settleRef.current = settle;
  useLayoutEffect(() => {
    pending.current = false; clearTimeout(timer.current);
    if (element.current) element.current.scrollTop = value * ROW;
  }, [value, max]);
  useLayoutEffect(() => {
    const el = element.current;
    const end = () => settleRef.current();
    el?.addEventListener("scrollend", end);
    return () => { clearTimeout(timer.current); el?.removeEventListener("scrollend", end); };
  }, []);
  return <div className="audio-dial__column">
    <span className="audio-dial__column-name">{name}</span>
    <div ref={element} className="audio-dial__wheel" role="spinbutton" tabIndex={0} aria-label={name}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value}${name}`}
      onScroll={() => {
        if (Math.abs((element.current?.scrollTop ?? 0) - latest.current.value * ROW) < 1) return;
        pending.current = true; clearTimeout(timer.current);
        timer.current = setTimeout(() => settleRef.current(), 120);
      }}
      onKeyDown={event => {
        const next = event.key === "ArrowUp" ? value + 1 : event.key === "ArrowDown" ? value - 1 : event.key === "Home" ? 0 : event.key === "End" ? max : null;
        if (next !== null) { event.preventDefault(); onChange(limit(next, max)); }
      }}>
      {Array.from({ length: max + 1 }, (_, index) => <div key={index} className={`audio-dial__row${index === value ? " is-selected" : ""}`}
        aria-hidden="true" onClick={() => onChange(index)}>{String(index).padStart(2, "0")}</div>)}
    </div>
    <div className="audio-dial__adjust">
      <button type="button" aria-label={`${name}を1減らす`} disabled={value === 0} onClick={() => onChange(value - 1)}>−</button>
      <button type="button" aria-label={`${name}を1増やす`} disabled={value === max} onClick={() => onChange(value + 1)}>＋</button>
    </div>
  </div>;
});

export const AudioTimeDial = ({ label, value, duration, otherTime, edge, onCommit, onCancel }: {
  label: string; value: number; duration: number; otherTime: number; edge: "start" | "end";
  onCommit: (seconds: number) => void; onCancel: () => void;
}) => {
  const safe = limit(Number.isFinite(value) ? value : 0, duration);
  const [minute, setMinute] = useState(Math.floor(safe / 60));
  const [second, setSecond] = useState(Math.floor(safe % 60));
  // Preserve an existing fractional endpoint until the user actually moves a wheel.
  const [exact, setExact] = useState<number | null>(safe);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const minutes = useRef<WheelHandle>(null);
  const seconds = useRef<WheelHandle>(null);
  const maxMinute = Math.floor(duration / 60);
  const maxSecond = minute === maxMinute ? Math.floor(duration - minute * 60) : 59;
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    if (el?.showModal) el.showModal(); else el?.setAttribute("open", "");
    // A closed native dialog has no layout. Mount wheels only after opening,
    // otherwise the browser silently clamps their initial scrollTop to zero.
    setReady(true);
    return () => { if (el?.open && el.close) el.close(); previous?.focus(); };
  }, []);
  useLayoutEffect(() => {
    if (ready) dialog.current?.querySelector<HTMLElement>("[role=spinbutton]")?.focus();
  }, [ready]);
  const changeMinute = (next: number) => { setMinute(next); setSecond(old => limit(old, next === maxMinute ? Math.floor(duration - next * 60) : 59)); setExact(null); setError(""); };
  const changeSecond = (next: number) => { setSecond(next); setExact(null); setError(""); };
  const chosen = exact ?? minute * 60 + second;
  const confirm = () => {
    // Read pending scrolls as well, so pressing 決定 during debounce uses the visible row.
    const m = minutes.current?.read() ?? minute;
    const s = limit(seconds.current?.read() ?? second, m === maxMinute ? Math.floor(duration - m * 60) : 59);
    const next = exact !== null && m === minute && s === second ? exact : m * 60 + s;
    if (!(edge === "start" ? next < otherTime : next > otherTime)) { setError("開始は終了より前にしてください。"); return; }
    onCommit(next);
  };
  return createPortal(<dialog ref={dialog} className="audio-dial" aria-modal="true" aria-label={`${label}の時刻`} onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2>{label}</h2>
    <p className="audio-dial__value">{formatTime(chosen)}{exact === duration ? "（曲の終わり）" : ""}</p>
    {ready && <div className="audio-dial__wheels">
      <TimeWheel ref={minutes} name="分" value={minute} max={maxMinute} onChange={changeMinute} />
      <TimeWheel ref={seconds} name="秒" value={second} max={maxSecond} onChange={changeSecond} />
    </div>}
    <button type="button" className="mini-button audio-dial__end" onClick={() => {
      setMinute(maxMinute); setSecond(Math.floor(duration % 60)); setExact(duration); setError("");
    }}>曲の終わり</button>
    {error && <p className="notice warning" role="alert">{error}</p>}
    <div className="audio-dial__actions">
      <button type="button" className="mini-button" onClick={onCancel}>取消</button>
      <button type="button" className="mini-button primary" onClick={confirm}>決定</button>
    </div>
  </dialog>, document.body);
};

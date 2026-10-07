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
  // A moving window bounds DOM size and avoids browser scroll-height limits.
  const start = max <= 120 ? 0 : Math.max(0, Math.min(max - 60, value - 30));
  const count = Math.min(max - start + 1, max <= 120 ? 121 : 61);
  const latest = useRef({ value, max, start, onChange }); latest.current = { value, max, start, onChange };
  const read = () => limit(latest.current.start + Math.round((element.current?.scrollTop ?? (value - start) * ROW) / ROW), latest.current.max);
  useImperativeHandle(ref, () => ({ read }));
  const settle = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    const next = read();
    if (element.current) element.current.scrollTop = (next - latest.current.start) * ROW;
    if (next !== latest.current.value) latest.current.onChange(next);
  };
  const settleRef = useRef(settle); settleRef.current = settle;
  useLayoutEffect(() => {
    pending.current = false; clearTimeout(timer.current);
    if (element.current) element.current.scrollTop = (value - start) * ROW;
  }, [value, max, start]);
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
        if (Math.abs((element.current?.scrollTop ?? 0) - (latest.current.value - latest.current.start) * ROW) < 1) return;
        pending.current = true; clearTimeout(timer.current);
        timer.current = setTimeout(() => settleRef.current(), 120);
      }}
      onKeyDown={event => {
        const next = event.key === "ArrowUp" ? value + 1 : event.key === "ArrowDown" ? value - 1 : event.key === "Home" ? 0 : event.key === "End" ? max : null;
        if (next !== null) { event.preventDefault(); onChange(limit(next, max)); }
      }}>
      {Array.from({ length: count }, (_, offset) => { const index = start + offset; return <div key={index} className={`audio-dial__row${index === value ? " is-selected" : ""}`}
        aria-hidden="true" onClick={() => onChange(index)}>{String(index).padStart(2, "0")}</div>; })}
    </div>
    <div className="audio-dial__adjust">
      <button type="button" aria-label={`${name}を1減らす`} disabled={value === 0} onClick={() => onChange(value - 1)}>−</button>
      <button type="button" aria-label={`${name}を1増やす`} disabled={value === max} onClick={() => onChange(value + 1)}>＋</button>
    </div>
  </div>;
});

export type TimeDialProps = {
  label: string; value: number; maxSeconds: number;
  validate?: (seconds: number) => string | null;
  shortcut?: { label: string; seconds: number };
  onCommit: (seconds: number, result: { changed: boolean }) => void;
  onCancel: () => void;
};

export const TimeDial = ({ label, value, maxSeconds, validate, shortcut, onCommit, onCancel }: TimeDialProps) => {
  // One mounted dial is one draft. Remote values/ranges never reset it.
  const [initial] = useState(() => {
    const max = Number.isFinite(maxSeconds) ? Math.max(0, maxSeconds) : 0;
    const safe = limit(Number.isFinite(value) ? value : 0, max);
    return { value: safe, max, minute: Math.floor(safe / 60), second: Math.floor(safe % 60) };
  });
  const [minute, setMinute] = useState(initial.minute);
  const [second, setSecond] = useState(initial.second);
  const [exactShortcut, setExactShortcut] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const minutes = useRef<WheelHandle>(null);
  const seconds = useRef<WheelHandle>(null);
  const maxMinute = Math.floor(initial.max / 60);
  const secondLimit = (m: number) => m === maxMinute ? Math.floor(initial.max - m * 60) : 59;
  const maxSecond = secondLimit(minute);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    let native = false;
    if (el?.showModal) { try { el.showModal(); native = true; } catch { /* Embedded browser fallback. */ } }
    if (!native) { el?.setAttribute("open", ""); setFallback(true); }
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== host.current);
    const prior = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Guard background events/focus even in browsers without inert.
    const guard = (event: Event) => {
      if (event.target instanceof Node && host.current?.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === "focusin" || event.type === "keydown") el?.querySelector<HTMLElement>("[role=spinbutton]")?.focus();
    };
    const events = ["pointerdown", "click", "wheel", "touchmove", "keydown", "focusin"];
    events.forEach(type => document.addEventListener(type, guard, { capture: true, passive: false }));
    // A closed native dialog has no layout. Mount wheels only after opening,
    // otherwise the browser silently clamps their initial scrollTop to zero.
    setReady(true);
    return () => {
      events.forEach(type => document.removeEventListener(type, guard, true));
      siblings.forEach((node, index) => { node.inert = prior[index]; });
      document.body.style.overflow = overflow;
      if (el?.open && el.close) el.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (ready) dialog.current?.querySelector<HTMLElement>("[role=spinbutton]")?.focus({ preventScroll: true });
  }, [ready]);
  const changeMinute = (next: number) => { setMinute(next); setSecond(old => limit(old, secondLimit(next))); setExactShortcut(null); setError(""); };
  const changeSecond = (next: number) => { setSecond(next); setExactShortcut(null); setError(""); };
  const chosen = exactShortcut ?? minute * 60 + second;
  const confirm = () => {
    // Read pending scrolls as well, so pressing 決定 during debounce uses the visible row.
    const m = minutes.current?.read() ?? minute;
    const s = limit(seconds.current?.read() ?? second, secondLimit(m));
    const changed = m !== initial.minute || s !== initial.second;
    const next = exactShortcut !== null && m === minute && s === second ? exactShortcut : changed ? m * 60 + s : initial.value;
    const message = validate?.(next);
    if (message) { setError(message); return; }
    onCommit(next, { changed });
  };
  return createPortal(<div ref={host} className={fallback ? "time-dial-backdrop" : undefined}>
    <dialog ref={dialog} className="audio-dial" aria-modal="true" aria-label={`${label}の時刻`} tabIndex={-1}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onCancel(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [role="spinbutton"]'));
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }}>
    <h2>{label}</h2>
    <p className="audio-dial__value">{formatTime(chosen)}{exactShortcut !== null || initial.value === shortcut?.seconds && minute === initial.minute && second === initial.second ? `（${shortcut?.label}）` : ""}</p>
    {ready && <div className="audio-dial__wheels">
      <TimeWheel ref={minutes} name="分" value={minute} max={maxMinute} onChange={changeMinute} />
      <TimeWheel ref={seconds} name="秒" value={second} max={maxSecond} onChange={changeSecond} />
    </div>}
    {shortcut && <button type="button" className="mini-button audio-dial__end" onClick={() => {
      const next = limit(shortcut.seconds, initial.max);
      setMinute(Math.floor(next / 60)); setSecond(Math.floor(next % 60)); setExactShortcut(next); setError("");
    }}>{shortcut.label}</button>}
    {error && <p className="notice warning" role="alert">{error}</p>}
    <div className="audio-dial__actions">
      <button type="button" className="mini-button" onClick={onCancel}>取消</button>
      <button type="button" className="mini-button primary" onClick={confirm}>決定</button>
    </div>
    </dialog>
  </div>, document.body);
};

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AnnotationLine, Position } from "../types";
import { snapAnnotationPoint, translateAnnotationLine } from "../utils/annotationLines";
import { AnnotationLines, annotationColors } from "./AnnotationLines";
type Gesture = { pointer: number; id: string; kind: "draw" | "move" | "start" | "end"; start: Position; original: AnnotationLine; line: AnnotationLine };
export const useAnnotationEditor = ({ lines, width, depth, step, counting, verticalOrigin = 0, reflected = false, context, disabled, onChange }: {
  lines?: Record<string, AnnotationLine>; width: number; depth: number; step: number; counting?: string; verticalOrigin?: number; reflected?: boolean;
  context: string; disabled: boolean; onChange?: (id: string, line: AnnotationLine | null) => void;
}) => {
  const [active, setActive] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState<AnnotationLine["color"]>("black"), [dash, setDash] = useState<AnnotationLine["dash"]>("solid");
  const [draft, setDraft] = useState<Gesture | null>(null);
  const gesture = useRef<Gesture | null>(null), svg = useRef<SVGSVGElement>(null), pointers = useRef(new Set<number>());
  const [scale, setScale] = useState(32);
  const cancel = () => { gesture.current = null; setDraft(null); };
  const finish = () => { pointers.current.clear(); cancel(); setActive(false); setSelected(null); };
  useEffect(() => { finish(); pointers.current.clear(); }, [context, disabled]);
  useEffect(() => { cancel(); if (selected && !lines?.[selected]) setSelected(null); }, [lines]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  useEffect(() => {
    // A second touch may land on a ruler/outside the SVG. The viewport still
    // starts its pan/pinch; discard ink before its capture handler runs.
    const down = (e: globalThis.PointerEvent) => { if (gesture.current && e.pointerId !== gesture.current.pointer) { pointers.current.add(e.pointerId); cancel(); } };
    const release = (e: globalThis.PointerEvent) => { pointers.current.delete(e.pointerId); if (e.type === "pointercancel" && gesture.current?.pointer === e.pointerId) cancel(); };
    window.addEventListener("pointerdown", down, true); window.addEventListener("pointerup", release, true); window.addEventListener("pointercancel", release, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", release, true); window.removeEventListener("pointercancel", release, true); };
  }, []);
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const observer = new ResizeObserver(() => { if (svg.current === element) setScale(element.getBoundingClientRect().width / width); });
    observer.observe(element); return () => observer.disconnect();
  }, [width]);
  const point = (e: PointerEvent): Position => {
    const rect = svg.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * width, y = (e.clientY - rect.top) / rect.height * depth;
    return { x: reflected ? width - x : x, y: reflected ? depth - y : y };
  };
  const snap = (p: Position) => snapAnnotationPoint(p, width, depth, step, counting, verticalOrigin);
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!active || disabled || !onChange || !svg.current || e.button !== 0) return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) { cancel(); return; }
    e.preventDefault(); e.stopPropagation();
    const target = e.target as Element, id = target.getAttribute("data-line-id"), handle = target.getAttribute("data-endpoint");
    const start = point(e), p = snap(start);
    const original = id && lines?.[id] ? { ...lines[id] } : { x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, dash };
    const kind = id ? handle === "start" ? "start" : handle === "end" ? "end" : "move" : "draw";
    const g: Gesture = { pointer: e.pointerId, id: id ?? crypto.randomUUID(), kind, start, original, line: original };
    if (id) { setSelected(id); setColor(original.color); setDash(original.dash); } else setSelected(null);
    gesture.current = g; setDraft(g); e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g || !svg.current || g.pointer !== e.pointerId || pointers.current.size > 1) return;
    e.stopPropagation(); const p = point(e), original = g.original;
    const snapped = snap(g.kind === "move" ? { x: original.x1 + p.x - g.start.x, y: original.y1 + p.y - g.start.y } : p);
    const line = g.kind === "move" ? translateAnnotationLine(original, snapped) : g.kind === "start" ? { ...original, x1: snapped.x, y1: snapped.y } : { ...original, x2: snapped.x, y2: snapped.y };
    gesture.current = { ...g, line }; setDraft(gesture.current);
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; pointers.current.delete(e.pointerId);
    if (!g || g.pointer !== e.pointerId) return;
    e.stopPropagation(); cancel();
    if (e.type !== "pointercancel" && (g.line.x1 !== g.line.x2 || g.line.y1 !== g.line.y2) &&
      JSON.stringify(g.line) !== JSON.stringify(g.kind === "draw" ? null : g.original)) {
      onChange?.(g.id, g.line); setSelected(g.id);
    }
  };
  const changeStyle = (patch: Partial<AnnotationLine>) => { cancel(); if (selected && lines?.[selected]) onChange?.(selected, { ...lines[selected], ...patch }); };
  const chosen = selected ? lines?.[selected] : undefined;
  const shown = draft ? { ...lines, [draft.id]: draft.line } : lines;
  const display = (x: number, y: number) => ({ x: reflected ? width - x : x, y: reflected ? depth - y : y });
  const toolbar = <div className="annotation-toolbar" data-ephemeral="true">
    {!active ? <button type="button" className="mini-button" disabled={disabled || !onChange} onClick={() => setActive(true)}>線を引く</button> : <>
      <span>線を引く</span>
      <select aria-label="線の色" value={color} onChange={e => { const next = e.target.value as AnnotationLine["color"]; setColor(next); changeStyle({ color: next }); }}>
        {Object.entries({ black: "黒", red: "赤", blue: "青", green: "緑" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="線の種類" value={dash} onChange={e => { const next = e.target.value as AnnotationLine["dash"]; setDash(next); changeStyle({ dash: next }); }}>
        <option value="solid">実線</option><option value="dashed">破線</option>
      </select>
      {chosen && <button type="button" className="mini-button" onClick={() => { cancel(); onChange?.(selected!, null); setSelected(null); }}>線を削除</button>}
      <button type="button" className="mini-button primary" onClick={finish}>完了</button>
    </>}
  </div>;
  const inkLayer = <svg className="annotation-layer" viewBox={`0 0 ${width} ${depth}`} preserveAspectRatio="none" aria-hidden="true">
    <AnnotationLines lines={shown} width={width} depth={depth} reflected={reflected} />
  </svg>;
  // One input surface owns coordinates/capture; visible ink never intercepts input.
  const interactionLayer = <svg ref={svg} data-ephemeral="true" className={`annotation-interaction-layer ${active ? "is-editing" : ""}`} viewBox={`0 0 ${width} ${depth}`} preserveAspectRatio="none"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={e => { if (active) e.preventDefault(); }}>
    {active && <g data-ephemeral="true">
      {Object.entries(lines ?? {}).map(([id, line]) => { const a = display(line.x1, line.y1), b = display(line.x2, line.y2); return <line key={id} data-line-id={id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={24 / scale} pointerEvents="stroke" />; })}
      {chosen && ["start", "end"].map(end => { const line = draft?.id === selected ? draft.line : chosen, p = end === "start" ? display(line.x1, line.y1) : display(line.x2, line.y2); return <g key={end}>
        <circle cx={p.x} cy={p.y} r={5 / scale} fill="white" stroke={annotationColors[line.color]} strokeWidth={2 / scale} pointerEvents="none" />
        <circle data-line-id={selected!} data-endpoint={end} cx={p.x} cy={p.y} r={22 / scale} fill="transparent" />
      </g>; })}
    </g>}
  </svg>;
  return { toolbar, inkLayer, interactionLayer, active };
};

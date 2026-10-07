import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Project } from "../types";
import { objectBaseSize, objectRenderShape, objectSizeLimits, type ObjectAppearancePatch, type ObjectSize } from "../project/objectAppearance";
import { ObjectShapeButtons } from "./ObjectShapeButtons";
import { horizontalGridOriginMeters } from "../utils/horizontalGrid";
import { boundedTicks } from "../utils/boundedTicks";
import { horizontalLineNumber, horizontalEmphasisFlags, verticalEmphasisFlags, lineEmphasis, type EmphasizedLine } from "../utils/gridEmphasis";
import { EmphasizedGrid } from "./EmphasizedGrid";
import "./objectShapeSizeEditor.css";

type Dimension = keyof ObjectSize;
type Drag = { pointerId: number; element: HTMLButtonElement; axis: "width" | "height" | "both";
  x: number; y: number; scale: number; pointerScale: number; size: ObjectSize; draft: ObjectSize };
type NumericDraft = { dimension: Dimension; text: string; original: number };
const numberText = (value: number) => String(Number(value.toFixed(2)));
const collapsedKey = "tairetsu-object-editor-collapsed";

export function ObjectShapeSizeEditor({ project, objectId, canEdit, readOnlyMessage, totalCount, onCommit }: {
  project: Project; objectId: string | null; canEdit: boolean; readOnlyMessage: string; totalCount: number;
  onCommit: (id: string, patch: ObjectAppearancePatch) => string | null;
}) {
  const object = project.stageObjects.find(item => item.id === objectId);
  const group = project.objectGroups?.find(item => item.objectIds.includes(objectId ?? ""));
  const previewRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 300, height: 200, pixelRatio: 1 });
  const [dragSize, setDragSize] = useState<ObjectSize | null>(null);
  const [numeric, setNumeric] = useState<NumericDraft | null>(null);
  const numericRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(collapsedKey) === "1"; } catch { return false; } });
  const key = `${project.id ?? ""}:${objectId ?? "none"}`;
  const limits = objectSizeLimits(project);
  const cancelDraft = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    setDragSize(null); setNumeric(null); setError("");
  };
  useEffect(() => { cancelDraft(); }, [key, canEdit, Boolean(object)]);
  useEffect(() => {
    // Keyboard opening may resize visualViewport; only layout resize / orientation cancels drafts.
    const cancel = () => cancelDraft();
    window.addEventListener("resize", cancel); window.addEventListener("orientationchange", cancel);
    return () => {
      window.removeEventListener("resize", cancel); window.removeEventListener("orientationchange", cancel);
      const active = drag.current; drag.current = null;
      if (active?.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    };
  }, []);
  useLayoutEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const pixelRatio = element.clientWidth && bounds.width ? Math.round(bounds.width / element.clientWidth * 100) / 100 : 1;
      // clientWidth rounds fractional layouts; keep the grid and object on one scale.
      const next = { width: bounds.width / pixelRatio || 300, height: bounds.height / pixelRatio || 200, pixelRatio };
      setViewport(previous => previous.width === next.width && previous.height === next.height && Math.abs(previous.pixelRatio - next.pixelRatio) < .001 ? previous : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element); return () => observer.disconnect();
  }, [Boolean(object), collapsed]);
  useEffect(() => { if (numeric) { numericRef.current?.focus(); numericRef.current?.select(); } }, [numeric?.dimension]);
  const commit = (patch: ObjectAppearancePatch) => {
    if (!objectId || !object || !canEdit) { cancelDraft(); return; }
    setError(onCommit(objectId, patch) ?? "");
  };
  const confirmNumber = () => {
    if (!numeric || !object) return;
    const text = numeric.text.trim(), value = Number(text);
    if (text === numberText(numeric.original)) { setNumeric(null); return; }
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(value) || value < .1 || value > limits[numeric.dimension]) {
      setError(`0.1〜${limits[numeric.dimension]}m、小数2桁までで入力してください。`); return;
    }
    setNumeric(null);
    if (value !== numeric.original) commit({ [numeric.dimension]: value });
  };
  const base = object ? objectBaseSize(project, object) : { widthMeters: 1, heightMeters: 1 };
  const size = dragSize ?? base;
  const uiPixel = 1 / viewport.pixelRatio;
  const handleSize = 44 * uiPixel;
  const handleGap = 48 * uiPixel;
  const leftMargin = 68 * uiPixel, topMargin = 46 * uiPixel;
  // Fit the actual aspect ratio, dimensions and separated touch targets together.
  // A small object has no zoom cap; thin objects reserve room for outward handles.
  const extent = (width: number, height: number) => ({
    widthOffset: height / 2 < handleSize + uiPixel ? handleGap : width < 64 * uiPixel ? handleSize / 2 + 4 * uiPixel : 0,
    heightOffset: width < 64 * uiPixel ? 96 * uiPixel + width / 2 : width / 2 < handleSize + uiPixel ? handleGap - width / 2 : 0,
    leftMargin: width < 64 * uiPixel ? Math.max(leftMargin, 96 * uiPixel + handleSize / 2) : leftMargin,
  });
  let fitScale = Math.min(viewport.width * .65 / base.widthMeters, viewport.height * .65 / base.heightMeters);
  // Shrinking can enable outward offsets. Recheck each newly required margin.
  for (let i = 0; i < 4; i++) {
    const extra = extent(base.widthMeters * fitScale, base.heightMeters * fitScale);
    const rightMargin = extra.widthOffset + handleSize / 2;
    fitScale = Math.max(.001, Math.min(fitScale,
      (viewport.width - extra.leftMargin - rightMargin) / base.widthMeters,
      (viewport.height - topMargin - handleSize / 2) / base.heightMeters));
  }
  const scale = drag.current?.scale ?? fitScale;
  const w = size.widthMeters * scale, h = size.heightMeters * scale;
  const extra = extent(w, h);
  const left = (viewport.width - w - extra.widthOffset - handleSize / 2 + extra.leftMargin) / 2;
  const top = (viewport.height - h - handleSize / 2 + topMargin) / 2;
  const right = left + w, bottom = top + h;
  const { widthOffset, heightOffset } = extra;
  const handles = {
    width: { x: right + widthOffset, y: top + h / 2, label: "幅を変えるつまみ" },
    height: { x: left + w / 2 - heightOffset, y: bottom, label: "高さを変えるつまみ" },
    both: { x: right, y: bottom, label: "幅と高さを変えるつまみ" },
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, axis: Drag["axis"]) => {
    if (!canEdit || !object || drag.current || event.button !== 0) return;
    event.preventDefault(); setNumeric(null); setError("");
    const initial = { ...base };
    drag.current = { pointerId: event.pointerId, element: event.currentTarget, axis, x: event.clientX, y: event.clientY, scale,
      pointerScale: scale * viewport.pixelRatio, size: initial, draft: initial };
    event.currentTarget.setPointerCapture(event.pointerId); setDragSize(initial);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const snap = (value: number, delta: number, max: number) => delta === 0 ? value : Math.min(max, Math.max(.1, Math.round((value + delta * 2 / active.pointerScale) * 10) / 10));
    active.draft = {
      widthMeters: active.axis === "height" ? active.size.widthMeters : snap(active.size.widthMeters, event.clientX - active.x, limits.widthMeters),
      heightMeters: active.axis === "width" ? active.size.heightMeters : snap(active.size.heightMeters, event.clientY - active.y, limits.heightMeters),
    };
    setDragSize(active.draft);
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    moveDrag(event);
    const patch: ObjectAppearancePatch = {};
    if (active.draft.widthMeters !== active.size.widthMeters) patch.widthMeters = active.draft.widthMeters;
    if (active.draft.heightMeters !== active.size.heightMeters) patch.heightMeters = active.draft.heightMeters;
    drag.current = null; setDragSize(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Object.keys(patch).length) commit(patch);
  };
  const stepNumber = (dimension: Dimension, direction: number) => {
    cancelDraft();
    if (direction < 0 && base[dimension] <= .1 || direction > 0 && base[dimension] >= limits[dimension]) return;
    const value = Math.min(limits[dimension], Math.max(.1, Number((base[dimension] + direction * .10).toFixed(2))));
    if (value !== base[dimension]) commit({ [dimension]: value });
  };
  const parade = project.mode === "parade" ? project.paradeSettings : undefined;
  const step = Math.max(.01, parade?.cellSizeMeters ?? project.stage.gridSizeMeters);
  const horizontalMode = parade?.horizontalMeasureMode === "normalMeter" ? "meters" : parade?.horizontalMeasureMode ?? project.stage.horizontalGuideMode ?? "meters";
  // Only the finite sample range is drawn, regardless of parade length.
  const sampleWidth = viewport.width / scale, sampleHeight = viewport.height / scale;
  const realWidth = limits.widthMeters;
  const origin = horizontalGridOriginMeters(realWidth, horizontalMode) - realWidth / 2 + sampleWidth / 2;
  const settings = parade ?? project.stage;
  const horizontal: EmphasizedLine[] = boundedTicks(0, sampleWidth, step, origin, 512).map(positionMeters => ({ positionMeters,
    emphasis: lineEmphasis(horizontalLineNumber(positionMeters - sampleWidth / 2 + realWidth / 2, realWidth, horizontalMode), horizontalEmphasisFlags(settings)) }));
  const vertical: EmphasizedLine[] = boundedTicks(0, sampleHeight, step, sampleHeight / 2, 512).map(positionMeters => ({ positionMeters,
    emphasis: lineEmphasis(positionMeters - sampleHeight / 2, verticalEmphasisFlags(project.stage, parade)) }));
  const heading = object ? `${object.name}（${group ? `${group.name}${group.name.endsWith("グループ") ? "" : "グループ"}` : "未所属"}）` : "形と大きさ";
  return <section className={`object-size-editor${object ? " has-selection" : ""}${collapsed ? " is-collapsed" : ""}`} aria-label="形と大きさ"
    style={{ "--object-editor-touch-size": `${handleSize}px`, "--object-editor-label-size": `${16 * uiPixel}px`,
      "--object-editor-label-height": `${20 * uiPixel}px` } as CSSProperties}>
    <header className="object-size-editor__header">
      <strong title={heading}>{heading}</strong><span className="object-size-editor__total">全体数 {totalCount}個</span>
      <button type="button" aria-expanded={!collapsed} onClick={() => {
        cancelDraft(); const next = !collapsed; setCollapsed(next);
        try { localStorage.setItem(collapsedKey, next ? "1" : "0"); } catch { /* Optional device preference. */ }
      }}>{collapsed ? "開く" : "小さくする"}</button>
    </header>
    {!collapsed && (!object ? <div className="object-size-editor__hint"><p>道具のアイコンか名前を押すと、形と大きさを設定できます</p>{!canEdit && <p>{readOnlyMessage}</p>}</div> : <div className="object-size-editor__body">
      <div className="object-size-editor__choices">
        <ObjectShapeButtons shape={object.shape} disabled={!canEdit} onChange={shape => { cancelDraft(); commit({ shape }); }} />
        <p>1マス {numberText(step)}m</p>
        <p>この道具の形と大きさを設定します</p>
        {!canEdit && <p>{readOnlyMessage}</p>}
      </div>
      <div ref={previewRef} className="object-size-editor__preview" aria-label="道具と方眼の見本" data-dragging={Boolean(dragSize)}>
        <svg width="100%" height="100%" viewBox={`0 0 ${sampleWidth} ${sampleHeight}`} preserveAspectRatio="none" aria-hidden="true"><EmphasizedGrid horizontal={horizontal} vertical={vertical} width={sampleWidth} height={sampleHeight} /></svg>
        <div className={`stage-object shape-${objectRenderShape(object)} object-size-editor__object${project.mode === "parade" && object.type === "curtain" ? " object-size-editor__curtain" : ""}`} style={{ left, top, width: w, height: h, backgroundColor: object.color }} />
        <div className="object-size-editor__dimension dimension-width" style={{ left, top: top - 34 * uiPixel, width: w }}>
          <span className="object-size-editor__width-label">{numberText(size.widthMeters)}m</span>
        </div>
        <div className="object-size-editor__dimension dimension-height" style={{ left: left - 46 * uiPixel, top, height: h }}>
          <span className="object-size-editor__height-label">{numberText(size.heightMeters)}m</span>
        </div>
        {widthOffset > 0 && <span aria-hidden="true" className="object-size-editor__handle-link link-width" style={{ left: right, top: top + h / 2, width: widthOffset }} />}
        {heightOffset > 0 && <span aria-hidden="true" className="object-size-editor__handle-link link-width" style={{ left: left + w / 2 - heightOffset, top: bottom, width: heightOffset }} />}
        {(["width", "height", "both"] as const).map(axis => <button type="button" key={axis} className={`object-size-editor__handle handle-${axis}`} disabled={!canEdit}
          aria-label={handles[axis].label} title={`${handles[axis].label}（ドラッグ、または矢印キーで0.1m）`}
          style={{ left: handles[axis].x - handleSize / 2, top: handles[axis].y - handleSize / 2 }}
          onPointerDown={event => startDrag(event, axis)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDraft}
          onLostPointerCapture={() => { if (drag.current) cancelDraft(); }}
          onKeyDown={event => {
            const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
            const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
            if (horizontal && axis !== "height" || vertical && axis !== "width") {
              event.preventDefault(); event.stopPropagation();
              stepNumber(horizontal ? "widthMeters" : "heightMeters", event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
            }
          }} />)}
      </div>
      <div className="object-size-editor__numbers">
        {(["widthMeters", "heightMeters"] as const).map(dimension => {
          const label = dimension === "widthMeters" ? "幅" : "高さ";
          return <div key={dimension}><span>{label}</span>
            {numeric?.dimension === dimension ? <form onSubmit={event => { event.preventDefault(); confirmNumber(); }}>
              <input ref={numericRef} aria-label={`${label}（m）`} inputMode="decimal" value={numeric.text} onChange={event => setNumeric({ ...numeric, text: event.target.value })}
                onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelDraft(); } }} />
              <div className="object-size-editor__numeric-actions"><button type="submit">確定</button><button type="button" onClick={cancelDraft}>取消</button></div>
            </form> : <div className="object-size-editor__stepper">
              <button type="button" disabled={!canEdit} aria-label={`${label}を0.10m小さくする`} onClick={() => stepNumber(dimension, -1)}>−</button>
              <button type="button" disabled={!canEdit} aria-label={`${label} ${numberText(size[dimension])}mを入力`} onClick={() => { cancelDraft(); setNumeric({ dimension, text: numberText(base[dimension]), original: base[dimension] }); }}>{numberText(size[dimension])} m</button>
              <button type="button" disabled={!canEdit} aria-label={`${label}を0.10m大きくする`} onClick={() => stepNumber(dimension, 1)}>＋</button>
            </div>}
          </div>;
        })}
      </div>
    </div>)}
    {error && <p className="object-size-editor__error" role="alert">{error}</p>}
  </section>;
}

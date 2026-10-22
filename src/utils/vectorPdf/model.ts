import type { Project } from "../../types";
import type { ShareExportOptions } from "../../components/ShareExportModal";
import { PRINT_RULER_X_LABEL_WIDTH_MM, defaultPrintOptions, getEffectiveSize, getPrintMetrics, getPrintRulerTopMm,
  getPrintRulerBottomMm, getPrintMemberLabelFontSizeMm, isPrintMemberVisible, getFramePrintVerticalRange,
  getParadePrintRulerLabels, getPrintSideRulerWidthMm, PRINT_STAGE_RIGHT_SAFETY_MM, type PrintMetrics } from "../printLayout";
import { createStageExportView, readablePropLabelRotation } from "../stageExportView";
import { horizontalRulerSide } from "../verticalGrid";
import { createDefaultObjectState, sortFrames } from "../interpolation";
import { GRID_LINE_TOKENS, horizontalEmphasizedLines, verticalEmphasizedLines } from "../gridEmphasis";
import { getSafeParadeBackwardDistance, normalizeParadeHorizontalMeasureMode } from "../parade";
import { createHorizontalRulerLabels, toHorizontalCountingMode } from "../horizontalRuler";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../memberAppearance";
import { getMemberLabelVariant, splitMemberLabel } from "../memberLabel";
import { objectRenderShape } from "../../project/objectAppearance";

/** Coordinates and widths are millimetres in the existing PrintPreview, before A4 fitting.
 * A group rotates clockwise about (x,y); children have local coordinates. No global stage clip. */
export type Rect = { x: number; y: number; width: number; height: number; radius?: number };
export type TextLine = { kind: "text"; text: string; x: number; y: number; size: number;
  weight: number; color: string; align?: "left" | "center" | "right";
  /** CSS inline baseline rounding, when supplied by the browser layout adapter. */
  baselineOffset?: number;
  /** Browser-only, lazy: ordinary names never need extra glyph/baseline probes. */
  measureMixed?: () => GraphemePlacement[] };
export type GraphemePlacement = { text: string; x: number; baseline: number; advance: number };
export type Drawing = TextLine
  | ({ kind: "image"; dataUrl: string; cacheKey?: string } & Rect)
  | ({ kind: "shape"; fill?: string; stroke?: string; lineWidth?: number; opacity?: number; strokeOpacity?: number } & Rect)
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number;
      opacity?: number; dash?: number[]; square?: boolean }
  /** reuse: identical groups may be written once as a shared PDF drawing (only shapes/lines, opaque). */
  | { kind: "group"; id: string; x: number; y: number; rotation: number; clip?: Rect; reuse?: boolean; children: Drawing[] };
export type ScenePage = { width: number; height: number; drawings: Drawing[]; frameId: string };
export type PropTextLayout = (text: string, width: number, height: number, correction: number, clipRadius?: number) => TextLine[];
export class UnsupportedVectorLayout extends Error {}
export const CSS_PX_MM = 25.4 / 96;
const pt = (value: number) => value * 25.4 / 72;
const text = (value: string, x: number, y: number, size: number, color: string, weight = 800,
  align: TextLine["align"] = "center"): TextLine => ({ kind: "text", text: value, x, y, size, color, weight, align });
const annotationColors = { black: "#17212b", red: "#c62828", blue: "#1565c0", green: "#237a34" };

/** Print CSS gives line/custom the default rectangle; never accept unknown shapes. */
export function printObjectShape(shape: string): "rectangle" | "circle" | "curtain" {
  if (shape === "line" || shape === "custom") return "rectangle";
  if (shape === "rectangle" || shape === "circle" || shape === "curtain") return shape;
  throw new UnsupportedVectorLayout(`道具の形 ${shape} はベクター描画未対応です。`);
}

/** CSS background-origin: padding-box, with opaque borders covering the background.
 * Local mm keep the 8px/16px pattern independent of stage metres and rotate/fit
 * exactly once with the parent object/page. Both print surfaces use this pattern. */
export function curtainStripes(id: string, rect: Rect, border: number): Drawing[] {
  const clip = { x: rect.x + border, y: rect.y + border,
    width: rect.width - 2 * border, height: rect.height - 2 * border,
    radius: Math.max(0, (rect.radius ?? 0) - border) };
  if (clip.width <= 0 || clip.height <= 0) return [];
  const children: Drawing[] = [], stripe = 8 * CSS_PX_MM;
  for (let offset = 0; offset < clip.width; offset += 2 * stripe)
    children.push({ kind: "shape", x: clip.x + offset, y: clip.y, width: stripe, height: clip.height,
      fill: "#ffffff", opacity: .28 });
  return [{ kind: "group", id: `${id}-stripes`, x: 0, y: 0, rotation: 0, clip, children }];
}

export function buildScenePage(project: Project, frameId: string, supplied: Partial<ShareExportOptions> = {},
  propText?: PropTextLayout, pageExtent?: Pick<ScenePage, "width" | "height">,
  layout?: { metrics: PrintMetrics; gapAfter: boolean }): ScenePage {
  const options = { ...defaultPrintOptions, ...supplied };
  if (options.includeHiddenMembers || options.includeNotes || options.includeSceneTime)
    throw new UnsupportedVectorLayout("非表示メンバー・メモ・時刻付きのベクター描画は未対応です。");
  const frame = project.frames.find(f => f.id === frameId);
  if (!frame) throw new UnsupportedVectorLayout("対象シーンがありません。");
  const size = getEffectiveSize(project, frame);
  const metrics = layout?.metrics ?? getPrintMetrics(project, [frame], options);
  const gapMeters = layout?.gapAfter ? metrics.gapRows * metrics.gridSizeMeters : 0;
  const isParade = project.mode === "parade";
  if (isParade && project.paradeSettings?.direction && project.paradeSettings.direction !== "up")
    throw new UnsupportedVectorLayout("パレードの進行方向はupのみ対応しています。");
  const range = getFramePrintVerticalRange(project, frame, size, metrics);
  const m = metrics.mmPerMeter, w = metrics.stageWidthMm, h = (range.depthMeters + gapMeters) * m;
  const left = getPrintSideRulerWidthMm(isParade, options.includeMeterRulers);
  const rulerTop = getPrintRulerTopMm(project, metrics, options);
  const rulerBottom = options.includeMeterRulers ? getPrintRulerBottomMm(project, metrics, options) : 0;
  // Centre counts sit beside the displayed 0m line; at the bottom the two margins swap (same height).
  const rulerAtBottom = options.includeMeterRulers &&
    horizontalRulerSide(project.stage, options.viewerPerspective, isParade) === "bottom";
  const top = rulerAtBottom ? rulerBottom : rulerTop;
  const bottom = rulerAtBottom ? rulerTop : rulerBottom;
  const view = createStageExportView(size, project.stage, options.viewerPerspective, isParade);
  const totalDistance = project.paradeSettings?.totalDistance ?? project.stage.depthMeters;
  const backward = getSafeParadeBackwardDistance(project.paradeSettings?.backwardDistanceMeters);
  const horizontalMode = toHorizontalCountingMode(normalizeParadeHorizontalMeasureMode(project.paradeSettings?.horizontalMeasureMode));
  const horizontalGrid = isParade ? horizontalEmphasizedLines(size.widthMeters, horizontalMode, metrics.gridSizeMeters,
    project.paradeSettings ?? project.stage, options.includeGrid) : view.horizontalGrid(metrics.gridSizeMeters, options.includeGrid);
  const verticalGrid = isParade ? verticalEmphasizedLines(totalDistance + backward, metrics.gridSizeMeters,
    project.stage, project.paradeSettings, options.includeGrid, range.topMeters, range.bottomMeters)
    : view.verticalGrid(metrics.gridSizeMeters, options.includeGrid);
  const drawings: Drawing[] = [text(options.includeSceneName ? frame.label : `シーン${sortFrames(project.frames).findIndex(f => f.id === frameId) + 1}`,
    10, 9 - 1.5 - pt(12) * 1.55 / 2, pt(12), "#0f766e", 900, "left")];
  const background: Drawing[] = [{ kind: "shape", x: CSS_PX_MM / 2, y: CSS_PX_MM / 2, width: w - CSS_PX_MM, height: h - CSS_PX_MM,
    fill: options.includeBackground ? "#ffffff" : undefined, stroke: "#94a3b8", lineWidth: CSS_PX_MM }];
  // CSS inset shadow occupies the inside of the stage; inset geometry preserves the outer bounds.
  for (const line of horizontalGrid) {
    const token = GRID_LINE_TOKENS[line.emphasis];
    background.push({ kind: "line", x1: line.positionMeters * m, x2: line.positionMeters * m,
      y1: 0, y2: h, color: token.color, width: token.width * CSS_PX_MM });
  }
  for (const line of verticalGrid) {
    const token = GRID_LINE_TOKENS[line.emphasis];
    background.push({ kind: "line", x1: 0, x2: metrics.commonWidthMeters * m,
      y1: (line.positionMeters - range.topMeters) * m, y2: (line.positionMeters - range.topMeters) * m, color: token.color, width: token.width * CSS_PX_MM });
  }
  // Frame and grid are identical for every scene of the same size: the renderer may store them once
  // as a shared drawing (PDF Form XObject). Everything else (centre line, annotations, props,
  // members) differs per scene or needs transparency, so it stays outside.
  const stage: Drawing[] = [{ kind: "group", id: "stage-background", x: 0, y: 0, rotation: 0, reuse: true, children: background }];
  // PrintPreview always draws this line, including when showCenterLine is false.
  stage.push({ kind: "line", x1: size.widthMeters * m / 2, x2: size.widthMeters * m / 2,
    y1: 0, y2: h, color: "#0d8b78", opacity: .45, width: 1.5 * CSS_PX_MM, square: true });
  const annotations: Drawing[] = Object.values(view.annotations(frame.annotationLines) ?? {}).map(l => ({
    kind: "line", x1: l.x1 * m, y1: (l.y1 - range.topMeters) * m, x2: l.x2 * m, y2: (l.y2 - range.topMeters) * m,
    color: annotationColors[l.color], width: 2.5 * CSS_PX_MM,
    dash: l.dash === "dashed" ? [8 * CSS_PX_MM, 6 * CSS_PX_MM] : undefined,
  }));
  stage.push({ kind: "group", id: "annotations", x: 0, y: 0, rotation: 0,
    clip: { x: 0, y: 0, width: w, height: h }, children: annotations });
  const layers: { z: number; node: Drawing }[] = [];
  for (const object of project.stageObjects) {
    const state = frame.objectStates?.[object.id] ?? createDefaultObjectState(object);
    if ((state.visible ?? object.visible) === false) continue;
    const shape = printObjectShape(objectRenderShape(object));
    if (!/^#[0-9a-f]{6}$/i.test(object.color)) throw new UnsupportedVectorLayout("道具色の形式が未対応です。");
    if (!propText && object.name) throw new UnsupportedVectorLayout("道具名のCSS文字配置計測が必要です。");
    const pos = view.object(state), ow = state.widthMeters * m, oh = state.heightMeters * m;
    const rect = { x: -ow / 2, y: -oh / 2, width: ow, height: oh, radius: shape === "circle" ? Math.min(ow, oh) / 2 : 0 };
    const inset = CSS_PX_MM / 2;
    const correction = readablePropLabelRotation(state.rotation);
    layers.push({ z: 2 + state.zIndex, node: { kind: "group", id: object.id,
      x: (pos.x + state.widthMeters / 2) * m, y: (pos.y + state.heightMeters / 2 - range.topMeters) * m,
      rotation: state.rotation, children: [
        { kind: "shape", ...rect, x: rect.x + inset, y: rect.y + inset, width: ow - 2 * inset,
          height: oh - 2 * inset, radius: Math.max(0, (rect.radius ?? 0) - inset),
          fill: object.color, stroke: object.color, lineWidth: CSS_PX_MM, opacity: 0x24 / 255 },
        ...(shape === "curtain" ? curtainStripes(object.id, rect, CSS_PX_MM) : []),
        // Text alone may overflow at the readable floor. Curtain paint keeps
        // its independent clip above; local rotation and stacking stay intact.
        { kind: "group", id: `${object.id}-label`, x: 0, y: 0, rotation: correction,
          children: propText?.(object.name, ow, oh, correction, rect.radius) ?? [] },
      ] } });
  }
  for (const member of project.members) {
    if (!frame.positions[member.id] || !isPrintMemberVisible(frame, member)) continue;
    const p = view.point(frame.positions[member.id]);
    const diameter = (project.stage.memberDiameterMeters ?? .5) * m;
    const lines = splitMemberLabel(member.name), variant = getMemberLabelVariant(lines);
    const fontSize = getPrintMemberLabelFontSizeMm(diameter, lines);
    // Four-character CSS adds a .02em gap between its .88em line boxes.
    const lineHeight = fontSize * (variant === "default" ? .84 : variant === "four" ? .90 : .88);
    const color = getMemberDisplayColor(member, { frame, groups: project.memberGroups });
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new UnsupportedVectorLayout("メンバー色の形式が未対応です。");
    layers.push({ z: 20, node: { kind: "group", id: member.id, x: p.x * m, y: (p.y - range.topMeters) * m, rotation: 0, children: [
      { kind: "shape", x: -diameter / 2, y: -diameter / 2, width: diameter, height: diameter, radius: diameter / 2, fill: color },
      ...lines.map((line, i) => text(line, 0, (i - (lines.length - 1) / 2) * lineHeight - (variant === "three" ? .04 * fontSize : 0),
        fontSize, getReadableMemberLabelColor(color))),
    ] } });
  }
  stage.push(...layers.sort((a, b) => a.z - b.z).map(l => l.node));
  if (gapMeters) stage.push({ kind: "line", x1: 0, x2: w, y1: range.depthMeters * m, y2: range.depthMeters * m,
    color: "#0f766e", opacity: .35, width: CSS_PX_MM, dash: [3 * CSS_PX_MM, 3 * CSS_PX_MM] });
  drawings.push({ kind: "group", id: "stage", x: left, y: 9 + top, rotation: 0, children: stage });
  if (options.includeMeterRulers) {
    const labels = isParade ? createHorizontalRulerLabels(size.widthMeters, horizontalMode) : view.horizontalLabels;
    // Mirrors the DOM row: 1.2mm from the far edge of a rulerTop-high band, right below the stage range.
    const labelY = rulerAtBottom ? 9 + top + range.depthMeters * m + rulerTop - 1.2 - 1.5 : 9 + 1.2 + 1.5;
    for (const label of labels) {
      if (rulerAtBottom && gapMeters) drawings.push({ kind: "shape", x: left + label.positionMeters * m - PRINT_RULER_X_LABEL_WIDTH_MM / 2,
        y: labelY - 1.5, width: PRINT_RULER_X_LABEL_WIDTH_MM, height: 3, fill: "#ffffff" });
      drawings.push(text(label.label, left + label.positionMeters * m, labelY, pt(7), "#111827", 700));
    }
    const verticalLabels = isParade ? getParadePrintRulerLabels(totalDistance, backward, range).map(l => ({
      ...l, positionMeters: l.internalY - range.topMeters,
    })) : view.verticalLabels.map(l => ({ ...l, className: undefined }));
    for (const label of verticalLabels) {
      const style = label.className === "major" ? { size: 9, weight: 800, color: "#0f172a" }
        : label.className === "medium" ? { size: 8, weight: 700, color: "#334155" }
        : label.className === "minor" ? { size: 7, weight: 600, color: "#64748b" }
        : { size: 7, weight: 700, color: "#111827" };
      drawings.push(text(label.label, left - 2, 9 + top + label.positionMeters * m, pt(style.size), style.color, style.weight, "right"));
      drawings.push(text(label.label, left + w + 3.5, 9 + top + label.positionMeters * m, pt(style.size), style.color, style.weight, "left"));
    }
  }
  if (pageExtent && (!(pageExtent.width > 0 && pageExtent.height > 0) || !Number.isFinite(pageExtent.width + pageExtent.height)))
    throw new UnsupportedVectorLayout("印刷ページの寸法が不正です。");
  return { frameId, width: left + w + (options.includeMeterRulers ? left + (isParade ? PRINT_STAGE_RIGHT_SAFETY_MM : 0) : 0), height: 9 + top + h + bottom, ...pageExtent, drawings };
}

export function visibleTextLines(drawings: Drawing[]): TextLine[] {
  return drawings.flatMap(d => d.kind === "text" ? [d] : d.kind === "group" ? visibleTextLines(d.children) : []);
}

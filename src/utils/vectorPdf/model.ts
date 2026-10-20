import type { Project } from "../../types";
import type { ShareExportOptions } from "../../components/ShareExportModal";
import { defaultPrintOptions, getEffectiveSize, getPrintMetrics, getPrintRulerTopMm,
  getPrintRulerBottomMm, getPrintMemberLabelFontSizeMm, isPrintMemberVisible } from "../../components/PrintPreview";
import { createStageExportView, readablePropLabelRotation } from "../stageExportView";
import { createDefaultObjectState, sortFrames } from "../interpolation";
import { GRID_LINE_TOKENS } from "../gridEmphasis";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../memberAppearance";
import { getMemberLabelVariant, splitMemberLabel } from "../memberLabel";
import { objectRenderShape } from "../../project/objectAppearance";

/** Coordinates and widths are millimetres in the existing PrintPreview, before A4 fitting.
 * A group rotates clockwise about (x,y); children have local coordinates. No global stage clip. */
export type Rect = { x: number; y: number; width: number; height: number; radius?: number };
export type TextLine = { kind: "text"; text: string; x: number; y: number; size: number;
  weight: number; color: string; align?: "left" | "center" | "right" };
export type Drawing = TextLine
  | ({ kind: "shape"; fill?: string; stroke?: string; lineWidth?: number; opacity?: number } & Rect)
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number;
      opacity?: number; dash?: number[]; square?: boolean }
  | { kind: "group"; id: string; x: number; y: number; rotation: number; clip?: Rect; children: Drawing[] };
export type ScenePage = { width: number; height: number; drawings: Drawing[]; frameId: string };
export type PropTextLayout = (text: string, width: number, height: number, correction: number, clipRadius?: number) => TextLine[];
export class UnsupportedVectorLayout extends Error {}
export const CSS_PX_MM = 25.4 / 96;
const pt = (value: number) => value * 25.4 / 72;
const text = (value: string, x: number, y: number, size: number, color: string, weight = 800,
  align: TextLine["align"] = "center"): TextLine => ({ kind: "text", text: value, x, y, size, color, weight, align });
const annotationColors = { black: "#17212b", red: "#c62828", blue: "#1565c0", green: "#237a34" };

export function buildScenePage(project: Project, frameId: string, supplied: Partial<ShareExportOptions> = {},
  propText?: PropTextLayout, pageExtent?: Pick<ScenePage, "width" | "height">): ScenePage {
  const options = { ...defaultPrintOptions, ...supplied };
  if (project.mode === "parade" || options.includeAssignments || options.includeHiddenMembers || options.includeNotes || options.includeSceneTime || options.layout !== "auto")
    throw new UnsupportedVectorLayout("段階①はステージ1シーン・割当欄なしのA4のみ対応しています。");
  const frame = project.frames.find(f => f.id === frameId);
  if (!frame) throw new UnsupportedVectorLayout("対象シーンがありません。");
  const size = getEffectiveSize(project, frame);
  const metrics = getPrintMetrics(project, [frame], options);
  const m = metrics.mmPerMeter, w = metrics.stageWidthMm, h = size.depthMeters * m;
  const left = options.includeMeterRulers ? 10 : 0;
  const top = getPrintRulerTopMm(project, metrics, options);
  const bottom = options.includeMeterRulers ? getPrintRulerBottomMm(project, metrics, options) : 0;
  const view = createStageExportView(size, project.stage, options.viewerPerspective);
  const drawings: Drawing[] = [text(options.includeSceneName ? frame.label : `シーン${sortFrames(project.frames).findIndex(f => f.id === frameId) + 1}`,
    10, 9 - 1.5 - pt(12) * 1.55 / 2, pt(12), "#0f766e", 900, "left")];
  const stage: Drawing[] = [{ kind: "shape", x: CSS_PX_MM / 2, y: CSS_PX_MM / 2, width: w - CSS_PX_MM, height: h - CSS_PX_MM,
    fill: options.includeBackground ? "#ffffff" : undefined, stroke: "#94a3b8", lineWidth: CSS_PX_MM }];
  // CSS inset shadow occupies the inside of the stage; inset geometry preserves the outer bounds.
  for (const line of view.horizontalGrid(metrics.gridSizeMeters, options.includeGrid)) {
    const token = GRID_LINE_TOKENS[line.emphasis];
    stage.push({ kind: "line", x1: line.positionMeters * m, x2: line.positionMeters * m,
      y1: 0, y2: h, color: token.color, width: token.width * CSS_PX_MM });
  }
  for (const line of view.verticalGrid(metrics.gridSizeMeters, options.includeGrid)) {
    const token = GRID_LINE_TOKENS[line.emphasis];
    stage.push({ kind: "line", x1: 0, x2: metrics.commonWidthMeters * m,
      y1: line.positionMeters * m, y2: line.positionMeters * m, color: token.color, width: token.width * CSS_PX_MM });
  }
  // PrintPreview always draws this line, including when showCenterLine is false.
  stage.push({ kind: "line", x1: size.widthMeters * m / 2, x2: size.widthMeters * m / 2,
    y1: 0, y2: h, color: "#0d8b78", opacity: .45, width: 1.5 * CSS_PX_MM, square: true });
  const annotations: Drawing[] = Object.values(view.annotations(frame.annotationLines) ?? {}).map(l => ({
    kind: "line", x1: l.x1 * m, y1: l.y1 * m, x2: l.x2 * m, y2: l.y2 * m,
    color: annotationColors[l.color], width: 2.5 * CSS_PX_MM,
    dash: l.dash === "dashed" ? [8 * CSS_PX_MM, 6 * CSS_PX_MM] : undefined,
  }));
  stage.push({ kind: "group", id: "annotations", x: 0, y: 0, rotation: 0,
    clip: { x: 0, y: 0, width: w, height: h }, children: annotations });
  const layers: { z: number; node: Drawing }[] = [];
  for (const object of project.stageObjects) {
    const state = frame.objectStates[object.id] ?? createDefaultObjectState(object);
    if ((state.visible ?? object.visible) === false) continue;
    const shape = objectRenderShape(object);
    if (shape !== "rectangle" && shape !== "circle") throw new UnsupportedVectorLayout("幕などの装飾は段階②以降です。");
    if (!/^#[0-9a-f]{6}$/i.test(object.color)) throw new UnsupportedVectorLayout("道具色の形式が未対応です。");
    if (!propText && object.name) throw new UnsupportedVectorLayout("道具名のCSS文字配置計測が必要です。");
    const pos = view.object(state), ow = state.widthMeters * m, oh = state.heightMeters * m;
    const rect = { x: -ow / 2, y: -oh / 2, width: ow, height: oh, radius: shape === "circle" ? Math.min(ow, oh) / 2 : 0 };
    const inset = CSS_PX_MM / 2;
    const correction = readablePropLabelRotation(state.rotation);
    layers.push({ z: 2 + state.zIndex, node: { kind: "group", id: object.id,
      x: (pos.x + state.widthMeters / 2) * m, y: (pos.y + state.heightMeters / 2) * m,
      rotation: state.rotation, children: [
        { kind: "shape", ...rect, x: rect.x + inset, y: rect.y + inset, width: ow - 2 * inset,
          height: oh - 2 * inset, radius: Math.max(0, (rect.radius ?? 0) - inset),
          fill: object.color, stroke: object.color, lineWidth: CSS_PX_MM, opacity: 0x24 / 255 },
        { kind: "group", id: `${object.id}-clip`, x: 0, y: 0, rotation: 0, clip: rect, children: [
          { kind: "group", id: `${object.id}-label`, x: 0, y: 0, rotation: correction,
            children: propText?.(object.name, ow, oh, correction, rect.radius) ?? [] },
        ] },
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
    layers.push({ z: 20, node: { kind: "group", id: member.id, x: p.x * m, y: p.y * m, rotation: 0, children: [
      { kind: "shape", x: -diameter / 2, y: -diameter / 2, width: diameter, height: diameter, radius: diameter / 2, fill: color },
      ...lines.map((line, i) => text(line, 0, (i - (lines.length - 1) / 2) * lineHeight - (variant === "three" ? .04 * fontSize : 0),
        fontSize, getReadableMemberLabelColor(color))),
    ] } });
  }
  stage.push(...layers.sort((a, b) => a.z - b.z).map(l => l.node));
  drawings.push({ kind: "group", id: "stage", x: left, y: 9 + top, rotation: 0, children: stage });
  if (options.includeMeterRulers) {
    for (const label of view.horizontalLabels) drawings.push(text(label.label, left + label.positionMeters * m, 9 + 1.2 + 1.5, pt(7), "#111827", 700));
    for (const label of view.verticalLabels) {
      drawings.push(text(label.label, left - 2, 9 + top + label.positionMeters * m, pt(7), "#111827", 700, "right"));
      drawings.push(text(label.label, left + w + 3.5, 9 + top + label.positionMeters * m, pt(7), "#111827", 700, "left"));
    }
  }
  if (pageExtent && (!(pageExtent.width > 0 && pageExtent.height > 0) || !Number.isFinite(pageExtent.width + pageExtent.height)))
    throw new UnsupportedVectorLayout("印刷ページの寸法が不正です。");
  return { frameId, width: left + w + (options.includeMeterRulers ? 10 : 0), height: 9 + top + h + bottom, ...pageExtent, drawings };
}

export function visibleTextLines(drawings: Drawing[]): TextLine[] {
  return drawings.flatMap(d => d.kind === "text" ? [d] : d.kind === "group" ? visibleTextLines(d.children) : []);
}

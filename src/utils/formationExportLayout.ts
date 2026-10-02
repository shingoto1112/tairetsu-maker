import type { FormationFrame, Project } from "../types";
import { createDefaultObjectState } from "./interpolation";
import { resolveExportFrames } from "./exportFrames";
import { getSafeParadeCanvasDistance, internalYToParadeDistance } from "./parade";
import { MOBILE_INNER_WIDTH, MOBILE_MAX_HEIGHT, MOBILE_PADDING, type TextMeasure } from "./mobileExportLayout";
import type { ExportSource, FormationSnapshot } from "./mobileExportTypes";
import type { StageDrawingRange } from "../components/StaticStagePreview";
import { FORMATION_SIDE, formationRulerSide } from "./formationRulers";

export { FORMATION_SIDE } from "./formationRulers";
export const FORMATION_TOP = 38;
export const FORMATION_BOTTOM = 16;
export const FORMATION_DRAW_WIDTH = MOBILE_INNER_WIDTH - FORMATION_SIDE * 2;
export const DETAIL_MIN_DIAMETER_PX = 64;
export const DETAIL_MAX_COLUMNS = 3;
export const TILE_OVERLAP_METERS = 0.5;
const PAGE_HEADER = 30;
const BLOCK_GAP = 16;
const MINIMAP_HEIGHT = 72;

export const createFormationSnapshot = (source: ExportSource, scope: "current" | "all"): FormationSnapshot => {
  if (!source.project) throw new Error("隊列表の設定を読み込めませんでした。");
  const project = structuredClone(source.project);
  project.frames = resolveExportFrames(project).filter((frame) => scope === "all" || frame.id === source.currentFrame?.id);
  if (!project.frames.length) throw new Error("書き出すシーンがありません。");
  return { title: project.title, exportedAt: new Date().toISOString(), project,
    scopeLabel: scope === "all" ? "全シーン" : project.frames[0].label };
};

export const formationSize = (project: Project, frame: FormationFrame) => {
  const global = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  return project.mode === "parade"
    ? { width: Math.max(1, project.paradeSettings?.width ?? project.stage.widthMeters),
      depth: getSafeParadeCanvasDistance(project.paradeSettings?.totalDistance ?? project.stage.depthMeters, project.paradeSettings?.backwardDistanceMeters) }
    : { width: Math.max(1, global ? project.stage.widthMeters : frame.stageWidthMeters ?? project.stage.widthMeters),
      depth: Math.max(0.01, global ? project.stage.depthMeters : frame.stageDepthMeters ?? project.stage.depthMeters) };
};

export const rotatedObjectBounds = (state: { x: number; y: number; widthMeters: number; heightMeters: number; rotation: number }) => {
  const angle = state.rotation * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(angle)) * state.widthMeters + Math.abs(Math.sin(angle)) * state.heightMeters) / 2;
  const halfHeight = (Math.abs(Math.sin(angle)) * state.widthMeters + Math.abs(Math.cos(angle)) * state.heightMeters) / 2;
  const x = state.x + state.widthMeters / 2, y = state.y + state.heightMeters / 2;
  return { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight };
};

export const formationVerticalRange = (project: Project, frame: FormationFrame) => {
  const size = formationSize(project, frame);
  const radius = Math.max(0.01, project.stage.memberDiameterMeters ?? 0.5) / 2;
  if (project.mode !== "parade") return { top: -radius, bottom: size.depth + radius };
  const assigned = new Set(Object.values(frame.objectAssignments ?? {}).flat());
  let top = Infinity, bottom = -Infinity;
  for (const member of project.members) {
    const position = frame.positions[member.id];
    if (!position || member.visible === false || frame.memberVisibility?.[member.id] === false || assigned.has(member.id)) continue;
    top = Math.min(top, position.y - radius); bottom = Math.max(bottom, position.y + radius);
  }
  for (const object of project.stageObjects) {
    const state = frame.objectStates?.[object.id] ?? createDefaultObjectState(object);
    if ((state.visible ?? object.visible) === false) continue;
    const bounds = rotatedObjectBounds(state);
    top = Math.min(top, bounds.top); bottom = Math.max(bottom, bounds.bottom);
  }
  if (!Number.isFinite(top)) return { top: 0, bottom: Math.min(10, size.depth) };
  const step = Math.max(0.01, project.paradeSettings?.cellSizeMeters ?? project.stage.gridSizeMeters);
  // Preserve rotated bounds even if a prop extends beyond the route edge.
  return { top: Math.min(top, Math.max(0, Math.floor((top - 2) / step) * step)),
    bottom: Math.max(bottom, Math.min(size.depth, Math.ceil((bottom + 2) / step) * step)) };
};

export type HorizontalTile = { left: number; right: number; coreLeft: number; coreRight: number; index: number; count: number };
export const horizontalTiles = (width: number, diameter: number, drawWidth = FORMATION_DRAW_WIDTH): HorizontalTile[] => {
  const maximum = diameter * drawWidth * 2 / DETAIL_MIN_DIAMETER_PX;
  const overlap = TILE_OVERLAP_METERS;
  const radius = diameter / 2;
  // Outer bleed and shared boundaries consume space, so count using the actual viewport.
  for (let count = 1; count <= DETAIL_MAX_COLUMNS; count++) {
    const tiles = Array.from({ length: count }, (_, index) => ({
      coreLeft: width * index / count, coreRight: width * (index + 1) / count,
      left: index === 0 ? -radius : width * index / count - overlap / 2,
      right: index === count - 1 ? width + radius : width * (index + 1) / count + overlap / 2,
      index, count,
    }));
    if (count === DETAIL_MAX_COLUMNS || tiles.every((tile) => tile.right - tile.left <= maximum + 1e-6)) return tiles;
  }
  throw new Error("拡大図の分割数を計算できませんでした。");
};

export type FormationBlock = {
  frame: FormationFrame; stageWidth: number; fullRange: StageDrawingRange; range: StageDrawingRange;
  scale: number; side: number; height: number; headingHeight: number; caption: string; detail: boolean;
  tile?: HorizontalTile; slice: number; slices: number; overlapTop: number; overlapBottom: number;
};
export type FormationPage = { blocks: FormationBlock[]; height: number; pageNumber: number; totalPages: number };
export const sceneTimeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const number = (value: number) => Number(value.toFixed(1));
export const formationDistanceLabel = (project: Project, range: StageDrawingRange) => {
  if (project.mode !== "parade") return `${number(range.top)}〜${number(range.bottom)}m`;
  const total = project.paradeSettings?.totalDistance ?? project.stage.depthMeters;
  const backward = project.paradeSettings?.backwardDistanceMeters;
  return `${internalYToParadeDistance(range.top, total, backward)}〜${internalYToParadeDistance(range.bottom, total, backward)}m`;
};

/** Layout is bounded before drawing. No scene is rasterized into a full-length parade canvas. */
export const planFormationPages = (snapshot: FormationSnapshot, includeDetails: boolean, measure: TextMeasure): FormationPage[] => {
  const { project } = snapshot;
  const diameter = Math.max(0.01, project.stage.memberDiameterMeters ?? 0.5), radius = diameter / 2;
  const side = formationRulerSide(project), drawWidth = MOBILE_INNER_WIDTH - side * 2;
  const widths = project.frames.map((frame) => formationSize(project, frame).width);
  let overviewScale = drawWidth / (Math.max(...widths) + diameter);
  // All stage overviews share one scale, including unusually deep stages; never split these blocks.
  if (project.mode !== "parade") for (const frame of project.frames) {
    const heading = measure(frame.label, MOBILE_INNER_WIDTH, 30, 38, true) + 26;
    const depth = formationSize(project, frame).depth + diameter;
    overviewScale = Math.min(overviewScale, (MOBILE_MAX_HEIGHT - MOBILE_PADDING * 2 - PAGE_HEADER - heading - FORMATION_TOP - FORMATION_BOTTOM - BLOCK_GAP) / depth);
  }
  if (!(overviewScale > 0)) throw new Error("シーン名が長く、隊列表をページに収められません。");
  const pages: FormationPage[] = [];
  let used = MOBILE_PADDING * 2 + PAGE_HEADER;
  const start = () => { pages.push({ blocks: [], height: MOBILE_MAX_HEIGHT, pageNumber: pages.length + 1, totalPages: 0 }); used = MOBILE_PADDING * 2 + PAGE_HEADER; };
  const add = (block: FormationBlock, separate: boolean) => {
    if (!pages.length || (pages[pages.length - 1].blocks.length && (separate || used + block.height > MOBILE_MAX_HEIGHT + 1e-6))) start();
    pages[pages.length - 1].blocks.push(block); used += block.height;
  };
  const blocksFor = (frame: FormationFrame, tile?: HorizontalTile) => {
    const size = formationSize(project, frame), vertical = formationVerticalRange(project, frame);
    const fullRange = { left: -radius, right: size.width + radius, ...vertical };
    const detail = Boolean(tile);
    const range = { ...fullRange, left: tile?.left ?? fullRange.left, right: tile?.right ?? fullRange.right };
    let scale = tile ? drawWidth / (tile.right - tile.left) : overviewScale;
    const positionLabel = tile ? tile.count === 1 ? "拡大図" : tile.count === 2 ? (tile.index === 0 ? "左側" : "右側") : tile.index === 0 ? "左側" : tile.index === tile.count - 1 ? "右側" : "中央" : "全体図";
    const caption = tile ? `${positionLabel}（${tile.index + 1}/${tile.count}）` : positionLabel;
    const headingHeight = measure(frame.label, MOBILE_INNER_WIDTH, 30, 38, true) + 26
      + (detail || project.mode === "parade" ? measure(caption + "・続き 999/999・距離 -9999〜9999m", MOBILE_INNER_WIDTH, 18, 26) : 0);
    const overhead = headingHeight + FORMATION_TOP + FORMATION_BOTTOM + BLOCK_GAP + (detail ? MINIMAP_HEIGHT : 0);
    const availableHeight = MOBILE_MAX_HEIGHT - MOBILE_PADDING * 2 - PAGE_HEADER - overhead;
    // Stage pages never split in depth. Fit each tile without changing its aspect ratio.
    if (project.mode !== "parade") scale = Math.min(scale, availableHeight / (range.bottom - range.top));
    if (!(scale > 0)) throw new Error("シーン名が長く、図をページに収められません。");
    const capacity = availableHeight / scale;
    const overlap = TILE_OVERLAP_METERS;
    if (project.mode === "parade" && !(capacity > overlap)) throw new Error("シーン名が長く、図をページに収められません。");
    const spans: { top: number; bottom: number }[] = [];
    let top = range.top;
    while (top < range.bottom - 1e-6) {
      const bottom = project.mode !== "parade" ? range.bottom : Math.min(range.bottom, top + capacity);
      spans.push({ top, bottom });
      if (bottom >= range.bottom) break;
      top = bottom - overlap;
    }
    for (const [slice, span] of spans.entries()) {
      const cropped = { ...range, ...span };
      add({ frame, stageWidth: size.width, fullRange, range: cropped, scale, side, detail, tile, slice: slice + 1, slices: spans.length,
        caption: detail || spans.length > 1 ? `${caption}${spans.length > 1 ? `・続き ${slice + 1}/${spans.length}・${formationDistanceLabel(project, cropped)}` : ""}` : "",
        headingHeight, height: Math.ceil(overhead + (span.bottom - span.top) * scale - 1e-6),
        overlapTop: slice > 0 ? overlap : 0, overlapBottom: slice < spans.length - 1 ? overlap : 0 }, detail || spans.length > 1);
    }
  };
  for (const frame of project.frames) blocksFor(frame);
  if (includeDetails) for (const frame of project.frames) {
    const tiles = horizontalTiles(formationSize(project, frame).width, diameter, drawWidth);
    if (tiles.length > 1 || diameter * overviewScale * 2 < DETAIL_MIN_DIAMETER_PX) for (const tile of tiles) blocksFor(frame, tile);
  }
  if (pages.length) pages[pages.length - 1].height = Math.ceil(used);
  return pages.map((page) => ({ ...page, totalPages: pages.length }));
};

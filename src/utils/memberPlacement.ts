import type { FormationFrame, Position, Project, ViewerPerspective } from "../types";
import { objectSceneBounds } from "../project/objectAppearance";
import { constrainMemberPosition } from "./coordinates";
import { getSnapshotForFrame } from "./interpolation";
import { horizontalGridOriginMeters, snapHorizontalPositionInBounds } from "./horizontalGrid";

const EPS = 1e-9;
const clean = (value: number) => Number(value.toFixed(9));
export const MEMBER_PLACEMENT_OVERLAP_NOTICE = "空きがないため一部を重ねて置きました。";

/** Center bounds and circle sizes match the canvases. Hidden members reserve space too.
 * Only call at placement entry points; never normalize existing scene coordinates. */
export function placeNewMembers(project: Project, frame: FormationFrame, count: number, origin?: Position,
  perspective: ViewerPerspective | undefined = project.viewerPerspective,
  excludedIds: ReadonlySet<string> = new Set()): {
  positions: Position[]; overlapCount: number;
} {
  const bounds = objectSceneBounds(project, frame);
  const stage = { ...project.stage, widthMeters: bounds.widthMeters, depthMeters: bounds.heightMeters };
  const parade = project.mode === "parade";
  const diameter = parade ? stage.memberDiameterMeters ?? 0.5 : Math.min(1, Math.max(0.2, stage.memberDiameterMeters ?? 0.5));
  const grid = parade ? project.paradeSettings?.cellSizeMeters ?? stage.gridSizeMeters
    : stage.showGrid ? stage.gridSizeMeters : NaN;
  const gridOrigin = horizontalGridOriginMeters(stage.widthMeters,
    parade ? project.paradeSettings?.horizontalMeasureMode : stage.horizontalGuideMode);
  const base = constrainMemberPosition(origin ?? { x: stage.widthMeters / 2, y: stage.depthMeters / 2 }, stage);
  base.x = snapHorizontalPositionInBounds(base.x, grid, gridOrigin, 0, stage.widthMeters);
  // Skip sub-diameter grid points, without adding vertical snapping to normal additions.
  const xStep = Number.isFinite(grid) && grid > 0 ? Math.ceil(diameter / grid) * grid : diameter;
  const yStep = diameter;
  const buckets = new Map<string, Position[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const reserve = (p: Position) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const k = key(Math.floor(p.x / diameter), Math.floor(p.y / diameter));
    const bucket = buckets.get(k) ?? []; bucket.push(p); buckets.set(k, bucket);
  };
  const snapshot = getSnapshotForFrame(project, frame.id);
  for (const member of project.members) {
    if (excludedIds.has(member.id)) continue;
    const p = snapshot.positions[member.id]; if (p) reserve(p);
  }
  const free = (p: Position) => {
    const bx = Math.floor(p.x / diameter), by = Math.floor(p.y / diameter);
    for (let x = bx - 1; x <= bx + 1; x++) for (let y = by - 1; y <= by + 1; y++) {
      if (buckets.get(key(x, y))?.some(q => Math.hypot(p.x - q.x, p.y - q.y) < diameter - EPS)) return false;
    }
    return true;
  };
  // Lazy rows: a long parade never allocates/scans its smallest-grid lattice.
  function* axis(base: number, step: number, max: number, minEdge = 0, maxEdge = max) {
    yield base;
    const positive = Math.floor((max - base + EPS) / step), negative = Math.floor((base + EPS) / step);
    for (let n = 1; n <= Math.max(positive, negative); n++) {
      if (n <= positive) yield clean(base + n * step);
      if (n <= negative) yield clean(base - n * step);
    }
    // End points can fit even when the regular stride leaves a narrow remainder.
    if (Math.abs(base - minEdge) > EPS) yield minEdge;
    if (Math.abs(base - maxEdge) > EPS) yield maxEdge;
  }
  const left = snapHorizontalPositionInBounds(0, grid, gridOrigin, 0, stage.widthMeters);
  const right = snapHorizontalPositionInBounds(stage.widthMeters, grid, gridOrigin, 0, stage.widthMeters);
  // One row's evenly spaced spots through the start point, left to right as the user sees the stage
  // (the performer view mirrors it; parades are always drawn from the audience). The edges are a
  // last resort after them, so a block never gets an uneven gap at its end.
  const mirrored = !parade && perspective === "performer";
  const rowXs = [...axis(base.x, xStep, stage.widthMeters, base.x, base.x)].sort((a, b) => mirrored ? b - a : a - b);
  const edgeXs = [left, right].filter((x, i, all) => all.indexOf(x) === i && !rowXs.some(v => Math.abs(v - x) <= EPS));
  const startIndex = Math.max(0, rowXs.findIndex(x => Math.abs(x - base.x) <= EPS));
  const positions: Position[] = [];
  let remaining = count;
  for (const y of axis(base.y, yStep, stage.depthMeters)) {
    if (remaining === 0) break;
    const open = rowXs.flatMap((x, index) => free({ x, y }) ? [index] : []);
    // An empty row takes the new members in order as one block centred on the start point.
    // A row already in use continues to the right of the start point, then fills its left side.
    const order = open.length === rowXs.length
      ? (() => {
        const size = Math.min(remaining, rowXs.length);
        const first = Math.max(0, Math.min(rowXs.length - size, startIndex - Math.floor((size - 1) / 2)));
        return Array.from({ length: size }, (_, k) => first + k);
      })()
      : [...open.filter(index => index >= startIndex), ...open.filter(index => index < startIndex)];
    for (const x of [...order.map(index => rowXs[index]), ...edgeXs]) {
      if (remaining === 0) break;
      const position = { x, y };
      if (!free(position)) continue;
      positions.push(position); reserve(position); remaining--;
    }
  }
  const overlapCount = remaining;
  for (; remaining > 0; remaining--) positions.push({ ...base });
  return { positions, overlapCount };
}

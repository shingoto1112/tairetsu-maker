import type { AnnotationLine, Position } from "../types";
import { horizontalGridOriginMeters, snapHorizontalPositionInBounds } from "./horizontalGrid";
import { snapPositionInBounds } from "./positionGrid";
export const copyAnnotationLines = (lines?: Record<string, AnnotationLine>): Record<string, AnnotationLine> =>
  Object.fromEntries(Object.values(lines ?? {}).map(line => [crypto.randomUUID(), { ...line }]));
// Only gesture entry points snap. Existing/synchronized coordinates stay intact.
export const snapAnnotationPoint = (p: Position, width: number, depth: number, step: number, mode?: string, verticalOrigin = 0): Position => ({
  x: snapHorizontalPositionInBounds(p.x, step / 2, horizontalGridOriginMeters(width, mode === "centerSplit" ? "centerSplit" : "meters"), 0, width),
  y: snapPositionInBounds(p.y, step / 2, verticalOrigin, 0, depth),
});
export const translateAnnotationLine = (line: AnnotationLine, p: Position): AnnotationLine => {
  const dx = p.x - line.x1, dy = p.y - line.y1;
  return { ...line, x1: p.x, y1: p.y, x2: line.x2 + dx, y2: line.y2 + dy };
};

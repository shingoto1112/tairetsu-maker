import type { AnnotationLine, Position } from "../types";
import { horizontalGridOriginMeters, snapHorizontalPositionInBounds } from "./horizontalGrid";
export const copyAnnotationLines = (lines?: Record<string, AnnotationLine>): Record<string, AnnotationLine> =>
  Object.fromEntries(Object.values(lines ?? {}).map(line => [crypto.randomUUID(), { ...line }]));
export const snapAnnotationPoint = (p: Position, width: number, depth: number, step: number, mode?: string): Position => ({
  x: snapHorizontalPositionInBounds(p.x, step, horizontalGridOriginMeters(width, mode === "centerSplit" ? "centerSplit" : "meters"), 0, width),
  y: snapHorizontalPositionInBounds(p.y, step, 0, 0, depth),
});
export const translateAnnotationLine = (line: AnnotationLine, p: Position): AnnotationLine => {
  const dx = p.x - line.x1, dy = p.y - line.y1;
  return { ...line, x1: p.x, y1: p.y, x2: line.x2 + dx, y2: line.y2 + dy };
};

import type { AnnotationLine } from "../types";
import { memo } from "react";
export const annotationColors = { black: "#17212b", red: "#c62828", blue: "#1565c0", green: "#237a34" };
// Keep original endpoints across crops; clipping preserves dash phase.
export const AnnotationLines = memo(({ lines, top = 0, width = 0, depth = 0, reflected = false }: {
  lines?: Record<string, AnnotationLine>; top?: number; width?: number; depth?: number; reflected?: boolean;
}) => Object.keys(lines ?? {}).length === 0 ? null : <g className="annotation-lines" pointerEvents="none">
  {Object.entries(lines ?? {}).map(([id, line]) => <line key={id} data-annotation-line={id}
    x1={reflected ? width - line.x1 : line.x1} y1={(reflected ? depth - line.y1 : line.y1) - top}
    x2={reflected ? width - line.x2 : line.x2} y2={(reflected ? depth - line.y2 : line.y2) - top}
    stroke={annotationColors[line.color]} strokeWidth="2.5" vectorEffect="non-scaling-stroke"
    strokeLinecap="butt" strokeDasharray={line.dash === "dashed" ? "8 6" : undefined} />)}
</g>);

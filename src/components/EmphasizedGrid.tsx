import type { EmphasizedLine } from "../utils/gridEmphasis";
import { GRID_LINE_TOKENS } from "../utils/gridEmphasis";
/** Same tokens as the HTML editor; vector widths stay in CSS pixels on export. */
export const EmphasizedGrid = ({ horizontal, vertical, width, height, top = 0 }: {
  horizontal: EmphasizedLine[]; vertical: EmphasizedLine[]; width: number; height: number; top?: number;
}) => <>{horizontal.map(line => <line key={"x-" + line.positionMeters}
  className={line.kind === "counting" ? "print-counting-line" : "print-grid-lines"}
  data-emphasis={line.emphasis} data-position={line.positionMeters}
  x1={line.positionMeters} x2={line.positionMeters} y1={0} y2={height}
  stroke={GRID_LINE_TOKENS[line.emphasis].color} strokeWidth={GRID_LINE_TOKENS[line.emphasis].width}
  vectorEffect="non-scaling-stroke" />)}
  {vertical.map(line => <line key={"y-" + line.positionMeters} className={"print-distance-line " + (line.emphasis === "10" ? "print-distance-line--major" : "")}
    data-emphasis={line.emphasis} data-position={line.positionMeters}
    x1={0} x2={width} y1={line.positionMeters - top} y2={line.positionMeters - top}
    stroke={GRID_LINE_TOKENS[line.emphasis].color} strokeWidth={GRID_LINE_TOKENS[line.emphasis].width}
    vectorEffect="non-scaling-stroke" />)}</>;

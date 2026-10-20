import type { AnnotationLine, ObjectState, Position, StageConfig, ViewerPerspective } from "../types";
import { stagePointToDisplayPoint } from "./coordinates";
import { horizontalEmphasizedLines, stageVerticalRulerPositions, verticalEmphasizedLines } from "./gridEmphasis";
import { createHorizontalRulerLabels } from "./horizontalRuler";
import { stageVerticalGridOriginMeters } from "./verticalGrid";

/** Rotation for a prop name placed inside its already-rotated shape. The name follows the prop's long
 * axis (an upright name is clipped inside a thin diagonal prop) but is turned by 180° whenever it would
 * read upside down, so the net text angle stays within (-90°, 90°].
 */
export const readablePropLabelRotation = (rotation: number): number => {
  const angle = Number.isFinite(rotation) ? rotation : 0;
  let net = ((angle % 360) + 360) % 360;
  if (net > 270) net -= 360;
  else if (net > 90) net -= 180;
  return net - angle;
};

/** Full effective scene coordinates, before cropping or adding inter-scene space.
 * Text and prop rotation are deliberately independent of the position transform.
 */
export const createStageExportView = (
  size: Pick<StageConfig, "widthMeters" | "depthMeters">,
  stage: StageConfig,
  perspective: ViewerPerspective = "audience",
  isParade = false,
) => {
  const reflected = !isParade && perspective === "performer";
  const x = (value: number) => reflected ? size.widthMeters - value : value;
  const y = (value: number) => reflected ? size.depthMeters - value : value;
  const point = (value: Position) => stagePointToDisplayPoint(value, { ...stage, ...size }, reflected ? "performer" : "audience");
  const topOrigin = stageVerticalGridOriginMeters(size.depthMeters, stage) === 0;
  const mode = stage.horizontalGuideMode ?? "meters";
  return {
    point, x, y,
    object: (state: ObjectState): ObjectState => ({ ...state,
      x: reflected ? x(state.x) - state.widthMeters : state.x,
      y: reflected ? y(state.y) - state.heightMeters : state.y,
    }),
    annotations: (lines?: Record<string, AnnotationLine>) => lines && Object.fromEntries(
      Object.entries(lines).map(([id, line]) => [id, { ...line,
        x1: x(line.x1), y1: y(line.y1), x2: x(line.x2), y2: y(line.y2),
      }]),
    ),
    horizontalLabels: createHorizontalRulerLabels(size.widthMeters, mode)
      .map(label => ({ ...label, positionMeters: x(label.positionMeters) })),
    verticalLabels: stageVerticalRulerPositions(size.depthMeters, topOrigin).map(internalY => ({
      positionMeters: y(internalY), label: `${Number((topOrigin ? internalY : size.depthMeters - internalY).toFixed(2))}m`,
    })),
    horizontalGrid: (step: number, includeGrid: boolean) => horizontalEmphasizedLines(size.widthMeters, mode, step, stage, includeGrid)
      .map(line => ({ ...line, positionMeters: x(line.positionMeters) })),
    verticalGrid: (step: number, includeGrid: boolean) => verticalEmphasizedLines(size.depthMeters, step, stage, undefined, includeGrid)
      .map(line => ({ ...line, positionMeters: y(line.positionMeters) })),
  };
};

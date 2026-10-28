import type { FormationFrame, Project, ViewerPerspective } from "../types";
import { defaultPrintOptions, PrintStagePreview } from "./PrintStagePreview";
import { FORMATION_TOP, FORMATION_BOTTOM } from "../utils/formationExportLayout";
import { formationRulerSide } from "../utils/formationRulers";

export type StageDrawingRange = { left: number; right: number; top: number; bottom: number };
const MM_PER_PX = 25.4 / 96;

/** The shared print drawing at an explicit CSS scale, with no A4 layout calculation. */
export const StaticStagePreview = ({ project, frame, stageWidth, range, outputWidth, side = formationRulerSide(project), wholeMembersWithinRange = false, viewerPerspective = "audience", highlightedObjectId, hideLabels }: {
  project: Project; frame: FormationFrame; stageWidth: number; range: StageDrawingRange; outputWidth: number; side?: number;
  wholeMembersWithinRange?: boolean; viewerPerspective?: ViewerPerspective; highlightedObjectId?: string; hideLabels?: boolean;
}) => {
  const pxPerMeter = (outputWidth - side * 2) / (range.right - range.left);
  return <div className="static-stage-preview">
  <PrintStagePreview project={project} frame={frame} commonWidthMeters={stageWidth} gapAfter={false} highlightedObjectId={highlightedObjectId} hideLabels={hideLabels} labelPurpose="preview"
    options={{ ...defaultPrintOptions, viewerPerspective }}
    verticalRange={{ topMeters: range.top, bottomMeters: range.bottom, depthMeters: range.bottom - range.top }}
    viewport={{ leftMeters: range.left, rightMeters: range.right, sideMm: side * MM_PER_PX,
      topMm: FORMATION_TOP * MM_PER_PX, bottomMm: FORMATION_BOTTOM * MM_PER_PX, wholeMembersWithinRange }}
    metrics={{ assignmentSideGapMm: 0, assignmentSideWidthMm: 0, commonWidthMeters: stageWidth,
      gapRows: 0, gridSizeMeters: Math.max(0.01, project.mode === "parade"
        ? project.paradeSettings?.cellSizeMeters ?? project.stage.gridSizeMeters : project.stage.gridSizeMeters),
      mmPerMeter: pxPerMeter * MM_PER_PX, orientation: "portrait", pageUsableHeightMm: 0,
      stageWidthMm: (range.right - range.left) * pxPerMeter * MM_PER_PX }} />
</div>;
};

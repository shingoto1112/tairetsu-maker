import { useMemo } from "react";
import type { FormationFrame, Project, ViewerPerspective } from "../types";
import { createDefaultObjectState, getSnapshotForFrame } from "../utils/interpolation";
import { FORMATION_BOTTOM, FORMATION_TOP, formationSize, formationVerticalRange } from "../utils/formationExportLayout";
import { formationRulerSide } from "../utils/formationRulers";
import { StaticStagePreview } from "./StaticStagePreview";
import "./rosterAssignmentPreview.css";

type Props = {
  project: Project;
  viewerPerspective?: ViewerPerspective;
  frame: FormationFrame;
  highlightedObjectId?: string;
  /** Width available beside the scene strip (px). Nothing is drawn until it is known. */
  maxWidth?: number;
  /** Height of the drawing including rulers (px). */
  maxHeight?: number;
};

/** Drawing height used beside the scene strip; small enough to leave the assignment list most of the screen. */
export const rosterPreviewHeight = (viewportHeight: number) => Math.max(140, Math.min(210, Math.round(viewportHeight * 0.2)));

/**
 * Read-only drawing of one scene for the roster assignment screen. Uses the
 * export drawing without names (no editing events) and resolves only the selected scene.
 * Stage and parade both fit the height; parade shows only the range people and props occupy.
 */
export const RosterAssignmentStagePreview = ({ project, viewerPerspective = "audience", frame, highlightedObjectId, maxWidth = 0, maxHeight = 180 }: Props) => {
  // Inherited positions/props must match the scene thumbnails, so resolve the snapshot.
  const resolved = useMemo<FormationFrame>(() => ({ ...frame, ...getSnapshotForFrame(project, frame.id) }), [project, frame]);
  const size = formationSize(project, resolved);
  const vertical = formationVerticalRange(project, resolved);
  const side = formationRulerSide(project);
  const depthMeters = Math.max(0.5, vertical.bottom - vertical.top);
  const drawingHeight = Math.max(40, maxHeight - FORMATION_TOP - FORMATION_BOTTOM);
  const fitWidth = Math.floor(side * 2 + size.width * drawingHeight / depthMeters);
  const outputWidth = Math.min(Math.floor(maxWidth), fitWidth);
  const drawn = outputWidth > 80;
  const highlighted = highlightedObjectId ? project.stageObjects.find((object) => object.id === highlightedObjectId) : undefined;
  const highlightedHidden = !!highlighted &&
    ((resolved.objectStates[highlighted.id] ?? createDefaultObjectState(highlighted)).visible ?? highlighted.visible) === false;
  return <section className="roster-stage-preview" aria-label={`${frame.label} の隊列（見るだけ）`}
    style={drawn ? { width: outputWidth } : undefined}>
    <div className="roster-stage-preview__drawing">
      {drawn && <StaticStagePreview viewerPerspective={viewerPerspective} project={project} frame={resolved} stageWidth={size.width} side={side}
        range={{ left: 0, right: size.width, top: vertical.top, bottom: vertical.bottom }}
        outputWidth={outputWidth} highlightedObjectId={highlightedObjectId} hideLabels />}
    </div>
    {highlightedHidden && <p className="roster-stage-preview__note">「{highlighted!.name}」はこのシーンでは非表示です。</p>}
  </section>;
};

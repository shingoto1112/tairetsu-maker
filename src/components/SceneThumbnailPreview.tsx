import { AnnotationLines } from "./AnnotationLines";
import { memo } from "react";
import type { FormationFrame, Project, StageObject } from "../types";
import { createDefaultObjectState, getSnapshotForFrame } from "../utils/interpolation";
import { getMemberDisplayColor } from "../utils/memberAppearance";
import { getSafeParadeCanvasDistance } from "../utils/parade";
import { formationVerticalRange } from "../utils/formationExportLayout";

const getFrameStageSize = (
  project: Project,
  frame: FormationFrame,
): { widthMeters: number; depthMeters: number } => {
  if (project.mode === "parade") {
    return {
      widthMeters: project.paradeSettings?.width ?? 20,
      depthMeters: getSafeParadeCanvasDistance(
        project.paradeSettings?.totalDistance ?? 100,
        project.paradeSettings?.backwardDistanceMeters ?? 0,
      ),
    };
  }
  const useGlobal = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  return {
    widthMeters: useGlobal
      ? project.stage.widthMeters
      : frame.stageWidthMeters ?? project.stage.widthMeters,
    depthMeters: useGlobal
      ? project.stage.depthMeters
      : frame.stageDepthMeters ?? project.stage.depthMeters,
  };
};

const objectOpacity = (object: StageObject): number =>
  object.type === "curtain" ? 0.42 : 0.32;


type Props = { project: Project; frame: FormationFrame; visible: boolean };

export const SceneThumbnailPreview = memo(function SceneThumbnailPreview({project, frame, visible}: Props) {
  // Leave an identically sized SVG placeholder; card labels and interaction stay live.
  if (!visible) return <svg className="scene-thumbnail-preview" aria-hidden="true" />;
  const snapshot = getSnapshotForFrame(project, frame.id);
  const stageSize = getFrameStageSize(project, frame);
  const width = Math.max(1, stageSize.widthMeters);
  const depth = Math.max(1, stageSize.depthMeters);
  const isDenseProject = project.members.length >= 120;
  // Parade routes are long: show only the span people and props occupy, as exports do.
  // Annotation lines far from everyone may be cut off.
  const isParade = project.mode === "parade";
  const range = isParade ? formationVerticalRange(project, { ...frame, ...snapshot }) : { top: 0, bottom: depth };
  const top = range.top;
  const height = Math.max(1, range.bottom - range.top);
  // Keep parade dots about as large on screen as on a 12m stage.
  const radiusScale = isParade ? Math.max(1, width / 12) : 1;
  return (
    <svg
      className="scene-thumbnail-preview"
      viewBox={`0 ${top} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect
        x="0"
        y={top}
        width={width}
        height={height}
        rx="0.08"
        fill="#ffffff"
        stroke="#d8e2ec"
        strokeWidth="0.04"
      />
      <line
        x1={width / 2}
        y1={top}
        x2={width / 2}
        y2={top + height}
        stroke="#0d8b78"
        strokeOpacity="0.35"
        strokeWidth="0.035"
      />
      <AnnotationLines lines={frame.annotationLines} />
      {project.stageObjects.map((object) => {
        const state =
          snapshot.objectStates[object.id] ??
          createDefaultObjectState(object);
        if (state.visible === false) {
          return null;
        }
        const objectWidth = Math.max(0.08, state.widthMeters);
        const objectHeight = Math.max(0.08, state.heightMeters);
        const x = state.x;
        const y = state.y;
        return (
          <rect
            key={object.id}
            x={x}
            y={y}
            width={objectWidth}
            height={objectHeight}
            rx={object.shape === "circle" ? objectWidth / 2 : 0.06}
            fill={object.color}
            fillOpacity={objectOpacity(object)}
            stroke={object.color}
            strokeWidth="0.04"
          />
        );
      })}
      {project.members.map((member) => {
        if (
          member.visible === false ||
          snapshot.memberVisibility[member.id] === false
        ) {
          return null;
        }
        const position = snapshot.positions[member.id];
        if (!position) {
          return null;
        }
        return (
          <circle
            key={member.id}
            cx={position.x}
            cy={position.y}
            r={(isDenseProject ? 0.075 : 0.11) * radiusScale}
            fill={getMemberDisplayColor(member, {
              groups: project.memberGroups ?? [],
              snapshot,
            })}
            stroke="#ffffff"
            strokeWidth={(isDenseProject ? 0.025 : 0.04) * radiusScale}
          />
        );
      })}
    </svg>
  );
}, (previous, next) => {
  const a = previous.project, b = next.project;
  // Snapshot fallback can inherit positions/object states from any earlier frame.
  // Comparing only the current frame would leave those inherited previews stale.
  return previous.visible === next.visible && previous.frame === next.frame &&
    a.frames === b.frames && a.members === b.members && a.stageObjects === b.stageObjects &&
    a.memberGroups === b.memberGroups && a.stage === b.stage &&
    a.mode === b.mode && a.paradeSettings === b.paradeSettings &&
    a.useGlobalStageSize === b.useGlobalStageSize && a.useGlobalStageWidth === b.useGlobalStageWidth;
});

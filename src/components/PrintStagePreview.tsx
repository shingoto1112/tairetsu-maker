// Layout constants and calculations live in utils/printLayout (shared with the A4 preview and the vector PDF).
// This file only draws one scene; the names other modules import from here are re-exported unchanged.
import {
  PRINT_RULER_X_LABEL_WIDTH_MM, PRINT_RULER_Y_LABEL_HEIGHT_MM, PRINT_STAGE_RIGHT_SAFETY_MM,
  getAssignmentEntryPrintLayout, getAssignmentMemberSizeMm, getAssignmentObjectPrintSize, getAssignmentPrintEntries,
  getEffectiveSize, getObjectState, getParadePrintRulerLabels, getPrintMemberDiameterMm,
  getPrintMemberLabelFontSizeMm, getPrintRulerBottomMm, getPrintRulerTopMm,
  getPrintSideRulerWidthMm, isMemberVisible, metersToPrintCenteredMm, metersToPrintMm, shouldPrintAssignmentSide,
  shouldPrintRightRuler,
} from "../utils/printLayout";
import type { PrintMetrics, SceneVerticalRange } from "../utils/printLayout";
export {
  PRINT_SCENE_TITLE_MM, defaultPrintOptions, getEffectiveSize, getFramePrintVerticalRange, getPrintMetrics,
  getPrintOrientation, paginateFrames,
} from "../utils/printLayout";
export type { PrintOrientation } from "../utils/printLayout";
import { PrintObjectLabel } from "./PrintObjectLabel";
import { createStageExportView, readablePropLabelRotation } from "../utils/stageExportView";
import { horizontalRulerSide } from "../utils/verticalGrid";
import { useId } from "react";
import { AnnotationLines } from "./AnnotationLines";
import { horizontalEmphasizedLines, verticalEmphasizedLines } from "../utils/gridEmphasis";
import { EmphasizedGrid } from "./EmphasizedGrid";
import { createHorizontalRulerLabels, toHorizontalCountingMode } from "../utils/horizontalRuler";
import type { CSSProperties } from "react";
import {
  FormationFrame,
  Member,
  Project,
} from "../types";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../utils/memberAppearance";
import {
  getMemberLabelClassName,
  splitMemberLabel,
} from "../utils/memberLabel";
import {
  getSafeParadeBackwardDistance,
  normalizeParadeHorizontalMeasureMode,
} from "../utils/parade";
import type { ShareExportOptions } from "./ShareExportModal";

export const PrintStagePreview = ({
  commonWidthMeters,
  frame,
  gapAfter,
  metrics,
  project,
  verticalRange,
  options,
  viewport,
  highlightedObjectId,
  hideLabels = false,
  labelPurpose = "export",
}: {
  commonWidthMeters: number;
  frame: FormationFrame;
  gapAfter: boolean;
  metrics: PrintMetrics;
  project: Project;
  verticalRange: SceneVerticalRange;
  options: ShareExportOptions;
  /** Static exports supply dimensions directly; absent values preserve A4 exactly. */
  viewport?: { leftMeters: number; rightMeters: number; sideMm: number; topMm: number; bottomMm: number; wholeMembersWithinRange?: boolean };
  /** Read-only previews (roster assignment) outline one prop; exports never pass it. */
  highlightedObjectId?: string;
  /** Read-only previews may omit member and prop names; exports always draw them. */
  hideLabels?: boolean;
  labelPurpose?: "export" | "preview";
}) => {
  const annotationClipId = useId();
  const isParade = project.mode === "parade";
  const horizontalGuideMode = isParade
    ? normalizeParadeHorizontalMeasureMode(
        project.paradeSettings?.horizontalMeasureMode,
      ) === "centerSplit"
      ? "centerSplit"
      : "meters"
    : project.stage.horizontalGuideMode ?? "meters";
  const leftMeters = viewport?.leftMeters ?? 0;
  const rightMeters = viewport?.rightMeters ?? commonWidthMeters;
  const wholeMembersWithinRange = viewport?.wholeMembersWithinRange && !isParade;
  const inRange = (x: number) => !viewport || (x >= leftMeters && x <= rightMeters);
  const sceneWidthMeters = getEffectiveSize(project, frame).widthMeters;
  const view = createStageExportView(getEffectiveSize(project, frame), project.stage, options.viewerPerspective, isParade);
  const horizontalLabels = (isParade ? createHorizontalRulerLabels(sceneWidthMeters, toHorizontalCountingMode(horizontalGuideMode)) : view.horizontalLabels).filter((item) => inRange(item.positionMeters));
  const gapMeters = gapAfter ? metrics.gapRows * metrics.gridSizeMeters : 0;
  const totalDepthMeters = verticalRange.depthMeters + gapMeters;
  const stageHeightMm = totalDepthMeters * metrics.mmPerMeter;
  const memberDiameterMm = getPrintMemberDiameterMm(project, metrics);
  const assignmentMemberSizeMm = getAssignmentMemberSizeMm(project, metrics);
  const rulerTopMm = viewport?.topMm ?? getPrintRulerTopMm(project, metrics, options);
  const rulerBottomMm = viewport?.bottomMm ?? getPrintRulerBottomMm(project, metrics, options);
  // The centre-count row sits beside the displayed 0m line. At the bottom it is drawn right below the
  // stage range (above any scene gap) and the two margins swap, so heights and page breaks stay the same.
  const rulerAtBottom = options.includeMeterRulers &&
    horizontalRulerSide(project.stage, options.viewerPerspective, isParade) === "bottom";
  const topSideMm = rulerAtBottom ? rulerBottomMm : rulerTopMm;
  const bottomSideMm = rulerAtBottom ? rulerTopMm : rulerBottomMm;
  const leftRulerMm = viewport?.sideMm ?? getPrintSideRulerWidthMm(
    isParade,
    options.includeMeterRulers,
  );
  const rightRulerMm = viewport?.sideMm ?? (shouldPrintRightRuler(options)
    ? getPrintSideRulerWidthMm(isParade, true)
    : 0);
  const stageRightSafetyMm =
    !viewport && isParade && rightRulerMm > 0 ? PRINT_STAGE_RIGHT_SAFETY_MM : 0;
  const totalPreviewWidthMm =
    leftRulerMm + metrics.stageWidthMm + rightRulerMm + stageRightSafetyMm;
  const totalDistance =
    project.paradeSettings?.totalDistance ?? project.stage.depthMeters;
  const backwardDistanceMeters = getSafeParadeBackwardDistance(
    project.paradeSettings?.backwardDistanceMeters,
  );
  const verticalRulerLabels = isParade
    // Shared with the A4 preview and the vector PDF: at most 16,384 marks, so a huge distance cannot stall the page.
    ? getParadePrintRulerLabels(totalDistance, backwardDistanceMeters, verticalRange).map(item => ({
        className: item.className, key: item.meter, label: item.label,
        top: metersToPrintCenteredMm(item.internalY - verticalRange.topMeters, metrics, PRINT_RULER_Y_LABEL_HEIGHT_MM),
      }))
    : view.verticalLabels.filter(item => item.positionMeters >= verticalRange.topMeters - 1e-7 && item.positionMeters <= verticalRange.bottomMeters + 1e-7).map(item => ({
        className: undefined, key: item.positionMeters, label: item.label,
        top: metersToPrintCenteredMm(item.positionMeters - verticalRange.topMeters, metrics, PRINT_RULER_Y_LABEL_HEIGHT_MM),
      }));
  const horizontalGridLines = (isParade ? horizontalEmphasizedLines(sceneWidthMeters,
    toHorizontalCountingMode(horizontalGuideMode), metrics.gridSizeMeters,
    project.paradeSettings ?? project.stage, options.includeGrid) : view.horizontalGrid(metrics.gridSizeMeters, options.includeGrid)).filter(line => inRange(line.positionMeters));
  const verticalGridLines = isParade ? verticalEmphasizedLines(totalDistance + backwardDistanceMeters,
    metrics.gridSizeMeters, project.stage, project.paradeSettings,
    options.includeGrid, verticalRange.topMeters, verticalRange.bottomMeters)
    : view.verticalGrid(metrics.gridSizeMeters, options.includeGrid).filter(line => line.positionMeters >= verticalRange.topMeters - 1e-7 && line.positionMeters <= verticalRange.bottomMeters + 1e-7);
  const previewStyle = {
    gridTemplateColumns: `${leftRulerMm}mm ${metrics.stageWidthMm}mm ${rightRulerMm}mm`,
    gridTemplateRows: `${topSideMm}mm ${stageHeightMm}mm`,
    paddingBottom: `${bottomSideMm}mm`,
    paddingRight: `${stageRightSafetyMm}mm`,
    width: `${totalPreviewWidthMm}mm`,
    "--print-member-size": `${memberDiameterMm}mm`,
    "--print-ruler-bottom-mm": `${bottomSideMm}mm`,
    "--print-ruler-left-mm": `${leftRulerMm}mm`,
    "--print-ruler-right-mm": `${rightRulerMm}mm`,
    "--print-ruler-top-mm": `${topSideMm}mm`,
    ...(rulerAtBottom ? {
      "--print-ruler-x-top-mm": `${topSideMm + verticalRange.depthMeters * metrics.mmPerMeter}mm`,
      "--print-ruler-x-height-mm": `${rulerTopMm}mm`,
    } : {}),
    "--print-stage-right-safety-mm": `${stageRightSafetyMm}mm`,
    "--print-stage-center-x-mm": metersToPrintMm(sceneWidthMeters / 2, metrics),
    "--print-stage-height-mm": `${stageHeightMm}mm`,
    "--print-stage-width-mm": `${metrics.stageWidthMm}mm`,
  } as CSSProperties;

  const renderMemberIcon = (
    member: Member,
    key: string,
    centerXMeters: number,
    centerYMeters: number,
    extraClassName = "",
    zIndex = 20,
  ) => {
    const memberColor = getMemberDisplayColor(member, {
      frame,
      groups: project.memberGroups ?? [],
    });
    const labelLines = splitMemberLabel(member.name);
    const memberLabelClassName = getMemberLabelClassName(
      "print-member",
      labelLines,
    );
    const labelColor = getReadableMemberLabelColor(memberColor);
    return (
      <span
        className={`print-member ${memberLabelClassName} ${extraClassName}`.trim()}
        title={member.name}
        role="img"
        aria-label={member.name}
        key={key}
        style={{
          backgroundColor: memberColor,
          color: labelColor,
          fontSize: `${getPrintMemberLabelFontSizeMm(memberDiameterMm, labelLines, labelPurpose)}mm`,
          left: metersToPrintCenteredMm(
            centerXMeters - leftMeters,
            metrics,
            memberDiameterMm,
          ),
          top: metersToPrintCenteredMm(
            centerYMeters - verticalRange.topMeters,
            metrics,
            memberDiameterMm,
          ),
          zIndex,
        }}
      >
        {!hideLabels && <span className="print-member__label" aria-hidden="true">
          {labelLines.map((line, index) => (
            <span className="print-member__label-line" key={`${key}-print-label-${index}`}>
              {line}
            </span>
          ))}
        </span>}
      </span>
    );
  };

  const renderAssignmentMemberIcon = (member: Member, key: string) => {
    const memberColor = getMemberDisplayColor(member, {
      frame,
      groups: project.memberGroups ?? [],
    });
    const labelLines = splitMemberLabel(member.name);
    const memberLabelClassName = getMemberLabelClassName(
      "print-member",
      labelLines,
    );
    const labelColor = getReadableMemberLabelColor(memberColor);
    return (
      <span
        className={`print-assignment-sheet__member ${memberLabelClassName}`}
        title={member.name}
        role="img"
        aria-label={member.name}
        key={key}
        style={{
          backgroundColor: memberColor,
          color: labelColor,
          fontSize: `${getPrintMemberLabelFontSizeMm(
            assignmentMemberSizeMm,
            labelLines,
            labelPurpose,
          )}mm`,
        }}
      >
        <span className="print-member__label" aria-hidden="true">
          {labelLines.map((line, index) => (
            <span
              className="print-member__label-line"
              key={`${key}-assignment-label-${index}`}
            >
              {line}
            </span>
          ))}
        </span>
      </span>
    );
  };

  const renderAssignmentPanel = () => {
    const assignmentEntries = getAssignmentPrintEntries(project, frame);

    return (
      <div
        className="print-assignment-sheet"
        style={
          {
            minHeight: `${stageHeightMm + rulerTopMm + rulerBottomMm}mm`,
            width: `${metrics.assignmentSideWidthMm}mm`,
            "--print-assignment-grid-size": `${metersToPrintMm(
              metrics.gridSizeMeters,
              metrics,
            )}`,
            "--print-assignment-member-size": `${assignmentMemberSizeMm}mm`,
          } as CSSProperties
        }
      >
        {assignmentEntries.length === 0 ? (
          <p className="print-assignment-sheet__empty">
            {isParade ? "道具割当なし" : "このシーンの道具割当はありません"}
          </p>
        ) : (
          <div className="print-assignment-sheet__items">
            {assignmentEntries.map((entry) => {
              const layout = getAssignmentEntryPrintLayout(
                entry,
                metrics,
                assignmentMemberSizeMm,
              );
              const objectSize = getAssignmentObjectPrintSize(
                entry.state,
                metrics,
                layout.objectMaxWidthMm,
              );
              return (
                <article
                  className={[
                    "print-assignment-sheet__card",
                    layout.compact
                      ? "print-assignment-sheet__card--compact"
                      : "print-assignment-sheet__card--wide",
                  ].join(" ")}
                  key={entry.object.id}
                >
                  <div
                    className={`print-assignment-sheet__object shape-${entry.object.shape}`}
                    style={{
                      backgroundColor: `${entry.object.color}24`,
                      borderColor: entry.object.color,
                      height: `${objectSize.heightMm}mm`,
                      width: `${objectSize.widthMm}mm`,
                    }}
                  >
                    <PrintObjectLabel text={entry.object.name} width={objectSize.widthMm} height={objectSize.heightMm} />
                  </div>
                  <div
                    className="print-assignment-sheet__members"
                    style={{ width: `${objectSize.widthMm}mm` }}
                  >
                    {entry.assignedMembers.map((member) =>
                      renderAssignmentMemberIcon(
                        member,
                        `assignment-sheet-${entry.object.id}-${member.id}`,
                      ),
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const members = project.members.map((member) => {
    const storedPosition = frame.positions[member.id];
    const position = storedPosition && view.point(storedPosition);
    if (!position || !isMemberVisible(frame, member)) return null;
    // Tile ranges already include the shared band. Test centers, not circle bounds.
    if (wholeMembersWithinRange && !(position.x >= leftMeters && position.x <= rightMeters
      && position.y >= verticalRange.topMeters && position.y <= verticalRange.bottomMeters)) return null;
    return renderMemberIcon(member, member.id, position.x, position.y);
  });

  const stagePreview = (
    <div
      className={[
        "print-stage-preview",
        !options.includeMeterRulers ? "without-rulers" : "",
        rulerAtBottom ? "is-ruler-bottom" : "",
        rulerAtBottom && gapAfter ? "has-scene-gap" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={previewStyle}
    >
      {options.includeMeterRulers && (
        <>
          <div className="print-ruler-corner" />
          <div className="print-ruler print-ruler-x">
            {horizontalLabels.map((item) => (
              <span key={`x-${item.key}`} style={{
                left: metersToPrintCenteredMm(item.positionMeters - leftMeters, metrics, PRINT_RULER_X_LABEL_WIDTH_MM),
              }}>{item.label}</span>
            ))}
          </div>
          <div className="print-ruler print-ruler-y print-ruler-y--left">
            {verticalRulerLabels.map((item) => (
              <span
                className={item.className}
                key={`y-left-${item.key}`}
                style={{ top: item.top }}
              >
                {item.label}
              </span>
            ))}
          </div>
          {rightRulerMm > 0 && (
            <div className="print-ruler print-ruler-y print-ruler-y--right">
              {verticalRulerLabels.map((item) => (
                <span
                  className={item.className}
                  key={`y-right-${item.key}`}
                  style={{ top: item.top }}
                >
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div
        className={[
          "print-stage",
          !options.includeBackground ? "without-background" : "",
          !options.includeGrid ? "without-grid" : "",
        ]
        .filter(Boolean)
        .join(" ")}
      >
        <svg
          aria-hidden="true"
          className="print-stage-guides"
          focusable="false"
          preserveAspectRatio="none"
          viewBox={`${leftMeters} 0 ${rightMeters - leftMeters} ${totalDepthMeters}`}
        >
          {viewport && <rect x="0" y={-verticalRange.topMeters} width={commonWidthMeters}
            height={getEffectiveSize(project, frame).depthMeters} fill="none" stroke="#94a3b8"
            strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          <EmphasizedGrid horizontal={horizontalGridLines} vertical={verticalGridLines}
            width={commonWidthMeters} height={totalDepthMeters} top={verticalRange.topMeters} />
          <line
            className="print-center-line"
            stroke="rgba(13, 139, 120, 0.45)"
            strokeLinecap="square"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            x1={sceneWidthMeters / 2}
            x2={sceneWidthMeters / 2}
            y1="0"
            y2={totalDepthMeters}
          />
          {Object.keys(frame.annotationLines ?? {}).length > 0 && <><defs><clipPath id={annotationClipId}><rect x={leftMeters} y="0" width={rightMeters - leftMeters} height={totalDepthMeters} /></clipPath></defs>
          <g clipPath={"url(#" + annotationClipId + ")"}><AnnotationLines lines={view.annotations(frame.annotationLines)} top={verticalRange.topMeters} /></g></>}
        </svg>
        {gapAfter && (
          <span
            className="print-scene-gap-start"
            style={{ top: metersToPrintMm(verticalRange.depthMeters, metrics) }}
          />
        )}

        {project.stageObjects.map((object) => {
          const state = getObjectState(frame, object);
          if (!((state.visible ?? object.visible) !== false)) {
            return null;
          }
          const displayedState = view.object(state);
          const objectLeftMeters = displayedState.x - leftMeters;
          const objectTopMeters = displayedState.y - verticalRange.topMeters;
          return (
            <div
              className={`print-object shape-${object.shape}${object.id === highlightedObjectId ? " is-highlighted" : ""}`}
              key={object.id}
              style={{
                backgroundColor: `${object.color}24`,
                borderColor: object.color,
                height: metersToPrintMm(state.heightMeters, metrics),
                left: metersToPrintMm(objectLeftMeters, metrics),
                top: metersToPrintMm(objectTopMeters, metrics),
                transform: `rotate(${state.rotation}deg)`,
                width: metersToPrintMm(state.widthMeters, metrics),
                zIndex: 2 + state.zIndex,
              }}
            >
              {!hideLabels && <PrintObjectLabel text={object.name} width={state.widthMeters * metrics.mmPerMeter}
                height={state.heightMeters * metrics.mmPerMeter} rotation={state.rotation} correction={readablePropLabelRotation(state.rotation)} />}
            </div>
          );
        })}

        {!wholeMembersWithinRange && members}
      </div>
      {wholeMembersWithinRange && (
        // Keep props clipped inside .print-stage; whole circles may bleed into its margins.
        <div className="print-stage-members" style={{ gridColumn: 2, gridRow: 2, position: "relative",
          width: `${metrics.stageWidthMm}mm`, height: `${stageHeightMm}mm`, overflow: "visible", pointerEvents: "none" }}>
          {members}
        </div>
      )}
    </div>
  );

  if (shouldPrintAssignmentSide(options)) {
    return (
      <div
        className="print-stage-with-assignments"
        style={
          {
            gap: `${metrics.assignmentSideGapMm}mm`,
            width: `${
              totalPreviewWidthMm +
              metrics.assignmentSideGapMm +
              metrics.assignmentSideWidthMm
            }mm`,
          } as CSSProperties
        }
      >
        {stagePreview}
        {renderAssignmentPanel()}
      </div>
    );
  }

  return stagePreview;
};

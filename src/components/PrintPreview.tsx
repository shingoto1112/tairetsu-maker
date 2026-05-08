import type { CSSProperties, Ref } from "react";
import {
  FormationFrame,
  Member,
  ObjectState,
  Project,
  StageObject,
} from "../types";
import { createDefaultObjectState, sortFrames } from "../utils/interpolation";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../utils/memberAppearance";
import {
  getMemberLabelClassName,
  getMemberLabelFontSize,
  splitMemberLabel,
} from "../utils/memberLabel";
import {
  getSafeParadeBackwardDistance,
  getSafeParadeCanvasDistance,
  internalYToParadeDistance,
  normalizeParadeHorizontalMeasureMode,
  paradeDistanceToInternalY,
} from "../utils/parade";
import type { ShareExportOptions } from "./ShareExportModal";

type PrintPreviewProps = {
  project: Project;
  scope?: "all" | "current";
  selectedFrameId?: string | null;
  options?: ShareExportOptions;
  rootRef?: Ref<HTMLDivElement>;
  variant?: "document" | "stage-only";
};

type EffectiveStageSize = {
  widthMeters: number;
  depthMeters: number;
};

type SceneVerticalRange = {
  bottomMeters: number;
  depthMeters: number;
  topMeters: number;
};

export type PrintOrientation = "landscape" | "portrait";

type PrintMetrics = {
  commonWidthMeters: number;
  gapRows: number;
  gridSizeMeters: number;
  mmPerMeter: number;
  orientation: PrintOrientation;
  pageUsableHeightMm: number;
  stageWidthMm: number;
};

type CenterSplitLabel = {
  key: string;
  label: string;
  positionMeters: number;
};

const PRINT_A4_SHORT_USABLE_MM = 190;
const PRINT_A4_LONG_USABLE_MM = 277;
const PRINT_RULER_LEFT_MM = 10;
const PRINT_PARADE_RULER_SIDE_MM = 18;
const PRINT_RULER_TOP_MM = 6;
const PRINT_RULER_BOTTOM_MM = 3;
const PRINT_SCENE_TITLE_MM = 9;
const PRINT_STAGE_RIGHT_SAFETY_MM = 8;
const PRINT_STAGE_MEMBER_CLEARANCE_MM = 1.5;

const defaultPrintOptions: ShareExportOptions = {
  includeAssignments: false,
  includeBackground: true,
  includeGrid: true,
  includeHiddenMembers: false,
  includeMeterRulers: true,
  includeNotes: false,
  includeSceneName: true,
  includeSceneTime: false,
  layout: "auto",
  sceneGapRows: 5,
};

const getPrintSideRulerWidthMm = (
  isParade: boolean,
  includeMeterRulers: boolean,
): number => {
  if (!includeMeterRulers) {
    return 0;
  }
  return isParade ? PRINT_PARADE_RULER_SIDE_MM : PRINT_RULER_LEFT_MM;
};

const getEffectiveSize = (
  project: Project,
  frame: FormationFrame,
): EffectiveStageSize => {
  if (project.mode === "parade") {
    const totalDistance =
      project.paradeSettings?.totalDistance ?? project.stage.depthMeters;
    const backwardDistance = project.paradeSettings?.backwardDistanceMeters;
    return {
      widthMeters: Math.max(project.paradeSettings?.width ?? project.stage.widthMeters, 1),
      depthMeters: Math.max(getSafeParadeCanvasDistance(totalDistance, backwardDistance), 1),
    };
  }

  const useGlobal =
    project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  return {
    widthMeters: useGlobal
      ? project.stage.widthMeters
      : frame.stageWidthMeters ?? project.stage.widthMeters,
    depthMeters: useGlobal
      ? project.stage.depthMeters
      : frame.stageDepthMeters ?? project.stage.depthMeters,
  };
};

const formatMeter = (value: number): string => {
  const rounded = Number(value.toFixed(2));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return normalized > 0 ? `+${normalized}m` : `${normalized}m`;
};

const formatHorizontalRulerLabel = (
  tick: number,
  widthMeters: number,
  mode: Project["stage"]["horizontalGuideMode"],
): string => {
  const centeredMeters = tick - widthMeters / 2;
  if (mode !== "centerSplit") {
    return formatMeter(centeredMeters);
  }
  if (Math.abs(centeredMeters) < 0.001) {
    return "";
  }
  const absolute = Math.abs(centeredMeters);
  return Number.isInteger(absolute) ? String(absolute) : String(Number(absolute.toFixed(2)));
};

const createCenterSplitLabels = (widthMeters: number): CenterSplitLabel[] => {
  const safeWidth = Math.max(0, widthMeters);
  const center = safeWidth / 2;
  const leftCount = Math.floor(center + 0.001);
  const rightCount = Math.floor(safeWidth - center + 0.001);
  const labels: CenterSplitLabel[] = [];

  for (let index = leftCount; index >= 1; index -= 1) {
    labels.push({
      key: `left-${index}`,
      label: String(index),
      positionMeters: center - index + 0.5,
    });
  }

  for (let index = 1; index <= rightCount; index += 1) {
    labels.push({
      key: `right-${index}`,
      label: String(index),
      positionMeters: center + index - 0.5,
    });
  }

  return labels.filter(
    (item) => item.positionMeters >= 0 && item.positionMeters <= safeWidth,
  );
};

const getTickStep = (meters: number): number => {
  if (meters > 24) return 4;
  if (meters > 14) return 2;
  if (meters > 8) return 1;
  return 0.5;
};

const buildTicks = (meters: number): number[] => {
  const step = getTickStep(meters);
  const ticks: number[] = [];
  for (let value = 0; value <= meters + 0.001; value += step) {
    ticks.push(Number(value.toFixed(2)));
  }
  if (ticks[ticks.length - 1] !== meters) {
    ticks.push(meters);
  }
  return ticks;
};

const metersToPrintMm = (meters: number, metrics: PrintMetrics): string =>
  `${meters * metrics.mmPerMeter}mm`;

const getObjectState = (
  frame: FormationFrame,
  object: StageObject,
): ObjectState => frame.objectStates?.[object.id] ?? createDefaultObjectState(object);

const isMemberAssigned = (
  frame: FormationFrame,
  memberId: string,
): boolean =>
  Object.values(frame.objectAssignments ?? {}).some((memberIds) =>
    memberIds.includes(memberId),
  );

const isMemberVisible = (frame: FormationFrame, member: Member): boolean =>
  (member.visible ?? true) &&
  frame.memberVisibility?.[member.id] !== false &&
  !isMemberAssigned(frame, member.id);

export const getPrintOrientation = (project: Project): PrintOrientation =>
  project.mode === "parade" ? "portrait" : "landscape";

const getPrintPageUsableSize = (
  orientation: PrintOrientation,
): { height: number; width: number } =>
  orientation === "portrait"
    ? {
        height: PRINT_A4_LONG_USABLE_MM,
        width: PRINT_A4_SHORT_USABLE_MM,
      }
    : {
        height: PRINT_A4_SHORT_USABLE_MM,
        width: PRINT_A4_LONG_USABLE_MM,
      };

const getPrintMetrics = (
  project: Project,
  frames: FormationFrame[],
  options: ShareExportOptions,
): PrintMetrics => {
  const isParade = project.mode === "parade";
  const orientation = getPrintOrientation(project);
  const pageSize = getPrintPageUsableSize(orientation);
  const leftRulerWidthMm = getPrintSideRulerWidthMm(
    isParade,
    options.includeMeterRulers,
  );
  const rightRulerWidthMm =
    isParade && options.includeMeterRulers
      ? getPrintSideRulerWidthMm(true, true)
      : 0;
  const commonWidthMeters = Math.max(
    1,
    ...frames.map((frame) => getEffectiveSize(project, frame).widthMeters),
    isParade
      ? (project.paradeSettings?.width ?? project.stage.widthMeters)
      : project.stage.widthMeters,
  );
  const stageWidthMm = Math.max(
    40,
    pageSize.width -
      leftRulerWidthMm -
      rightRulerWidthMm -
      PRINT_STAGE_RIGHT_SAFETY_MM,
  );
  return {
    commonWidthMeters,
    gapRows: Math.max(0, options.sceneGapRows ?? 5),
    gridSizeMeters: Math.max(
      isParade
        ? (project.paradeSettings?.cellSizeMeters ?? project.stage.gridSizeMeters ?? 1)
        : project.stage.gridSizeMeters || 0.25,
      0.01,
    ),
    mmPerMeter: stageWidthMm / commonWidthMeters,
    orientation,
    pageUsableHeightMm: pageSize.height,
    stageWidthMm,
  };
};

const snapDown = (value: number, step: number): number =>
  Math.floor(value / step + 0.0001) * step;

const snapUp = (value: number, step: number): number =>
  Math.ceil(value / step - 0.0001) * step;

const getFramePrintVerticalRange = (
  project: Project,
  frame: FormationFrame,
  stageSize: EffectiveStageSize,
  metrics: PrintMetrics,
): SceneVerticalRange => {
  if (project.mode !== "parade") {
    return {
      bottomMeters: stageSize.depthMeters,
      depthMeters: stageSize.depthMeters,
      topMeters: 0,
    };
  }

  const totalDistance = Math.max(
    project.paradeSettings?.totalDistance ?? project.stage.depthMeters,
    1,
  );
  const backwardDistanceMeters = getSafeParadeBackwardDistance(
    project.paradeSettings?.backwardDistanceMeters,
  );
  const canvasDistanceMeters = getSafeParadeCanvasDistance(
    totalDistance,
    backwardDistanceMeters,
  );
  const memberRadiusMeters = Math.max(project.stage.memberDiameterMeters ?? 0.5, 0.01) / 2;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  project.members.forEach((member) => {
    const position = frame.positions[member.id];
    if (!position || !isMemberVisible(frame, member)) {
      return;
    }
    minY = Math.min(minY, position.y - memberRadiusMeters);
    maxY = Math.max(maxY, position.y + memberRadiusMeters);
  });

  project.stageObjects.forEach((object) => {
    const state = getObjectState(frame, object);
    if (!((state.visible ?? object.visible) !== false)) {
      return;
    }
    minY = Math.min(minY, state.y);
    maxY = Math.max(maxY, state.y + state.heightMeters);
  });

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    const emptyDepth = Math.min(
      canvasDistanceMeters,
      Math.max(10, metrics.gridSizeMeters * 10),
    );
    return {
      bottomMeters: emptyDepth,
      depthMeters: emptyDepth,
      topMeters: 0,
    };
  }

  const step = Math.max(metrics.gridSizeMeters, 0.01);
  const topMeters = Math.max(0, snapDown(minY - 3, step));
  const bottomMeters = Math.min(canvasDistanceMeters, snapUp(maxY + 3, step));
  const safeBottomMeters =
    bottomMeters > topMeters
      ? bottomMeters
      : Math.min(canvasDistanceMeters, topMeters + Math.min(canvasDistanceMeters, 6));

  return {
    bottomMeters: safeBottomMeters,
    depthMeters: Math.max(safeBottomMeters - topMeters, step),
    topMeters,
  };
};

const getPrintMemberDiameterMm = (
  project: Project,
  metrics: PrintMetrics,
): number => (project.stage.memberDiameterMeters ?? 0.5) * metrics.mmPerMeter;

const getPrintRulerTopMm = (
  project: Project,
  metrics: PrintMetrics,
  options: ShareExportOptions,
): number => {
  if (!options.includeMeterRulers) {
    return 0;
  }
  const memberRadiusMm = getPrintMemberDiameterMm(project, metrics) / 2;
  return Math.max(
    PRINT_RULER_TOP_MM,
    memberRadiusMm + PRINT_STAGE_MEMBER_CLEARANCE_MM + 3,
  );
};

const getPrintRulerBottomMm = (
  project: Project,
  metrics: PrintMetrics,
  options: ShareExportOptions,
): number => {
  const memberRadiusMm = getPrintMemberDiameterMm(project, metrics) / 2;
  return Math.max(
    options.includeMeterRulers ? PRINT_RULER_BOTTOM_MM : 0,
    memberRadiusMm + PRINT_STAGE_MEMBER_CLEARANCE_MM,
  );
};

const getSceneBaseHeightMm = (
  project: Project,
  frame: FormationFrame,
  metrics: PrintMetrics,
  options: ShareExportOptions,
): number => {
  const stageSize = getEffectiveSize(project, frame);
  const verticalRange = getFramePrintVerticalRange(project, frame, stageSize, metrics);
  return (
    PRINT_SCENE_TITLE_MM +
    getPrintRulerTopMm(project, metrics, options) +
    verticalRange.depthMeters * metrics.mmPerMeter +
    getPrintRulerBottomMm(project, metrics, options)
  );
};

const chunkFramesByCount = (
  frames: FormationFrame[],
  count: number,
): FormationFrame[][] => {
  const pages: FormationFrame[][] = [];
  for (let index = 0; index < frames.length; index += count) {
    pages.push(frames.slice(index, index + count));
  }
  return pages;
};

const paginateFrames = (
  project: Project,
  frames: FormationFrame[],
  metrics: PrintMetrics,
  options: ShareExportOptions,
): FormationFrame[][] => {
  const fixedCount =
    options.layout === "two"
      ? 2
      : options.layout === "three"
        ? 3
        : options.layout === "four"
          ? 4
          : null;
  if (fixedCount) {
    return chunkFramesByCount(frames, fixedCount);
  }

  const gapHeightMm = metrics.gapRows * metrics.gridSizeMeters * metrics.mmPerMeter;
  const pages: FormationFrame[][] = [];
  let currentPage: FormationFrame[] = [];
  let usedHeight = 0;

  frames.forEach((frame) => {
    const sceneHeight = getSceneBaseHeightMm(project, frame, metrics, options);
    const additionalHeight =
      sceneHeight + (currentPage.length > 0 ? gapHeightMm : 0);

    if (
      currentPage.length > 0 &&
      usedHeight + additionalHeight > metrics.pageUsableHeightMm
    ) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }

    currentPage.push(frame);
    usedHeight += sceneHeight + (currentPage.length > 1 ? gapHeightMm : 0);
  });

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
};

const PrintStagePreview = ({
  commonWidthMeters,
  frame,
  gapAfter,
  metrics,
  project,
  verticalRange,
  options,
}: {
  commonWidthMeters: number;
  frame: FormationFrame;
  gapAfter: boolean;
  metrics: PrintMetrics;
  project: Project;
  verticalRange: SceneVerticalRange;
  options: ShareExportOptions;
}) => {
  const isParade = project.mode === "parade";
  const horizontalGuideMode = isParade
    ? normalizeParadeHorizontalMeasureMode(
        project.paradeSettings?.horizontalMeasureMode,
      ) === "centerSplit"
      ? "centerSplit"
      : "meters"
    : project.stage.horizontalGuideMode ?? "meters";
  const centerSplitLabels = createCenterSplitLabels(commonWidthMeters);
  const xTicks = buildTicks(commonWidthMeters);
  const yTicks = buildTicks(verticalRange.depthMeters);
  const gapMeters = gapAfter ? metrics.gapRows * metrics.gridSizeMeters : 0;
  const totalDepthMeters = verticalRange.depthMeters + gapMeters;
  const stageHeightMm = totalDepthMeters * metrics.mmPerMeter;
  const memberDiameterMm = getPrintMemberDiameterMm(project, metrics);
  const rulerTopMm = getPrintRulerTopMm(project, metrics, options);
  const rulerBottomMm = getPrintRulerBottomMm(project, metrics, options);
  const leftRulerMm = getPrintSideRulerWidthMm(
    isParade,
    options.includeMeterRulers,
  );
  const rightRulerMm =
    isParade && options.includeMeterRulers
      ? getPrintSideRulerWidthMm(true, true)
      : 0;
  const stageRightSafetyMm = rightRulerMm > 0 ? PRINT_STAGE_RIGHT_SAFETY_MM : 0;
  const totalPreviewWidthMm =
    leftRulerMm + metrics.stageWidthMm + rightRulerMm + stageRightSafetyMm;
  const totalDistance =
    project.paradeSettings?.totalDistance ?? project.stage.depthMeters;
  const backwardDistanceMeters = getSafeParadeBackwardDistance(
    project.paradeSettings?.backwardDistanceMeters,
  );
  const verticalRulerLabels = isParade
    ? (() => {
        const minDistance =
          internalYToParadeDistance(
            verticalRange.bottomMeters,
            totalDistance,
            backwardDistanceMeters,
          ) ?? 0;
        const maxDistance =
          internalYToParadeDistance(
            verticalRange.topMeters,
            totalDistance,
            backwardDistanceMeters,
          ) ??
          totalDistance;
        const start = Math.ceil(minDistance / 5) * 5;
        const end = Math.floor(maxDistance / 5) * 5;
        const labels: Array<{ key: number; label: string; top: string }> = [];
        for (let meter = start; meter <= end + 0.001; meter += 5) {
          const internalY = paradeDistanceToInternalY(
            meter,
            totalDistance,
            backwardDistanceMeters,
          );
          labels.push({
            key: meter,
            label: `${meter}m`,
            top: metersToPrintMm(internalY - verticalRange.topMeters, metrics),
          });
        }
        if (labels.length === 0) {
          const fallbackMeter = Math.round((minDistance + maxDistance) / 2);
          const internalY = paradeDistanceToInternalY(
            fallbackMeter,
            totalDistance,
            backwardDistanceMeters,
          );
          labels.push({
            key: fallbackMeter,
            label: `${fallbackMeter}m`,
            top: metersToPrintMm(internalY - verticalRange.topMeters, metrics),
          });
        }
        return labels;
      })()
    : yTicks.map((tick) => {
        const actualTick = Number((verticalRange.topMeters + tick).toFixed(2));
        return {
          key: tick,
          label: `${actualTick}m`,
          top: metersToPrintMm(tick, metrics),
        };
      });
  const paradeGuideLines = isParade
    ? (() => {
        const show5m = project.paradeSettings?.emphasizeEvery5m ?? true;
        const show10m = project.paradeSettings?.emphasizeEvery10m ?? true;
        if (!show5m && !show10m) {
          return [];
        }

        const minDistance =
          internalYToParadeDistance(
            verticalRange.bottomMeters,
            totalDistance,
            backwardDistanceMeters,
          ) ?? 0;
        const maxDistance =
          internalYToParadeDistance(
            verticalRange.topMeters,
            totalDistance,
            backwardDistanceMeters,
          ) ??
          totalDistance;
        const start = Math.ceil(minDistance / 5) * 5;
        const end = Math.floor(maxDistance / 5) * 5;
        const lines: Array<{ isMajor: boolean; key: number; top: string }> = [];

        for (let meter = start; meter <= end + 0.001; meter += 5) {
          if (meter < -backwardDistanceMeters || meter > totalDistance) {
            continue;
          }
          const isMajor = Math.abs(meter % 10) < 0.001;
          if ((isMajor && !show10m) || (!isMajor && !show5m)) {
            continue;
          }
          const internalY = paradeDistanceToInternalY(
            meter,
            totalDistance,
            backwardDistanceMeters,
          );
          lines.push({
            isMajor,
            key: meter,
            top: metersToPrintMm(internalY - verticalRange.topMeters, metrics),
          });
        }

        return lines;
      })()
    : [];
  const previewStyle = {
    gridTemplateColumns: `${leftRulerMm}mm ${metrics.stageWidthMm}mm ${rightRulerMm}mm`,
    gridTemplateRows: `${rulerTopMm}mm ${stageHeightMm}mm`,
    paddingBottom: `${rulerBottomMm}mm`,
    paddingRight: `${stageRightSafetyMm}mm`,
    width: `${totalPreviewWidthMm}mm`,
    "--print-member-size": `${memberDiameterMm}mm`,
    "--print-ruler-bottom-mm": `${rulerBottomMm}mm`,
    "--print-ruler-left-mm": `${leftRulerMm}mm`,
    "--print-ruler-right-mm": `${rightRulerMm}mm`,
    "--print-ruler-top-mm": `${rulerTopMm}mm`,
    "--print-stage-right-safety-mm": `${stageRightSafetyMm}mm`,
    "--print-stage-center-x-mm": metersToPrintMm(commonWidthMeters / 2, metrics),
    "--print-stage-height-mm": `${stageHeightMm}mm`,
    "--print-stage-width-mm": `${metrics.stageWidthMm}mm`,
  } as CSSProperties;

  return (
    <div
      className={[
        "print-stage-preview",
        !options.includeMeterRulers ? "without-rulers" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={previewStyle}
    >
      {options.includeMeterRulers && (
        <>
          <div className="print-ruler-corner" />
          <div className="print-ruler print-ruler-x">
            {horizontalGuideMode === "centerSplit"
              ? centerSplitLabels.map((item) => (
                  <span
                    key={`x-center-split-${item.key}`}
                    style={{ left: metersToPrintMm(item.positionMeters, metrics) }}
                  >
                    {item.label}
                  </span>
                ))
              : xTicks.map((tick) => {
                  const label = formatHorizontalRulerLabel(
                    tick,
                    commonWidthMeters,
                    horizontalGuideMode,
                  );
                  return (
                    <span
                      key={`x-${tick}`}
                      style={{ left: metersToPrintMm(tick, metrics) }}
                    >
                      {label}
                    </span>
                  );
                })}
          </div>
          <div className="print-ruler print-ruler-y print-ruler-y--left">
            {verticalRulerLabels.map((item) => (
              <span key={`y-left-${item.key}`} style={{ top: item.top }}>
                {item.label}
              </span>
            ))}
          </div>
          {isParade && (
            <div className="print-ruler print-ruler-y print-ruler-y--right">
              {verticalRulerLabels.map((item) => (
                <span key={`y-right-${item.key}`} style={{ top: item.top }}>
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
        style={{
          backgroundSize: `${metersToPrintMm(metrics.gridSizeMeters, metrics)} ${metersToPrintMm(metrics.gridSizeMeters, metrics)}`,
        }}
      >
        <span className="print-center-line" />
        {paradeGuideLines.map((line) => (
          <span
            aria-hidden="true"
            className={[
              "print-parade-distance-line",
              line.isMajor ? "print-parade-distance-line--major" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={`parade-distance-${line.key}`}
            style={{ top: line.top }}
          />
        ))}
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
          const objectLeftMeters = state.x;
          const objectTopMeters = state.y - verticalRange.topMeters;
          return (
            <div
              className={`print-object shape-${object.shape}`}
              key={object.id}
              style={{
                backgroundColor: `${object.color}24`,
                borderColor: object.color,
                height: metersToPrintMm(state.heightMeters, metrics),
                left: metersToPrintMm(objectLeftMeters, metrics),
                top: metersToPrintMm(objectTopMeters, metrics),
                transform: `rotate(${state.rotation}deg)`,
                width: metersToPrintMm(state.widthMeters, metrics),
                zIndex: state.zIndex,
              }}
            >
              {object.name}
            </div>
          );
        })}

        {project.members.map((member) => {
          const position = frame.positions[member.id];
          if (!position || !isMemberVisible(frame, member)) {
            return null;
          }
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
              className={`print-member ${memberLabelClassName}`}
              key={member.id}
              style={{
                backgroundColor: memberColor,
                color: labelColor,
                fontSize: `${getMemberLabelFontSize(memberDiameterMm, labelLines, {
                  min: 1.8,
                  precision: 2,
                })}mm`,
                left: metersToPrintMm(position.x, metrics),
                top: metersToPrintMm(position.y - verticalRange.topMeters, metrics),
              }}
            >
              <span className="print-member__label" aria-hidden="true">
                {labelLines.map((line, index) => (
                  <span className="print-member__label-line" key={`${member.id}-print-label-${index}`}>
                    {line}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const PrintPreview = ({
  project,
  scope = "all",
  selectedFrameId = null,
  options = defaultPrintOptions,
  rootRef,
  variant = "document",
}: PrintPreviewProps) => {
  const sortedFrames = sortFrames(project.frames);
  const frames =
    scope === "current" && selectedFrameId
      ? sortedFrames.filter((frame) => frame.id === selectedFrameId)
      : sortedFrames;
  const resolvedOptions = { ...defaultPrintOptions, ...options };
  const metrics = getPrintMetrics(project, frames, resolvedOptions);
  const pages = paginateFrames(project, frames, metrics, resolvedOptions);
  const documentClassName = `print-document print-document--${metrics.orientation}`;

  if (variant === "stage-only") {
    const frame = frames[0] ?? sortedFrames[0];
    if (!frame) {
      return (
        <div
          className={`${documentClassName} print-document--stage-only`}
          ref={rootRef}
        />
      );
    }
    const verticalRange = getFramePrintVerticalRange(
      project,
      frame,
      getEffectiveSize(project, frame),
      metrics,
    );

    return (
      <div
        className={`${documentClassName} print-document--stage-only`}
        aria-hidden="true"
        ref={rootRef}
      >
        <PrintStagePreview
          commonWidthMeters={metrics.commonWidthMeters}
          frame={frame}
          gapAfter={false}
          metrics={metrics}
          project={project}
          verticalRange={verticalRange}
          options={resolvedOptions}
        />
      </div>
    );
  }

  return (
    <div className={documentClassName} aria-hidden="true" ref={rootRef}>
      {pages.map((pageFrames, pageIndex) => (
        <section className="print-page" key={`print-page-${pageIndex}`}>
          {pageFrames.map((frame, frameIndex) => {
            const sceneNumber =
              sortedFrames.findIndex((item) => item.id === frame.id) + 1;
            const verticalRange = getFramePrintVerticalRange(
              project,
              frame,
              getEffectiveSize(project, frame),
              metrics,
            );
            const gapAfter = frameIndex < pageFrames.length - 1;

            return (
              <section className="print-scene-block" key={frame.id}>
                <header
                  className="print-scene-title"
                  style={{ height: `${PRINT_SCENE_TITLE_MM}mm` }}
                >
                  <h2>
                    {resolvedOptions.includeSceneName
                      ? frame.label
                      : `シーン${sceneNumber}`}
                  </h2>
                </header>

                <PrintStagePreview
                  commonWidthMeters={metrics.commonWidthMeters}
                  frame={frame}
                  gapAfter={gapAfter}
                  metrics={metrics}
                  project={project}
                  verticalRange={verticalRange}
                  options={resolvedOptions}
                />
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
};

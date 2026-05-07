import type { CSSProperties, Ref } from "react";
import {
  FormationFrame,
  Member,
  ObjectState,
  Project,
  StageObject,
} from "../types";
import { createDefaultObjectState, sortFrames } from "../utils/interpolation";
import { getMemberDisplayColor } from "../utils/memberAppearance";
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

type PrintMetrics = {
  commonWidthMeters: number;
  gapRows: number;
  gridSizeMeters: number;
  mmPerMeter: number;
  pageUsableHeightMm: number;
  stageWidthMm: number;
};

const PRINT_PAGE_USABLE_WIDTH_MM = 190;
const PRINT_PAGE_USABLE_HEIGHT_MM = 277;
const PRINT_RULER_LEFT_MM = 10;
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

const getEffectiveSize = (
  project: Project,
  frame: FormationFrame,
): EffectiveStageSize => {
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

const getObjectState = (
  frame: FormationFrame,
  object: StageObject,
): ObjectState => frame.objectStates[object.id] ?? createDefaultObjectState(object);

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

const getPrintMetrics = (
  project: Project,
  frames: FormationFrame[],
  options: ShareExportOptions,
): PrintMetrics => {
  const commonWidthMeters = Math.max(
    1,
    ...frames.map((frame) => getEffectiveSize(project, frame).widthMeters),
    project.stage.widthMeters,
  );
  const stageWidthMm =
    PRINT_PAGE_USABLE_WIDTH_MM - PRINT_RULER_LEFT_MM - PRINT_STAGE_RIGHT_SAFETY_MM;
  return {
    commonWidthMeters,
    gapRows: Math.max(0, options.sceneGapRows ?? 5),
    gridSizeMeters: Math.max(project.stage.gridSizeMeters || 0.25, 0.01),
    mmPerMeter: stageWidthMm / commonWidthMeters,
    pageUsableHeightMm: PRINT_PAGE_USABLE_HEIGHT_MM,
    stageWidthMm,
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
  return (
    PRINT_SCENE_TITLE_MM +
    getPrintRulerTopMm(project, metrics, options) +
    stageSize.depthMeters * metrics.mmPerMeter +
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
  stageSize,
  options,
}: {
  commonWidthMeters: number;
  frame: FormationFrame;
  gapAfter: boolean;
  metrics: PrintMetrics;
  project: Project;
  stageSize: EffectiveStageSize;
  options: ShareExportOptions;
}) => {
  const horizontalGuideMode = project.stage.horizontalGuideMode ?? "meters";
  const xTicks = buildTicks(commonWidthMeters);
  const yTicks = buildTicks(stageSize.depthMeters);
  const gapMeters = gapAfter ? metrics.gapRows * metrics.gridSizeMeters : 0;
  const totalDepthMeters = stageSize.depthMeters + gapMeters;
  const stageHeightMm = totalDepthMeters * metrics.mmPerMeter;
  const memberDiameterMm = getPrintMemberDiameterMm(project, metrics);
  const rulerTopMm = getPrintRulerTopMm(project, metrics, options);
  const rulerBottomMm = getPrintRulerBottomMm(project, metrics, options);
  const previewStyle = {
    "--print-member-size": `${memberDiameterMm}mm`,
    "--print-ruler-bottom-mm": `${rulerBottomMm}mm`,
    "--print-ruler-left-mm": `${options.includeMeterRulers ? PRINT_RULER_LEFT_MM : 0}mm`,
    "--print-ruler-top-mm": `${rulerTopMm}mm`,
    "--print-stage-right-safety-mm": `${PRINT_STAGE_RIGHT_SAFETY_MM}mm`,
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
            {xTicks.map((tick) => {
              const label = formatHorizontalRulerLabel(
                tick,
                commonWidthMeters,
                horizontalGuideMode,
              );
              return (
                <span
                  key={`x-${tick}`}
                  style={{ left: `${(tick / commonWidthMeters) * 100}%` }}
                >
                  {label}
                </span>
              );
            })}
          </div>
          <div className="print-ruler print-ruler-y">
            {yTicks.map((tick) => (
              <span
                key={`y-${tick}`}
                style={{ top: `${(tick / totalDepthMeters) * 100}%` }}
              >
                {`${tick}m`}
              </span>
            ))}
          </div>
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
          backgroundSize: `${(metrics.gridSizeMeters / commonWidthMeters) * 100}% ${
            (metrics.gridSizeMeters / totalDepthMeters) * 100
          }%`,
        }}
      >
        <span className="print-center-line" />
        {gapAfter && (
          <span
            className="print-scene-gap-start"
            style={{ top: `${(stageSize.depthMeters / totalDepthMeters) * 100}%` }}
          />
        )}

        {project.stageObjects.map((object) => {
          const state = getObjectState(frame, object);
          if (!((state.visible ?? object.visible) !== false)) {
            return null;
          }
          return (
            <div
              className={`print-object shape-${object.shape}`}
              key={object.id}
              style={{
                backgroundColor: `${object.color}24`,
                borderColor: object.color,
                height: `${(state.heightMeters / totalDepthMeters) * 100}%`,
                left: `${(state.x / commonWidthMeters) * 100}%`,
                top: `${(state.y / totalDepthMeters) * 100}%`,
                transform: `rotate(${state.rotation}deg)`,
                width: `${(state.widthMeters / commonWidthMeters) * 100}%`,
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
          return (
            <span
              className="print-member"
              key={member.id}
              style={{
                backgroundColor: getMemberDisplayColor(member, {
                  frame,
                  groups: project.memberGroups ?? [],
                }),
                left: `${(position.x / commonWidthMeters) * 100}%`,
                top: `${(position.y / totalDepthMeters) * 100}%`,
              }}
            >
              {member.name}
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

  if (variant === "stage-only") {
    const frame = frames[0] ?? sortedFrames[0];
    if (!frame) {
      return <div className="print-document print-document--stage-only" ref={rootRef} />;
    }
    const stageSize = {
      ...getEffectiveSize(project, frame),
      widthMeters: metrics.commonWidthMeters,
    };

    return (
      <div
        className="print-document print-document--stage-only"
        aria-hidden="true"
        ref={rootRef}
      >
        <PrintStagePreview
          commonWidthMeters={metrics.commonWidthMeters}
          frame={frame}
          gapAfter={false}
          metrics={metrics}
          project={project}
          stageSize={stageSize}
          options={resolvedOptions}
        />
      </div>
    );
  }

  return (
    <div className="print-document" aria-hidden="true" ref={rootRef}>
      {pages.map((pageFrames, pageIndex) => (
        <section className="print-page" key={`print-page-${pageIndex}`}>
          {pageFrames.map((frame, frameIndex) => {
            const sceneNumber =
              sortedFrames.findIndex((item) => item.id === frame.id) + 1;
            const stageSize = {
              ...getEffectiveSize(project, frame),
              widthMeters: metrics.commonWidthMeters,
            };
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
                  stageSize={stageSize}
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

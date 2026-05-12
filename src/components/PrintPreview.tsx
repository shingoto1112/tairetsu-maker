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
  assignmentSideGapMm: number;
  assignmentSideWidthMm: number;
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

type AssignmentPrintEntry = {
  assignedMembers: Member[];
  object: StageObject;
  state: ObjectState;
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
const PRINT_ASSIGNMENT_SHEET_MIN_HEIGHT_MM = 60;
const PRINT_ASSIGNMENT_CARD_GAP_MM = 4;
const PRINT_ASSIGNMENT_CARD_PADDING_MM = 4;
const PRINT_ASSIGNMENT_MEMBER_GAP_MM = 2.5;
const PRINT_ASSIGNMENT_MEMBER_SIZE_MIN_MM = 8;
const PRINT_ASSIGNMENT_MEMBER_SIZE_MAX_MM = 13;
const PRINT_ASSIGNMENT_OBJECT_MIN_HEIGHT_MM = 8;
const PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM = 24;
const PRINT_PARADE_EXPORT_PADDING_METERS = 2;
const PRINT_ASSIGNMENT_SIDE_GAP_MM = 7;
const PRINT_PARADE_ASSIGNMENT_SIDE_GAP_MM = 4;
const PRINT_ASSIGNMENT_SIDE_MAX_WIDTH_MM = 82;
const PRINT_ASSIGNMENT_SIDE_MIN_WIDTH_MM = 54;
const PRINT_ASSIGNMENT_SIDE_STAGE_MIN_WIDTH_MM = 105;

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

const getPrintMeterRulerClassName = (meter: number) => {
  const rounded = Math.round(meter);
  if (Math.abs(meter - rounded) > 0.001) {
    return "minor";
  }
  const absMeter = Math.abs(rounded);
  if (absMeter % 10 === 0) {
    return "major";
  }
  if (absMeter % 5 === 0) {
    return "medium";
  }
  return "minor";
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

const getAssignmentObjectOrder = (project: Project): Map<string, number> => {
  const orderById = new Map<string, number>();
  let ungroupedOrder = (project.objectGroups?.length ?? 0) * 10000;

  (project.objectGroups ?? []).forEach((group, groupIndex) => {
    group.objectIds.forEach((objectId, objectIndex) => {
      if (!orderById.has(objectId)) {
        orderById.set(objectId, groupIndex * 10000 + objectIndex);
      }
    });
  });

  project.stageObjects
    .filter((object) => !orderById.has(object.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
    .forEach((object) => {
      orderById.set(object.id, ungroupedOrder);
      ungroupedOrder += 1;
    });

  return orderById;
};

const getAssignmentPrintEntries = (
  project: Project,
  frame: FormationFrame,
): AssignmentPrintEntry[] => {
  const memberById = new Map(project.members.map((member) => [member.id, member]));
  const objectOrderById = getAssignmentObjectOrder(project);
  return project.stageObjects
    .map((object) => {
      const state = getObjectState(frame, object);
      const isVisible = (state.visible ?? object.visible) !== false;
      const assignedMembers = (frame.objectAssignments?.[object.id] ?? [])
        .map((memberId) => memberById.get(memberId))
        .filter((member): member is Member => Boolean(member));
      return { assignedMembers, isVisible, object, state };
    })
    .filter(
      (
        entry,
      ): entry is AssignmentPrintEntry & { isVisible: true } =>
        entry.isVisible && entry.assignedMembers.length > 0,
    )
    .sort((a, b) => {
      const orderA = objectOrderById.get(a.object.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = objectOrderById.get(b.object.id) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const yDiff = a.state.y - b.state.y;
      if (Math.abs(yDiff) > 0.001) return yDiff;
      const xDiff = a.state.x - b.state.x;
      if (Math.abs(xDiff) > 0.001) return xDiff;
      return a.object.name.localeCompare(b.object.name, "ja", { numeric: true });
    });
};

const getAssignmentMemberSizeMm = (
  project: Project,
  metrics: PrintMetrics,
): number => {
  const memberSize = getPrintMemberDiameterMm(project, metrics);
  return Math.min(
    PRINT_ASSIGNMENT_MEMBER_SIZE_MAX_MM,
    Math.max(PRINT_ASSIGNMENT_MEMBER_SIZE_MIN_MM, memberSize),
  );
};

const shouldPrintAssignmentSide = (options: ShareExportOptions): boolean =>
  options.includeAssignments;

const shouldPrintRightRuler = (
  isParade: boolean,
  options: ShareExportOptions,
): boolean =>
  isParade && options.includeMeterRulers;

const getAssignmentSideGapMm = (
  isParade: boolean,
  assignmentSideWidthMm: number,
): number => {
  if (assignmentSideWidthMm <= 0) {
    return 0;
  }
  return isParade ? PRINT_PARADE_ASSIGNMENT_SIDE_GAP_MM : PRINT_ASSIGNMENT_SIDE_GAP_MM;
};

const getAssignmentPanelContentWidthMm = (metrics: PrintMetrics): number =>
  Math.max(
    PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM,
    metrics.assignmentSideWidthMm - PRINT_ASSIGNMENT_CARD_PADDING_MM * 2,
  );

const getAssignmentPanelColumnWidthMm = (metrics: PrintMetrics): number =>
  Math.max(
    PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM,
    (getAssignmentPanelContentWidthMm(metrics) - PRINT_ASSIGNMENT_CARD_GAP_MM) /
      2,
  );

const getAssignmentObjectPrintSize = (
  state: ObjectState,
  metrics: PrintMetrics,
  maxWidthMm = metrics.stageWidthMm * 0.9,
): { heightMm: number; widthMm: number } => {
  return {
    heightMm: Math.max(
      PRINT_ASSIGNMENT_OBJECT_MIN_HEIGHT_MM,
      state.heightMeters * metrics.mmPerMeter,
    ),
    widthMm: Math.min(
      maxWidthMm,
      Math.max(PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM, state.widthMeters * metrics.mmPerMeter),
    ),
  };
};

const isCompactAssignmentEntry = (
  entry: AssignmentPrintEntry,
  metrics: PrintMetrics,
): boolean => {
  const naturalWidthMm = Math.max(
    PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM,
    entry.state.widthMeters * metrics.mmPerMeter,
  );
  return naturalWidthMm <= getAssignmentPanelColumnWidthMm(metrics) + 0.001;
};

const getAssignmentEntryHeightMm = (
  entry: AssignmentPrintEntry,
  metrics: PrintMetrics,
  memberSizeMm: number,
  objectMaxWidthMm = metrics.stageWidthMm * 0.9,
): number => {
  const objectSize = getAssignmentObjectPrintSize(
    entry.state,
    metrics,
    objectMaxWidthMm,
  );
  const columns = Math.max(
    1,
    Math.floor(
      (objectSize.widthMm + PRINT_ASSIGNMENT_MEMBER_GAP_MM) /
        (memberSizeMm + PRINT_ASSIGNMENT_MEMBER_GAP_MM),
    ),
  );
  const rows = Math.max(1, Math.ceil(entry.assignedMembers.length / columns));
  return (
    PRINT_ASSIGNMENT_CARD_PADDING_MM * 2 +
    objectSize.heightMm +
    PRINT_ASSIGNMENT_MEMBER_GAP_MM +
    rows * memberSizeMm +
    Math.max(0, rows - 1) * PRINT_ASSIGNMENT_MEMBER_GAP_MM
  );
};

const getAssignmentEntryPrintLayout = (
  entry: AssignmentPrintEntry,
  metrics: PrintMetrics,
  memberSizeMm: number,
): {
  compact: boolean;
  heightMm: number;
  objectMaxWidthMm: number;
} => {
  const compact = isCompactAssignmentEntry(entry, metrics);
  const objectMaxWidthMm = compact
    ? getAssignmentPanelColumnWidthMm(metrics)
    : getAssignmentPanelContentWidthMm(metrics);
  return {
    compact,
    heightMm: getAssignmentEntryHeightMm(
      entry,
      metrics,
      memberSizeMm,
      objectMaxWidthMm,
    ),
    objectMaxWidthMm,
  };
};

const getAssignmentLayoutRows = (
  entries: AssignmentPrintEntry[],
  metrics: PrintMetrics,
  memberSizeMm: number,
): number[] => {
  const rows: number[] = [];
  let compactRow: number[] = [];

  entries.forEach((entry) => {
    const layout = getAssignmentEntryPrintLayout(entry, metrics, memberSizeMm);
    if (!layout.compact) {
      if (compactRow.length > 0) {
        rows.push(Math.max(...compactRow));
        compactRow = [];
      }
      rows.push(layout.heightMm);
      return;
    }

    compactRow.push(layout.heightMm);
    if (compactRow.length >= 2) {
      rows.push(Math.max(...compactRow));
      compactRow = [];
    }
  });

  if (compactRow.length > 0) {
    rows.push(Math.max(...compactRow));
  }

  return rows;
};

const getAssignmentPanelHeightMm = (
  project: Project,
  frame: FormationFrame,
  metrics: PrintMetrics,
): number => {
  const entries = getAssignmentPrintEntries(project, frame);
  if (entries.length === 0) {
    return PRINT_ASSIGNMENT_SHEET_MIN_HEIGHT_MM;
  }

  const memberSizeMm = getAssignmentMemberSizeMm(project, metrics);
  const rows = getAssignmentLayoutRows(entries, metrics, memberSizeMm);
  const contentHeightMm =
    PRINT_ASSIGNMENT_CARD_PADDING_MM * 2 +
    rows.reduce((total, heightMm) => total + heightMm, 0) +
    Math.max(0, rows.length - 1) * PRINT_ASSIGNMENT_CARD_GAP_MM;

  return Math.max(PRINT_ASSIGNMENT_SHEET_MIN_HEIGHT_MM, contentHeightMm);
};

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
  const rightRulerWidthMm = shouldPrintRightRuler(isParade, options)
    ? getPrintSideRulerWidthMm(true, true)
    : 0;
  const stageRightSafetyMm = rightRulerWidthMm > 0 ? PRINT_STAGE_RIGHT_SAFETY_MM : 0;
  const commonWidthMeters = Math.max(
    1,
    ...frames.map((frame) => getEffectiveSize(project, frame).widthMeters),
    isParade
      ? (project.paradeSettings?.width ?? project.stage.widthMeters)
      : project.stage.widthMeters,
  );
  const availableWidthMm =
    pageSize.width -
    leftRulerWidthMm -
    rightRulerWidthMm -
    stageRightSafetyMm;
  const canUseAssignmentSide = shouldPrintAssignmentSide(options);
  const requestedAssignmentGapMm = canUseAssignmentSide
    ? isParade
      ? PRINT_PARADE_ASSIGNMENT_SIDE_GAP_MM
      : PRINT_ASSIGNMENT_SIDE_GAP_MM
    : 0;
  const requestedAssignmentWidthMm = canUseAssignmentSide
    ? Math.min(
        PRINT_ASSIGNMENT_SIDE_MAX_WIDTH_MM,
        Math.max(PRINT_ASSIGNMENT_SIDE_MIN_WIDTH_MM, availableWidthMm * 0.28),
      )
    : 0;
  const assignmentSideWidthMm = canUseAssignmentSide
    ? Math.max(
        0,
        Math.min(
          requestedAssignmentWidthMm,
          availableWidthMm -
            requestedAssignmentGapMm -
            PRINT_ASSIGNMENT_SIDE_STAGE_MIN_WIDTH_MM,
        ),
      )
    : 0;
  const assignmentSideGapMm = getAssignmentSideGapMm(
    isParade,
    assignmentSideWidthMm,
  );
  const stageWidthMm = Math.max(
    40,
    availableWidthMm - assignmentSideGapMm - assignmentSideWidthMm,
  );
  return {
    assignmentSideGapMm,
    assignmentSideWidthMm,
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
  const memberDiameterMeters = Math.max(project.stage.memberDiameterMeters ?? 0.5, 0.01);
  const memberRadiusMeters = memberDiameterMeters / 2;
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
  const topMeters = Math.max(
    0,
    snapDown(minY - PRINT_PARADE_EXPORT_PADDING_METERS, step),
  );
  const bottomMeters = Math.min(
    canvasDistanceMeters,
    snapUp(maxY + PRINT_PARADE_EXPORT_PADDING_METERS, step),
  );
  const safeBottomMeters =
    bottomMeters > topMeters
      ? bottomMeters
      : Math.min(
          canvasDistanceMeters,
          topMeters + Math.min(canvasDistanceMeters, PRINT_PARADE_EXPORT_PADDING_METERS * 2),
        );

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
  const verticalRange = getFramePrintVerticalRange(
    project,
    frame,
    stageSize,
    metrics,
  );
  const stageHeightMm =
    getPrintRulerTopMm(project, metrics, options) +
    verticalRange.depthMeters * metrics.mmPerMeter +
    getPrintRulerBottomMm(project, metrics, options);
  const assignmentHeightMm = shouldPrintAssignmentSide(options)
    ? getAssignmentPanelHeightMm(project, frame, metrics)
    : 0;
  return PRINT_SCENE_TITLE_MM + Math.max(stageHeightMm, assignmentHeightMm);
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
  const assignmentMemberSizeMm = getAssignmentMemberSizeMm(project, metrics);
  const rulerTopMm = getPrintRulerTopMm(project, metrics, options);
  const rulerBottomMm = getPrintRulerBottomMm(project, metrics, options);
  const leftRulerMm = getPrintSideRulerWidthMm(
    isParade,
    options.includeMeterRulers,
  );
  const rightRulerMm = shouldPrintRightRuler(isParade, options)
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
        const start = Math.ceil(minDistance - 0.001);
        const end = Math.floor(maxDistance + 0.001);
        const labels: Array<{
          className?: string;
          key: number;
          label: string;
          top: string;
        }> = [];
        for (let meter = start; meter <= end; meter += 1) {
          const internalY = paradeDistanceToInternalY(
            meter,
            totalDistance,
            backwardDistanceMeters,
          );
          labels.push({
            className: getPrintMeterRulerClassName(meter),
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
            className: getPrintMeterRulerClassName(fallbackMeter),
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
          className: undefined,
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
        key={key}
        style={{
          backgroundColor: memberColor,
          color: labelColor,
          fontSize: `${getMemberLabelFontSize(memberDiameterMm, labelLines, {
            min: 1.8,
            precision: 2,
          })}mm`,
          left: metersToPrintMm(centerXMeters, metrics),
          top: metersToPrintMm(centerYMeters - verticalRange.topMeters, metrics),
          zIndex,
        }}
      >
        <span className="print-member__label" aria-hidden="true">
          {labelLines.map((line, index) => (
            <span className="print-member__label-line" key={`${key}-print-label-${index}`}>
              {line}
            </span>
          ))}
        </span>
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
        key={key}
        style={{
          backgroundColor: memberColor,
          color: labelColor,
          fontSize: `${getMemberLabelFontSize(assignmentMemberSizeMm, labelLines, {
            min: 1.8,
            precision: 2,
          })}mm`,
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
            このシーンの道具割当はありません
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
                      transform: `rotate(${entry.state.rotation}deg)`,
                      width: `${objectSize.widthMm}mm`,
                    }}
                  >
                    {entry.object.name}
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

  const stagePreview = (
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
                zIndex: 2 + state.zIndex,
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
          return renderMemberIcon(member, member.id, position.x, position.y);
        })}
      </div>
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

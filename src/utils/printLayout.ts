import type { FormationFrame, Member, ObjectState, Project, StageObject } from "../types";
import type { ShareExportOptions } from "../components/ShareExportModal";
import { createDefaultObjectState } from "./interpolation";
import { getMemberLabelFontSize } from "./memberLabel";
import { getSafeParadeBackwardDistance, getSafeParadeCanvasDistance, internalYToParadeDistance, paradeDistanceToInternalY } from "./parade";
import { boundedTicks } from "./boundedTicks";
import { rotatedObjectBounds } from "./formationExportLayout";

// Single source of truth for legacy DOM and vector A4 pagination and dimensions.
export type EffectiveStageSize = {
  widthMeters: number;
  depthMeters: number;
};

export type SceneVerticalRange = {
  bottomMeters: number;
  depthMeters: number;
  topMeters: number;
};

export type PrintOrientation = "landscape" | "portrait";

export type PrintMetrics = {
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

export type AssignmentPrintEntry = {
  assignedMembers: Member[];
  object: StageObject;
  state: ObjectState;
};

export const PRINT_A4_SHORT_USABLE_MM = 190;
export const PRINT_A4_LONG_USABLE_MM = 277;
export const PRINT_RULER_LEFT_MM = 10;
export const PRINT_PARADE_RULER_SIDE_MM = 18;
export const PRINT_RULER_TOP_MM = 6;
export const PRINT_RULER_BOTTOM_MM = 3;
export const PRINT_SCENE_TITLE_MM = 9;
export const PRINT_STAGE_RIGHT_SAFETY_MM = 8;
export const PRINT_STAGE_MEMBER_CLEARANCE_MM = 1.5;
export const PRINT_RULER_X_LABEL_WIDTH_MM = 7;
export const PRINT_RULER_Y_LABEL_HEIGHT_MM = 4;
export const PRINT_ASSIGNMENT_SHEET_MIN_HEIGHT_MM = 60;
export const PRINT_ASSIGNMENT_CARD_GAP_MM = 4;
export const PRINT_ASSIGNMENT_CARD_PADDING_MM = 4;
export const PRINT_ASSIGNMENT_MEMBER_GAP_MM = 2.5;
export const PRINT_ASSIGNMENT_MEMBER_SIZE_MIN_MM = 8;
export const PRINT_ASSIGNMENT_MEMBER_SIZE_MAX_MM = 13;
export const PRINT_ASSIGNMENT_OBJECT_MIN_HEIGHT_MM = 8;
export const PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM = 24;
export const PRINT_MEMBER_LABEL_FONT_BOOST_MM = 0.2;
export const PRINT_PARADE_EXPORT_PADDING_METERS = 2;
export const PRINT_ASSIGNMENT_SIDE_GAP_MM = 7;
export const PRINT_PARADE_ASSIGNMENT_SIDE_GAP_MM = 4;
export const PRINT_ASSIGNMENT_SIDE_MAX_WIDTH_MM = 82;
export const PRINT_ASSIGNMENT_SIDE_MIN_WIDTH_MM = 54;
export const PRINT_ASSIGNMENT_SIDE_STAGE_MIN_WIDTH_MM = 105;

export const defaultPrintOptions: ShareExportOptions = {
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

export const getPrintSideRulerWidthMm = (
  isParade: boolean,
  includeMeterRulers: boolean,
): number => {
  if (!includeMeterRulers) {
    return 0;
  }
  return isParade ? PRINT_PARADE_RULER_SIDE_MM : PRINT_RULER_LEFT_MM;
};

export const getPrintMeterRulerClassName = (meter: number) => {
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

/** A4 uses both sides, independent of the editor's rulerPosition. Keep the
 * legacy distance rounding, ascending order and empty-range fallback. */
export const getParadePrintRulerLabels = (totalDistance: number, backwardDistanceMeters: number, range: SceneVerticalRange) => {
  const minDistance = internalYToParadeDistance(range.bottomMeters, totalDistance, backwardDistanceMeters) ?? 0;
  const maxDistance = internalYToParadeDistance(range.topMeters, totalDistance, backwardDistanceMeters) ?? totalDistance;
  const meters = boundedTicks(Math.ceil(minDistance - .001), Math.floor(maxDistance + .001));
  if (!meters.length) meters.push(Math.round((minDistance + maxDistance) / 2));
  return meters.map(meter => ({ meter, label: `${meter}m`,
    internalY: paradeDistanceToInternalY(meter, totalDistance, backwardDistanceMeters),
    className: getPrintMeterRulerClassName(meter) }));
};

export const getEffectiveSize = (
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

export const formatMeter = (value: number): string => {
  const rounded = Number(value.toFixed(2));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return normalized > 0 ? `+${normalized}m` : `${normalized}m`;
};

export const metersToPrintMm = (meters: number, metrics: PrintMetrics): string =>
  `${meters * metrics.mmPerMeter}mm`;

export const metersToPrintCenteredMm = (
  meters: number,
  metrics: PrintMetrics,
  sizeMm: number,
): string => `${meters * metrics.mmPerMeter - sizeMm / 2}mm`;

export const getObjectState = (
  frame: FormationFrame,
  object: StageObject,
): ObjectState => frame.objectStates?.[object.id] ?? createDefaultObjectState(object);

export const getPrintMemberLabelFontSizeMm = (
  diameterMm: number,
  labelLines: string[],
): number =>
  getMemberLabelFontSize(diameterMm, labelLines, {
    min: 1.8,
    precision: 2,
    boost: PRINT_MEMBER_LABEL_FONT_BOOST_MM,
    border: 0,
    inset: 0,
    borderOverlap: 0,
  });

export const getAssignmentObjectOrder = (project: Project): Map<string, number> => {
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

export const getAssignmentPrintEntries = (
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

export const getAssignmentMemberSizeMm = (
  project: Project,
  metrics: PrintMetrics,
): number => {
  const memberSize = getPrintMemberDiameterMm(project, metrics);
  return Math.min(
    PRINT_ASSIGNMENT_MEMBER_SIZE_MAX_MM,
    Math.max(PRINT_ASSIGNMENT_MEMBER_SIZE_MIN_MM, memberSize),
  );
};

export const shouldPrintAssignmentSide = (options: ShareExportOptions): boolean =>
  options.includeAssignments;

export const shouldPrintRightRuler = (
  options: ShareExportOptions,
): boolean =>
  options.includeMeterRulers;

export const getAssignmentSideGapMm = (
  isParade: boolean,
  assignmentSideWidthMm: number,
): number => {
  if (assignmentSideWidthMm <= 0) {
    return 0;
  }
  return isParade ? PRINT_PARADE_ASSIGNMENT_SIDE_GAP_MM : PRINT_ASSIGNMENT_SIDE_GAP_MM;
};

export const getAssignmentPanelContentWidthMm = (metrics: PrintMetrics): number =>
  Math.max(
    PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM,
    metrics.assignmentSideWidthMm - PRINT_ASSIGNMENT_CARD_PADDING_MM * 2,
  );

export const getAssignmentPanelColumnWidthMm = (metrics: PrintMetrics): number =>
  Math.max(
    PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM,
    (getAssignmentPanelContentWidthMm(metrics) - PRINT_ASSIGNMENT_CARD_GAP_MM) /
      2,
  );

export const getAssignmentObjectPrintSize = (
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

export const isCompactAssignmentEntry = (
  entry: AssignmentPrintEntry,
  metrics: PrintMetrics,
): boolean => {
  const naturalWidthMm = Math.max(
    PRINT_ASSIGNMENT_OBJECT_MIN_WIDTH_MM,
    entry.state.widthMeters * metrics.mmPerMeter,
  );
  return naturalWidthMm <= getAssignmentPanelColumnWidthMm(metrics) + 0.001;
};

export const getAssignmentEntryHeightMm = (
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

export const getAssignmentEntryPrintLayout = (
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

export const getAssignmentLayoutRows = (
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

export const getAssignmentPanelHeightMm = (
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

export const isMemberAssigned = (
  frame: FormationFrame,
  memberId: string,
): boolean =>
  Object.values(frame.objectAssignments ?? {}).some((memberIds) =>
    memberIds.includes(memberId),
  );

export const isPrintMemberVisible = (frame: FormationFrame, member: Member): boolean =>
  (member.visible ?? true) &&
  frame.memberVisibility?.[member.id] !== false &&
  !isMemberAssigned(frame, member.id);

export const isMemberVisible = isPrintMemberVisible;

export const getPrintOrientation = (project: Project): PrintOrientation =>
  project.mode === "parade" ? "portrait" : "landscape";

export const getPrintPageUsableSize = (
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

export const getPrintMetrics = (
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
  const rightRulerWidthMm = shouldPrintRightRuler(options)
    ? getPrintSideRulerWidthMm(isParade, true)
    : 0;
  const stageRightSafetyMm =
    isParade && rightRulerWidthMm > 0 ? PRINT_STAGE_RIGHT_SAFETY_MM : 0;
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

export const snapDown = (value: number, step: number): number =>
  Math.floor(value / step + 0.0001) * step;

export const snapUp = (value: number, step: number): number =>
  Math.ceil(value / step - 0.0001) * step;

export const getFramePrintVerticalRange = (
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
  const includeRouteInterval = (lo: number, hi: number) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < 0 || lo > canvasDistanceMeters) return;
    minY = Math.min(minY, Math.max(0, lo));
    maxY = Math.max(maxY, Math.min(canvasDistanceMeters, hi));
  };
  const emptyRange = (): SceneVerticalRange => {
    const depthMeters = Math.min(canvasDistanceMeters, Math.max(10, metrics.gridSizeMeters * 10));
    return { topMeters: 0, bottomMeters: depthMeters, depthMeters };
  };

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
    const bounds = rotatedObjectBounds(state);
    // Extend the legacy crop without shrinking scenes whose rotated prop is shorter.
    includeRouteInterval(Math.min(state.y, bounds.top), Math.max(state.y + state.heightMeters, bounds.bottom));
  });

  Object.values(frame.annotationLines ?? {}).forEach((line) => {
    includeRouteInterval(Math.min(line.y1, line.y2), Math.max(line.y1, line.y2));
  });

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return emptyRange();
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
  if (!(Number.isFinite(topMeters) && Number.isFinite(bottomMeters) &&
      0 <= topMeters && topMeters < bottomMeters && bottomMeters <= canvasDistanceMeters)) return emptyRange();

  return {
    bottomMeters,
    depthMeters: bottomMeters - topMeters,
    topMeters,
  };
};

export const getPrintMemberDiameterMm = (
  project: Project,
  metrics: PrintMetrics,
): number => (project.stage.memberDiameterMeters ?? 0.5) * metrics.mmPerMeter;

export const getPrintRulerTopMm = (
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

export const getPrintRulerBottomMm = (
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

export const getSceneBaseHeightMm = (
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

export const chunkFramesByCount = (
  frames: FormationFrame[],
  count: number,
): FormationFrame[][] => {
  const pages: FormationFrame[][] = [];
  for (let index = 0; index < frames.length; index += count) {
    pages.push(frames.slice(index, index + count));
  }
  return pages;
};

export const paginateFrames = (
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

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Camera,
  Lock,
  Maximize2,
  Minimize2,
  Redo2,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  CSSProperties,
  forwardRef,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ObjectState,
  ParadeSettings,
  Position,
  Project,
  SceneElementEditTarget,
  SceneViewState,
  Selection,
  StageContextMenuRequest,
  StageSnapshot,
} from "../types";
import { roundMeters } from "../utils/coordinates";
import { createEdgeAutoScroller } from "../utils/edgeAutoScroll";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../utils/memberAppearance";
import {
  getMemberLabelClassName,
  getMemberLabelFontSize,
  splitMemberLabel,
} from "../utils/memberLabel";
import {
  clampParadeObjectTopY,
  formatSignedMeterLabel,
  getSafeParadeBackwardDistance,
  getSafeParadeCanvasDistance,
  normalizeParadeHorizontalMeasureMode,
} from "../utils/parade";
import {
  TOUCH_LONG_PRESS_DELAY_MS,
  hasTouchLongPressMoved,
} from "../utils/touchLongPress";
import { NumericInput } from "./NumericInput";

export type ParadeReflectOptions = {
  target: "all" | "group";
  groupId?: string;
  direction?: "forward" | "backward" | "left" | "right";
  moveMeters: number;
  moveObjects: boolean;
};

type ParadeCanvasProps = {
  project: Project;
  snapshot: StageSnapshot;
  selected: Selection;
  selectedFrameId: string | null;
  selectedFrameLabel: string;
  selectedMemberIds: string[];
  isMemberSelectionMode: boolean;
  focusMemberId?: string;
  focusMode: boolean;
  isReadOnly?: boolean;
  readOnlyMessage?: string;
  deferMemberDragCommit?: boolean;
  deferObjectDragCommit?: boolean;
  remoteMemberLocks?: Record<string, string>;
  remoteObjectLocks?: Record<string, string>;
  onSelect: (
    selection: Selection,
    options?: { append?: boolean },
  ) => void;
  onStagePointerPositionChange: (position: Position) => void;
  onMoveMember: (id: string, position: Position) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
  onBeginProjectEdit: (
    label?: string,
    target?: SceneElementEditTarget | SceneElementEditTarget[],
  ) => boolean | void | Promise<boolean | void>;
  onEndProjectEdit: (
    target?: SceneElementEditTarget | SceneElementEditTarget[],
  ) => void;
  onFrameViewStateChange: (frameId: string, viewState: SceneViewState) => void;
  onReflectPreviousFrame: (options: ParadeReflectOptions) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onCaptureStageImage?: () => void;
  onContextMenuRequest: (request: StageContextMenuRequest) => void;
  onReadOnlyEditAttempt?: () => void;
  onLockedElementEditAttempt?: (ownerName: string) => void;
};

export type ParadeCanvasHandle = HTMLDivElement & {
  scrollTargetIntoView: (bounds: ParadeScrollBounds) => void;
};

export type ParadeScrollBounds = {
  minimumScroll?: boolean;
  heightMeters: number;
  widthMeters: number;
  x: number;
  y: number;
};

type DragState =
  | {
      type: "member";
      id: string;
      memberIds: string[];
      startClientX: number;
      startClientY: number;
      currentClientX: number;
      currentClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
      startPosition: Position;
      startPositions: Record<string, Position>;
      hasMoved: boolean;
      isBeginPending: boolean;
    }
  | {
      type: "object";
      interaction: "move" | "resize";
      id: string;
      startClientX: number;
      startClientY: number;
      currentClientX: number;
      currentClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
      startState: ObjectState;
      hasMoved: boolean;
      isBeginPending: boolean;
    }
  | {
      type: "object";
      interaction: "rotate";
      id: string;
      startClientX: number;
      startClientY: number;
      currentClientX: number;
      currentClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
      startState: ObjectState;
      startAngle: number;
      centerClientX: number;
      centerClientY: number;
      hasMoved: boolean;
      isBeginPending: boolean;
    };

type PinchTouchPoint = {
  clientX: number;
  clientY: number;
};

type PinchZoomState = {
  pointerIds: [number, number];
  startDistance: number;
  startZoom: number;
  anchorWithinLayout: { x: number; y: number } | null;
  lastAnchor: { clientX: number; clientY: number };
};

type TouchContextMenuState = {
  clientX: number;
  clientY: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  target: StageContextMenuRequest["target"];
  timerId: number;
};

type CenterSplitLabel = {
  key: string;
  label: string;
  positionMeters: number;
};

type MemberDisplayOffset = {
  x: number;
  y: number;
};

type ParadeMemberStyle = CSSProperties & {
  "--member-drag-x"?: string;
  "--member-drag-y"?: string;
  "--member-overlap-x": string;
  "--member-overlap-y": string;
};

type ParadeObjectStyle = CSSProperties & {
  "--object-drag-x"?: string;
  "--object-drag-y"?: string;
  "--object-drag-width"?: string;
  "--object-drag-height"?: string;
  "--object-drag-rotation"?: string;
};

const BASE_PX_PER_METER = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const RULER_WIDTH = 58;
const MEMBER_OVERLAP_KEY_SCALE = 100;
const MIN_OBJECT_SIZE_METERS = 0.1;
const OBJECT_DRAG_SNAP_METERS = 0.25;

const DEFAULT_PARADE_SETTINGS: ParadeSettings = {
  totalDistance: 100,
  width: 20,
  cellSizeMeters: 1,
  direction: "up",
  rulerPosition: "both",
  horizontalMeasureMode: "centerSplit",
  emphasizeEvery5m: true,
  emphasizeEvery10m: true,
  backwardDistanceMeters: 0,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clampZoom = (value: number) =>
  Math.round(clamp(value, MIN_ZOOM, MAX_ZOOM) * 100) / 100;

const snapMeters = (value: number, gridSize: number) => {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return roundMeters(value);
  }
  return roundMeters(Math.round(value / gridSize) * gridSize);
};

const createMeterGridTicks = (lengthMeters: number, stepMeters: number) => {
  return createMeterGridTicksInRange(0, lengthMeters, stepMeters);
};

const createMeterGridTicksInRange = (
  minMeters: number,
  maxMeters: number,
  stepMeters: number,
) => {
  const safeMin = Math.min(minMeters, maxMeters);
  const safeMax = Math.max(minMeters, maxMeters);
  const safeStep = Number.isFinite(stepMeters) && stepMeters > 0 ? stepMeters : 1;
  const ticks: number[] = [];

  const firstTick = Math.ceil((safeMin - 0.001) / safeStep) * safeStep;
  for (let value = firstTick; value <= safeMax + 0.001; value += safeStep) {
    ticks.push(roundMeters(value));
  }

  [safeMin, safeMax].forEach((edge) => {
    const roundedEdge = roundMeters(edge);
    if (!ticks.some((tick) => Math.abs(tick - roundedEdge) < 0.001)) {
      ticks.push(roundedEdge);
    }
  });

  return Array.from(new Set(ticks)).sort((a, b) => a - b);
};

const getParadeMeterRulerClassName = (meter: number) => {
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

const isMeterMultiple = (value: number, intervalMeters: number) => {
  if (!Number.isFinite(intervalMeters) || intervalMeters <= 0) {
    return false;
  }
  return Math.abs(value / intervalMeters - Math.round(value / intervalMeters)) < 0.001;
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

const getObjectState = (
  objectId: string,
  project: Project,
  snapshot: StageSnapshot,
): ObjectState | null => {
  const object = project.stageObjects.find((item) => item.id === objectId);
  if (!object) {
    return null;
  }
  return (
    snapshot.objectStates[objectId] ?? {
      objectId,
      x: object.defaultX,
      y: object.defaultY,
      widthMeters: object.widthMeters,
      heightMeters: object.heightMeters,
      rotation: object.defaultRotation,
      visible: object.visible,
      zIndex: object.zIndex,
    }
  );
};

const getObjectFill = (object: Project["stageObjects"][number]) => {
  if (object.shape === "curtain" || object.type === "curtain") {
    return `repeating-linear-gradient(90deg, ${object.color}33 0 8px, ${object.color}66 8px 16px)`;
  }
  return `${object.color}30`;
};

export const ParadeCanvas = forwardRef<HTMLDivElement, ParadeCanvasProps>(
  (
    {
      project,
      snapshot,
      selected,
      selectedFrameId,
      selectedFrameLabel,
      selectedMemberIds,
      isMemberSelectionMode,
      focusMemberId,
      focusMode,
      isReadOnly = false,
      readOnlyMessage,
      deferMemberDragCommit = false,
      deferObjectDragCommit = false,
      remoteMemberLocks = {},
      remoteObjectLocks = {},
      onSelect,
      onStagePointerPositionChange,
      onMoveMember,
      onUpdateObjectState,
      onBeginProjectEdit,
      onEndProjectEdit,
      onFrameViewStateChange,
      onReflectPreviousFrame,
      canUndo,
      canRedo,
      onUndo,
    onRedo,
    isFullscreen,
    onToggleFullscreen,
    onCaptureStageImage,
      onContextMenuRequest,
      onReadOnlyEditAttempt,
      onLockedElementEditAttempt,
    },
  ref,
) => {
    const currentFrame =
      project.frames.find((frame) => frame.id === selectedFrameId) ??
      project.frames[0];
    const settings = {
      ...DEFAULT_PARADE_SETTINGS,
      ...(project.paradeSettings ?? {}),
      horizontalMeasureMode: normalizeParadeHorizontalMeasureMode(
        project.paradeSettings?.horizontalMeasureMode,
      ),
    };
    const [zoom, setZoom] = useState(currentFrame?.sceneViewState?.zoom ?? 1);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [reflectTarget, setReflectTarget] = useState<"all" | "group">("all");
    const [reflectGroupId, setReflectGroupId] = useState(
      project.memberGroups?.[0]?.id ?? "",
    );
    const [reflectDirection, setReflectDirection] = useState<
      "forward" | "backward" | "left" | "right"
    >("forward");
    const [reflectMoveMeters, setReflectMoveMeters] = useState(5);
    const [reflectMoveObjects, setReflectMoveObjects] = useState(true);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const exportElementRef = useRef<HTMLDivElement | null>(null);
    const zoomLayoutRef = useRef<HTMLDivElement | null>(null);
    const memberElementRefs = useRef(new Map<string, HTMLElement>());
    const objectElementRefs = useRef(new Map<string, HTMLElement>());
    const memberDragClearFrameRef = useRef<number | null>(null);
    const objectDragClearFrameRef = useRef<number | null>(null);
    const zoomRef = useRef(zoom);
    const renderedZoomRef = useRef(zoom);
    const pinchTouchPointsRef = useRef(new Map<number, PinchTouchPoint>());
    const pinchZoomRef = useRef<PinchZoomState | null>(null);
    const touchContextMenuRef = useRef<TouchContextMenuState | null>(null);
    const pendingZoomRef = useRef<{
      zoom: number;
      anchor?: { clientX: number; clientY: number };
    } | null>(null);
    const zoomFrameRef = useRef<number | null>(null);
    const viewportWidthRef = useRef<number | null>(null);
    const horizontalScrollRangeRef = useRef<number | null>(null);
    const stableHorizontalViewRef = useRef<{
      scrollLeft: number;
      scrollRange: number;
    } | null>(null);
    const isPinchLockedRef = useRef(false);
    const saveViewTimerRef = useRef<number | null>(null);
    const [isPinching, setIsPinching] = useState(false);
    const [isPinchLocked, setIsPinchLocked] = useState(false);
    const backwardDistanceMeters = getSafeParadeBackwardDistance(
      settings.backwardDistanceMeters,
    );
    const canvasDistanceMeters = getSafeParadeCanvasDistance(
      settings.totalDistance,
      backwardDistanceMeters,
    );
    const pxPerMeter = BASE_PX_PER_METER * zoom;
    const canvasWidthPx = settings.width * pxPerMeter;
    const canvasHeightPx = canvasDistanceMeters * pxPerMeter;
    const horizontalRulerHeight = 28;
    const leftRulerVisible =
      settings.rulerPosition === "both" || settings.rulerPosition === "left";
    const rightRulerVisible =
      settings.rulerPosition === "both" || settings.rulerPosition === "right";
    const paradeLayoutWidthPx =
      canvasWidthPx +
      (leftRulerVisible ? RULER_WIDTH : 0) +
      (rightRulerVisible ? RULER_WIDTH : 0);
    const paradeLayoutHeightPx = canvasHeightPx + horizontalRulerHeight;
    const assignedMemberIds = useMemo(
      () =>
        new Set(
          Object.values(currentFrame?.objectAssignments ?? {}).flatMap(
            (memberIds) => memberIds,
          ),
        ),
      [currentFrame?.objectAssignments],
    );

    const visibleMembers = useMemo(
      () =>
        project.members.filter(
          (member) =>
            member.visible !== false &&
            snapshot.memberVisibility[member.id] !== false &&
            !assignedMemberIds.has(member.id),
        ),
      [assignedMemberIds, project.members, snapshot.memberVisibility],
    );
    const isDenseProject = project.members.length >= 120;
    const simplifyMemberLabels = isDenseProject && isPinching;

    const visibleObjects = useMemo(
      () => {
        const entries: { object: Project["stageObjects"][number]; state: ObjectState }[] = [];
        project.stageObjects.forEach((object) => {
          const state = getObjectState(object.id, project, snapshot);
          if (state && object.visible !== false && state.visible !== false) {
            entries.push({ object, state });
          }
        });
        return entries;
      },
      [project, snapshot],
    );

    const meterTicks = useMemo(() => {
      return createMeterGridTicksInRange(
        -backwardDistanceMeters,
        settings.totalDistance,
        1,
      );
    }, [backwardDistanceMeters, settings.totalDistance]);

    const gridStepMeters =
      Number.isFinite(settings.cellSizeMeters) && settings.cellSizeMeters > 0
        ? settings.cellSizeMeters
        : 1;
    const verticalGridTicks = useMemo(
      () => createMeterGridTicks(settings.width, gridStepMeters),
      [gridStepMeters, settings.width],
    );
    const horizontalGridTicks = useMemo(
      () =>
        createMeterGridTicksInRange(
          -backwardDistanceMeters,
          settings.totalDistance,
          gridStepMeters,
        ),
      [backwardDistanceMeters, gridStepMeters, settings.totalDistance],
    );

    const horizontalTicks = useMemo(() => {
      const ticks: number[] = [];
      const step = Math.max(0.5, Math.min(1, settings.cellSizeMeters || 1));
      for (let value = 0; value <= settings.width + 0.001; value += step) {
        const rounded = roundMeters(value);
        if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
          ticks.push(Math.round(rounded));
        }
      }
      return Array.from(new Set(ticks));
    }, [settings.cellSizeMeters, settings.width]);

    const centerSplitLabels = useMemo(
      () => createCenterSplitLabels(settings.width),
      [settings.width],
    );

    const formatHorizontalTick = (xMeters: number) => {
      return formatSignedMeterLabel(xMeters - settings.width / 2);
    };

    const memberDisplayOffsets = useMemo(() => {
      const clusters = new Map<string, string[]>();
      visibleMembers.forEach((member) => {
        const position = snapshot.positions[member.id];
        if (!position) {
          return;
        }
        const key = `${Math.round(position.x * MEMBER_OVERLAP_KEY_SCALE)}:${Math.round(
          position.y * MEMBER_OVERLAP_KEY_SCALE,
        )}`;
        const ids = clusters.get(key) ?? [];
        ids.push(member.id);
        clusters.set(key, ids);
      });

      const offsets = new Map<string, MemberDisplayOffset>();
      const diameterMeters = project.stage.memberDiameterMeters ?? 0.5;
      const radiusPx = Math.min(
        14,
        Math.max(7, pxPerMeter * diameterMeters * 0.22),
      );
      clusters.forEach((ids) => {
        if (ids.length <= 1) {
          offsets.set(ids[0], { x: 0, y: 0 });
          return;
        }
        ids.forEach((id, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index) / ids.length;
          offsets.set(id, {
            x: Math.round(Math.cos(angle) * radiusPx * 10) / 10,
            y: Math.round(Math.sin(angle) * radiusPx * 10) / 10,
          });
        });
      });

      return offsets;
    }, [project.stage.memberDiameterMeters, pxPerMeter, snapshot.positions, visibleMembers]);

    const saveViewState = (nextZoom = zoomRef.current) => {
      if (!currentFrame?.id || !scrollRef.current) {
        return;
      }
      stableHorizontalViewRef.current = {
        scrollLeft: scrollRef.current.scrollLeft,
        scrollRange: Math.max(
          0,
          scrollRef.current.scrollWidth - scrollRef.current.clientWidth,
        ),
      };
      onFrameViewStateChange(currentFrame.id, {
        scrollTop: scrollRef.current.scrollTop,
        scrollLeft: scrollRef.current.scrollLeft,
        zoom: clampZoom(nextZoom),
        viewportHeight: scrollRef.current.clientHeight,
        viewportWidth: scrollRef.current.clientWidth,
      });
    };

    const scheduleSaveViewState = () => {
      if (pinchZoomRef.current) {
        return;
      }
      if (saveViewTimerRef.current !== null) {
        window.clearTimeout(saveViewTimerRef.current);
      }
      saveViewTimerRef.current = window.setTimeout(saveViewState, 300);
    };

    useImperativeHandle(ref, () => {
      const exportElement = exportElementRef.current;
      if (!exportElement) {
        return null as unknown as ParadeCanvasHandle;
      }
      return Object.assign(exportElement, {
        scrollTargetIntoView: (bounds: ParadeScrollBounds) => {
          const container = scrollRef.current;
          const stageElement = stageRef.current;
          if (!container || !stageElement) {
            return;
          }
          const containerRect = container.getBoundingClientRect();
          const stageRect = stageElement.getBoundingClientRect();
          const marginPx = bounds.minimumScroll ? 0 : 80;
          const left = stageRect.left + (bounds.x / settings.width) * stageRect.width;
          const right =
            stageRect.left +
            ((bounds.x + bounds.widthMeters) / settings.width) *
              stageRect.width;
          const top =
            stageRect.top +
            (bounds.y / canvasDistanceMeters) * stageRect.height;
          const bottom =
            stageRect.top +
            ((bounds.y + bounds.heightMeters) / canvasDistanceMeters) *
              stageRect.height;
          let nextLeft = container.scrollLeft;
          let nextTop = container.scrollTop;

          if (left < containerRect.left + marginPx) {
            nextLeft -= containerRect.left + marginPx - left;
          } else if (right > containerRect.right - marginPx) {
            nextLeft += right - (containerRect.right - marginPx);
          }

          if (top < containerRect.top + marginPx) {
            nextTop -= containerRect.top + marginPx - top;
          } else if (bottom > containerRect.bottom - marginPx) {
            nextTop += bottom - (containerRect.bottom - marginPx);
          }

          if (bounds.minimumScroll && nextLeft === container.scrollLeft && nextTop === container.scrollTop) return;
          container.scrollTo({
            left: Math.max(0, nextLeft),
            top: Math.max(0, nextTop),
          });
          scheduleSaveViewState();
        },
      }) as ParadeCanvasHandle;
    }, [canvasDistanceMeters, ref, scheduleSaveViewState, settings.width]);

    const getStagePositionFromClientPoint = useCallback(
      (clientX: number, clientY: number): Position => {
        const stageElement = stageRef.current;
        if (!stageElement) {
          return {
            x: settings.width / 2,
            y: settings.totalDistance,
          };
        }
        const rect = stageElement.getBoundingClientRect();
        const rawX =
          ((clientX - rect.left) / Math.max(1, rect.width)) * settings.width;
        const rawY =
          ((clientY - rect.top) / Math.max(1, rect.height)) *
          canvasDistanceMeters;
        return {
          x: clamp(
            snapMeters(rawX, settings.cellSizeMeters),
            0,
            settings.width,
          ),
          y: clamp(
            snapMeters(rawY, settings.cellSizeMeters),
            0,
            canvasDistanceMeters,
          ),
        };
      },
      [canvasDistanceMeters, settings.cellSizeMeters, settings.totalDistance, settings.width],
    );

    const trackStagePointerPosition = useCallback(
      (clientX: number, clientY: number) => {
        onStagePointerPositionChange(
          getStagePositionFromClientPoint(clientX, clientY),
        );
      },
      [getStagePositionFromClientPoint, onStagePointerPositionChange],
    );

    const openContextMenuAt = useCallback(
      (
        clientX: number,
        clientY: number,
        target: StageContextMenuRequest["target"],
      ) => {
        const stagePosition = getStagePositionFromClientPoint(
          clientX,
          clientY,
        );
        onStagePointerPositionChange(stagePosition);
        onContextMenuRequest({
          clientX,
          clientY,
          stagePosition,
          target,
        });
      },
      [
        getStagePositionFromClientPoint,
        onContextMenuRequest,
        onStagePointerPositionChange,
      ],
    );

    const openContextMenu = useCallback(
      (
        event: ReactMouseEvent<HTMLElement>,
        target: StageContextMenuRequest["target"],
      ) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenuAt(event.clientX, event.clientY, target);
      },
      [openContextMenuAt],
    );

    const handleStagePointerMove = useCallback(
      (event: PointerEvent<HTMLDivElement>) => {
        if (pinchZoomRef.current) {
          return;
        }
        trackStagePointerPosition(event.clientX, event.clientY);
      },
      [trackStagePointerPosition],
    );

    useEffect(() => {
      setZoom(clampZoom(currentFrame?.sceneViewState?.zoom ?? 1));
    }, [currentFrame?.id, currentFrame?.sceneViewState?.zoom]);

    useEffect(() => {
      renderedZoomRef.current = zoom;
      zoomRef.current = zoom;
    }, [zoom]);

    const clearTransientZoom = () => {
      if (exportElementRef.current) {
        exportElementRef.current.style.removeProperty("transform");
        exportElementRef.current.style.removeProperty("transform-origin");
        exportElementRef.current.style.removeProperty("will-change");
      }
      if (zoomLayoutRef.current) {
        zoomLayoutRef.current.style.removeProperty("width");
        zoomLayoutRef.current.style.removeProperty("height");
      }
    };

    const cancelPendingZoom = () => {
      pendingZoomRef.current = null;
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
    };

    const clearPinch = () => {
      cancelTouchContextMenu();
      clearTransientZoom();
      pinchTouchPointsRef.current.clear();
      pinchZoomRef.current = null;
      setIsPinching(false);
    };

    function cancelTouchContextMenu() {
      const pending = touchContextMenuRef.current;
      if (pending) {
        window.clearTimeout(pending.timerId);
        touchContextMenuRef.current = null;
      }
    }

    const startTouchContextMenu = (
      event: PointerEvent<HTMLElement>,
      target: StageContextMenuRequest["target"],
    ) => {
      if (
        event.pointerType !== "touch" ||
        event.button !== 0 ||
        pinchZoomRef.current ||
        pinchTouchPointsRef.current.size > 1
      ) {
        return;
      }
      cancelTouchContextMenu();
      const pointerId = event.pointerId;
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const timerId = window.setTimeout(() => {
        const pending = touchContextMenuRef.current;
        if (!pending || pending.pointerId !== pointerId) {
          return;
        }
        touchContextMenuRef.current = null;
        openContextMenuAt(pending.clientX, pending.clientY, pending.target);
      }, TOUCH_LONG_PRESS_DELAY_MS);
      touchContextMenuRef.current = {
        clientX: startClientX,
        clientY: startClientY,
        pointerId,
        startClientX,
        startClientY,
        target,
        timerId,
      };
    };

    const trackTouchContextMenuMove = (event: PointerEvent<HTMLElement>) => {
      const pending = touchContextMenuRef.current;
      if (!pending || pending.pointerId !== event.pointerId) {
        return;
      }
      pending.clientX = event.clientX;
      pending.clientY = event.clientY;
      if (
        hasTouchLongPressMoved(
          pending.startClientX,
          pending.startClientY,
          event.clientX,
          event.clientY,
        )
      ) {
        cancelTouchContextMenu();
      }
    };

    const stopTouchContextMenu = (event: PointerEvent<HTMLElement>) => {
      if (touchContextMenuRef.current?.pointerId === event.pointerId) {
        cancelTouchContextMenu();
      }
    };

    const setMemberElementRef = (memberId: string, element: HTMLElement | null) => {
      if (element) {
        memberElementRefs.current.set(memberId, element);
        return;
      }
      memberElementRefs.current.delete(memberId);
    };

    const setObjectElementRef = (objectId: string, element: HTMLElement | null) => {
      if (element) {
        objectElementRefs.current.set(objectId, element);
        return;
      }
      objectElementRefs.current.delete(objectId);
    };

    const cancelPendingMemberDragClear = () => {
      if (memberDragClearFrameRef.current !== null) {
        window.cancelAnimationFrame(memberDragClearFrameRef.current);
        memberDragClearFrameRef.current = null;
      }
    };

    const clearMemberDragTransforms = (memberIds: string[]) => {
      memberIds.forEach((id) => {
        const element = memberElementRefs.current.get(id);
        element?.style.removeProperty("--member-drag-x");
        element?.style.removeProperty("--member-drag-y");
      });
    };

    const scheduleClearMemberDragTransforms = (memberIds: string[]) => {
      cancelPendingMemberDragClear();
      memberDragClearFrameRef.current = window.requestAnimationFrame(() => {
        memberDragClearFrameRef.current = null;
        clearMemberDragTransforms(memberIds);
      });
    };

    const cancelPendingObjectDragClear = () => {
      if (objectDragClearFrameRef.current !== null) {
        window.cancelAnimationFrame(objectDragClearFrameRef.current);
        objectDragClearFrameRef.current = null;
      }
    };

    const clearObjectDragPreview = (objectId: string) => {
      const element = objectElementRefs.current.get(objectId);
      if (!element) {
        return;
      }
      element.style.removeProperty("--object-drag-x");
      element.style.removeProperty("--object-drag-y");
      element.style.removeProperty("--object-drag-width");
      element.style.removeProperty("--object-drag-height");
      element.style.removeProperty("--object-drag-rotation");
    };

    const scheduleClearObjectDragPreview = (objectId: string) => {
      cancelPendingObjectDragClear();
      objectDragClearFrameRef.current = window.requestAnimationFrame(() => {
        objectDragClearFrameRef.current = null;
        clearObjectDragPreview(objectId);
      });
    };

    const previewMemberDragTransforms = (
      drag: Extract<DragState, { type: "member" }>,
      nextPositions: Record<string, Position>,
    ) => {
      drag.memberIds.forEach((id) => {
        const startPosition = drag.startPositions[id];
        const nextPosition = nextPositions[id];
        const element = memberElementRefs.current.get(id);
        if (!startPosition || !nextPosition || !element) {
          return;
        }
        element.style.setProperty(
          "--member-drag-x",
          `${(nextPosition.x - startPosition.x) * pxPerMeter}px`,
        );
        element.style.setProperty(
          "--member-drag-y",
          `${(nextPosition.y - startPosition.y) * pxPerMeter}px`,
        );
      });
    };

    const commitDeferredMemberDrag = (
      drag: DragState,
      latestPositions: Record<string, Position> | null,
    ) => {
      if (!deferMemberDragCommit || drag.type !== "member" || !latestPositions) {
        return;
      }
      Object.entries(latestPositions).forEach(([id, position]) => {
        onMoveMember(id, position);
      });
      scheduleClearMemberDragTransforms(drag.memberIds);
    };

    const previewObjectDrag = (
      drag: Extract<DragState, { type: "object" }>,
      patch: Partial<ObjectState>,
    ) => {
      const element = objectElementRefs.current.get(drag.id);
      if (!element) {
        return;
      }
      const nextState = {
        ...drag.startState,
        ...patch,
        widthMeters: Math.max(
          MIN_OBJECT_SIZE_METERS,
          patch.widthMeters ?? drag.startState.widthMeters,
        ),
        heightMeters: Math.max(
          MIN_OBJECT_SIZE_METERS,
          patch.heightMeters ?? drag.startState.heightMeters,
        ),
      };
      element.style.setProperty(
        "--object-drag-x",
        `${(nextState.x - drag.startState.x) * pxPerMeter}px`,
      );
      element.style.setProperty(
        "--object-drag-y",
        `${(nextState.y - drag.startState.y) * pxPerMeter}px`,
      );
      element.style.setProperty(
        "--object-drag-width",
        `${(nextState.widthMeters - drag.startState.widthMeters) * pxPerMeter}px`,
      );
      element.style.setProperty(
        "--object-drag-height",
        `${(nextState.heightMeters - drag.startState.heightMeters) * pxPerMeter}px`,
      );
      element.style.setProperty(
        "--object-drag-rotation",
        `${(nextState.rotation ?? 0) - drag.startState.rotation}deg`,
      );
    };

    const commitDeferredObjectDrag = (
      drag: DragState,
      latestPatch: Partial<ObjectState> | null,
    ) => {
      if (!deferObjectDragCommit || drag.type !== "object" || !latestPatch) {
        return;
      }
      onUpdateObjectState(drag.id, latestPatch);
      scheduleClearObjectDragPreview(drag.id);
    };

    useEffect(() => {
      isPinchLockedRef.current = isPinchLocked;
      if (isPinchLocked) {
        cancelPendingZoom();
        clearPinch();
      }
    }, [isPinchLocked]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) {
        return undefined;
      }
      const frameViewState = currentFrame?.sceneViewState;
      const frameId = currentFrame?.id;
      const raf = window.requestAnimationFrame(() => {
        if (frameViewState) {
          container.scrollTop = frameViewState.scrollTop;
          const savedViewportWidth =
            frameViewState.viewportWidth ?? container.clientWidth;
          const wasCenteredWithoutHorizontalScroll =
            frameViewState.scrollLeft <= 1 &&
            paradeLayoutWidthPx <= savedViewportWidth + 1;
          const centeredScrollLeft = wasCenteredWithoutHorizontalScroll
            ? (container.scrollWidth - container.clientWidth) / 2
            : frameViewState.scrollLeft +
              (savedViewportWidth - container.clientWidth) / 2;
          container.scrollLeft = Math.min(
            Math.max(0, centeredScrollLeft),
            Math.max(0, container.scrollWidth - container.clientWidth),
          );
          viewportWidthRef.current = container.clientWidth;
          horizontalScrollRangeRef.current = Math.max(
            0,
            container.scrollWidth - container.clientWidth,
          );
          stableHorizontalViewRef.current = {
            scrollLeft: container.scrollLeft,
            scrollRange: horizontalScrollRangeRef.current,
          };
          return;
        }
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
        horizontalScrollRangeRef.current = Math.max(
          0,
          container.scrollWidth - container.clientWidth,
        );
        stableHorizontalViewRef.current = {
          scrollLeft: container.scrollLeft,
          scrollRange: horizontalScrollRangeRef.current,
        };
        if (frameId) {
          onFrameViewStateChange(frameId, {
            scrollTop: container.scrollTop,
            scrollLeft: container.scrollLeft,
            zoom,
          });
        }
      });
      return () => window.cancelAnimationFrame(raf);
    }, [currentFrame?.id]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) {
        return undefined;
      }
      viewportWidthRef.current = container.clientWidth;
      horizontalScrollRangeRef.current = Math.max(
        0,
        container.scrollWidth - container.clientWidth,
      );
      let resizeFrame = 0;
      const observer = new ResizeObserver(() => {
        if (resizeFrame) {
          window.cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          const previousWidth = viewportWidthRef.current ?? container.clientWidth;
          const nextWidth = container.clientWidth;
          if (Math.abs(previousWidth - nextWidth) < 1) {
            return;
          }
          const previousRange = horizontalScrollRangeRef.current ?? Math.max(
            0,
            container.scrollWidth - previousWidth,
          );
          const nextRange = Math.max(0, container.scrollWidth - nextWidth);
          const stableView = stableHorizontalViewRef.current;
          const wasHorizontallyCentered =
            stableView
              ? stableView.scrollRange <= 1
                ? stableView.scrollLeft <= 1
                : Math.abs(
                    stableView.scrollLeft - stableView.scrollRange / 2,
                  ) <= 12
              : previousRange <= 1
                ? container.scrollLeft <= 1
                : Math.abs(container.scrollLeft - previousRange / 2) <= 12;
          const centeredScrollLeft = wasHorizontallyCentered
            ? nextRange / 2
            : container.scrollLeft + (previousWidth - nextWidth) / 2;
          container.scrollLeft = Math.min(
            Math.max(0, centeredScrollLeft),
            nextRange,
          );
          viewportWidthRef.current = nextWidth;
          horizontalScrollRangeRef.current = nextRange;
          scheduleSaveViewState();
        });
      });
      observer.observe(container);
      return () => {
        if (resizeFrame) {
          window.cancelAnimationFrame(resizeFrame);
        }
        observer.disconnect();
      };
    }, [currentFrame?.id]);

    useEffect(
      () => () => {
        if (saveViewTimerRef.current !== null) {
          window.clearTimeout(saveViewTimerRef.current);
        }
        cancelTouchContextMenu();
        cancelPendingZoom();
        cancelPendingMemberDragClear();
        cancelPendingObjectDragClear();
        clearMemberDragTransforms([...memberElementRefs.current.keys()]);
        [...objectElementRefs.current.keys()].forEach(clearObjectDragPreview);
      },
      [],
    );

    useEffect(() => {
      if (!dragState) {
        return undefined;
      }
      let currentClientX = dragState.currentClientX;
      let currentClientY = dragState.currentClientY;
      let didMove = dragState.hasMoved;
      let beginPending = dragState.isBeginPending;
      let endRequested = false;
      let latestMemberPositions: Record<string, Position> | null = null;
      let latestObjectPatch: Partial<ObjectState> | null = null;
      let autoScroller: ReturnType<typeof createEdgeAutoScroller> | null = null;
      let isCancelled = false;
      const applyDrag = (clientX: number, clientY: number) => {
        currentClientX = clientX;
        currentClientY = clientY;
        const movementPx = Math.hypot(
          clientX - dragState.startClientX,
          clientY - dragState.startClientY,
        );
        if (movementPx < 3) {
          return;
        }
        if (beginPending) {
          return;
        }
        cancelTouchContextMenu();
        const scrollLeft = scrollRef.current?.scrollLeft ?? dragState.startScrollLeft;
        const scrollTop = scrollRef.current?.scrollTop ?? dragState.startScrollTop;
        const dx =
          (clientX -
            dragState.startClientX +
            scrollLeft -
            dragState.startScrollLeft) /
          pxPerMeter;
        const dy =
          (clientY -
            dragState.startClientY +
            scrollTop -
            dragState.startScrollTop) /
          pxPerMeter;
        if (!didMove) {
          const editLabel =
            dragState.type === "object" && dragState.interaction === "resize"
              ? "道具サイズ変更"
              : dragState.type === "object" && dragState.interaction === "rotate"
                ? "道具回転"
                : dragState.type === "member" && dragState.memberIds.length > 1
                  ? "複数メンバー移動"
                  : "パレード配置編集";
          const editTarget: SceneElementEditTarget | SceneElementEditTarget[] =
            dragState.type === "member"
              ? dragState.memberIds.map((id) => ({
                  id,
                  type: "member-position",
                }))
              : { id: dragState.id, type: "object-state" };
          const normalizedEditTarget =
            Array.isArray(editTarget) && editTarget.length === 1
              ? editTarget[0]
              : editTarget;
          beginPending = true;
          const beginResult = onBeginProjectEdit(editLabel, normalizedEditTarget);
          void Promise.resolve(beginResult).then((canEdit) => {
            beginPending = false;
            if (isCancelled) {
              if (canEdit !== false) {
                onEndProjectEdit(normalizedEditTarget);
              }
              return;
            }
            if (canEdit === false) {
              autoScroller?.stop();
              setDragState(null);
              return;
            }
            didMove = true;
            const shouldKeepDragStateLocal =
              (deferMemberDragCommit && dragState.type === "member") ||
              (deferObjectDragCommit && dragState.type === "object");
            if (!endRequested && !shouldKeepDragStateLocal) {
              setDragState({
                ...dragState,
                currentClientX,
                currentClientY,
                hasMoved: true,
                isBeginPending: false,
              });
            }
            applyDrag(currentClientX, currentClientY);
            if (endRequested) {
              commitDeferredMemberDrag(dragState, latestMemberPositions);
              commitDeferredObjectDrag(dragState, latestObjectPatch);
              autoScroller?.stop();
              setDragState(null);
              onEndProjectEdit(normalizedEditTarget);
              return;
            }
            autoScroller?.update(currentClientX, currentClientY);
          });
          return;
        }
        if (dragState.type === "member") {
          const primaryStartPosition =
            dragState.startPositions[dragState.id] ?? dragState.startPosition;
          const primaryNextPosition = {
            x: clamp(
              snapMeters(primaryStartPosition.x + dx, settings.cellSizeMeters),
              0,
              settings.width,
            ),
            y: clamp(
              snapMeters(primaryStartPosition.y + dy, settings.cellSizeMeters),
              0,
              canvasDistanceMeters,
            ),
          };
          const primaryDelta = {
            x: primaryNextPosition.x - primaryStartPosition.x,
            y: primaryNextPosition.y - primaryStartPosition.y,
          };
          const nextPositions: Record<string, Position> = {};
          dragState.memberIds.forEach((id) => {
            const startPosition = dragState.startPositions[id];
            if (!startPosition) {
              return;
            }
            nextPositions[id] = {
              x: clamp(startPosition.x + primaryDelta.x, 0, settings.width),
              y: clamp(startPosition.y + primaryDelta.y, 0, canvasDistanceMeters),
            };
          });
          latestMemberPositions = nextPositions;
          if (deferMemberDragCommit) {
            previewMemberDragTransforms(dragState, nextPositions);
            return;
          }
          Object.entries(nextPositions).forEach(([id, position]) => {
            onMoveMember(id, position);
          });
        } else if (dragState.interaction === "resize") {
          const maxWidth = Math.max(
            MIN_OBJECT_SIZE_METERS,
            settings.width - dragState.startState.x,
          );
          const maxHeight = Math.max(
            MIN_OBJECT_SIZE_METERS,
            canvasDistanceMeters - dragState.startState.y,
          );
          const nextWidth = clamp(
            snapMeters(
              dragState.startState.widthMeters + dx,
              settings.cellSizeMeters,
            ),
            MIN_OBJECT_SIZE_METERS,
            maxWidth,
          );
          const nextHeight = clamp(
            snapMeters(
              dragState.startState.heightMeters + dy,
              settings.cellSizeMeters,
            ),
            MIN_OBJECT_SIZE_METERS,
            maxHeight,
          );
          latestObjectPatch = {
            widthMeters: nextWidth,
            heightMeters: nextHeight,
          };
          if (deferObjectDragCommit) {
            previewObjectDrag(dragState, latestObjectPatch);
            return;
          }
          onUpdateObjectState(dragState.id, latestObjectPatch);
        } else if (dragState.interaction === "rotate") {
          const currentAngle =
            (Math.atan2(
              clientY - dragState.centerClientY,
              clientX - dragState.centerClientX,
            ) *
              180) /
            Math.PI;
          const nextRotation =
            Math.round((dragState.startState.rotation + currentAngle - dragState.startAngle) / 5) *
            5;
          latestObjectPatch = {
            rotation: roundMeters(nextRotation),
          };
          if (deferObjectDragCommit) {
            previewObjectDrag(dragState, latestObjectPatch);
            return;
          }
          onUpdateObjectState(dragState.id, latestObjectPatch);
        } else {
          const maxObjectX = Math.max(
            0,
            settings.width - dragState.startState.widthMeters,
          );
          const nextX = clamp(
            snapMeters(dragState.startState.x + dx, OBJECT_DRAG_SNAP_METERS),
            0,
            maxObjectX,
          );
          const nextY = clampParadeObjectTopY(
            snapMeters(dragState.startState.y + dy, OBJECT_DRAG_SNAP_METERS),
            dragState.startState.heightMeters,
            settings.totalDistance,
            backwardDistanceMeters,
          );
          latestObjectPatch = { x: nextX, y: nextY };
          if (deferObjectDragCommit) {
            previewObjectDrag(dragState, latestObjectPatch);
            return;
          }
          onUpdateObjectState(dragState.id, latestObjectPatch);
        }
      };
      autoScroller =
        dragState.type === "object" && dragState.interaction === "rotate"
          ? null
          : scrollRef.current
            ? createEdgeAutoScroller(scrollRef.current, {
                onScroll: () => applyDrag(currentClientX, currentClientY),
              })
            : null;
      const handlePointerMove = (event: globalThis.PointerEvent) => {
        applyDrag(event.clientX, event.clientY);
        autoScroller?.update(event.clientX, event.clientY);
      };
      const handlePointerUp = (event?: globalThis.PointerEvent) => {
        if (event) {
          currentClientX = event.clientX;
          currentClientY = event.clientY;
        }
        if (beginPending && !didMove) {
          endRequested = true;
          autoScroller?.stop();
          return;
        }
        const shouldEndEdit = didMove;
        autoScroller?.stop();
        setDragState(null);
        if (shouldEndEdit) {
          const editTarget =
            dragState.type === "member"
              ? dragState.memberIds.map((id) => ({
                  id,
                  type: "member-position" as const,
                }))
              : { id: dragState.id, type: "object-state" as const };
          commitDeferredMemberDrag(dragState, latestMemberPositions);
          commitDeferredObjectDrag(dragState, latestObjectPatch);
          onEndProjectEdit(
            Array.isArray(editTarget) && editTarget.length === 1
              ? editTarget[0]
              : editTarget,
          );
        }
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
      window.addEventListener("pointercancel", handlePointerUp, { once: true });
      return () => {
        isCancelled = true;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        autoScroller?.stop();
      };
    }, [
      dragState,
      onEndProjectEdit,
      onBeginProjectEdit,
      onMoveMember,
      onUpdateObjectState,
      deferMemberDragCommit,
      deferObjectDragCommit,
      pxPerMeter,
      settings.cellSizeMeters,
      backwardDistanceMeters,
      canvasDistanceMeters,
      settings.totalDistance,
      settings.width,
    ]);

    const applyZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
      options?: {
        persist?: boolean;
        layoutAnchor?: { x: number; y: number } | null;
        sourceZoom?: number;
      },
    ) => {
      const clampedZoom = clampZoom(nextZoom);
      const shouldPersist = options?.persist ?? true;
      zoomRef.current = clampedZoom;
      const container = scrollRef.current;
      if (!container || !anchor) {
        setZoom(clampedZoom);
        if (shouldPersist) {
          window.setTimeout(() => saveViewState(clampedZoom), 0);
        }
        return;
      }

      const rect = container.getBoundingClientRect();
      const anchorX = anchor.clientX - rect.left;
      const anchorY = anchor.clientY - rect.top;
      const stageRect = stageRef.current?.getBoundingClientRect();
      const anchorStageRatio =
        stageRect && anchor
          ? {
              x: Math.min(
                1,
                Math.max(
                  0,
                  (anchor.clientX - stageRect.left) / Math.max(1, stageRect.width),
                ),
              ),
              y: Math.min(
                1,
                Math.max(
                  0,
                  (anchor.clientY - stageRect.top) / Math.max(1, stageRect.height),
                ),
              ),
            }
          : null;
      const ratioX = (container.scrollLeft + anchorX) / Math.max(1, container.scrollWidth);
      const ratioY =
        (container.scrollTop + anchorY) / Math.max(1, container.scrollHeight);
      setZoom(clampedZoom);
      window.requestAnimationFrame(() => {
        const nextContainer = scrollRef.current;
        if (!nextContainer) {
          return;
        }
        if (options?.layoutAnchor && zoomLayoutRef.current) {
          const nextLayout = zoomLayoutRef.current;
          const scaleFromSource =
            clampedZoom / Math.max(MIN_ZOOM, options.sourceZoom ?? renderedZoomRef.current);
          nextContainer.scrollLeft = Math.max(
            0,
            nextLayout.offsetLeft + options.layoutAnchor.x * scaleFromSource - anchorX,
          );
          nextContainer.scrollTop = Math.max(
            0,
            nextLayout.offsetTop + options.layoutAnchor.y * scaleFromSource - anchorY,
          );
          if (shouldPersist) {
            saveViewState(clampedZoom);
          }
          return;
        }
        if (anchorStageRatio && stageRef.current) {
          const nextContainerRect = nextContainer.getBoundingClientRect();
          const nextStageRect = stageRef.current.getBoundingClientRect();
          const nextAnchorX =
            nextStageRect.left -
            nextContainerRect.left +
            nextStageRect.width * anchorStageRatio.x;
          const nextAnchorY =
            nextStageRect.top -
            nextContainerRect.top +
            nextStageRect.height * anchorStageRatio.y;
          nextContainer.scrollLeft = Math.max(
            0,
            nextContainer.scrollLeft + nextAnchorX - anchorX,
          );
          nextContainer.scrollTop = Math.max(
            0,
            nextContainer.scrollTop + nextAnchorY - anchorY,
          );
          if (shouldPersist) {
            saveViewState(clampedZoom);
          }
          return;
        }
        nextContainer.scrollLeft = Math.max(
          0,
          ratioX * nextContainer.scrollWidth - anchorX,
        );
        nextContainer.scrollTop = Math.max(
          0,
          ratioY * nextContainer.scrollHeight - anchorY,
        );
        if (shouldPersist) {
          saveViewState(clampedZoom);
        }
      });
    };

    const scheduleZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      const clampedZoom = clampZoom(nextZoom);
      zoomRef.current = clampedZoom;
      pendingZoomRef.current = {
        zoom: clampedZoom,
        anchor,
      };
      if (zoomFrameRef.current !== null) {
        return;
      }
      zoomFrameRef.current = window.requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        const pending = pendingZoomRef.current;
        pendingZoomRef.current = null;
        if (!pending) {
          return;
        }
        const container = scrollRef.current;
        const layout = zoomLayoutRef.current;
        const exportElement = exportElementRef.current;
        const pinch = pinchZoomRef.current;
        if (!container || !layout || !exportElement || !pinch || !pending.anchor) {
          return;
        }
        const scale = pending.zoom / Math.max(MIN_ZOOM, renderedZoomRef.current);
        const containerRect = container.getBoundingClientRect();
        const anchorX = pending.anchor.clientX - containerRect.left;
        const anchorY = pending.anchor.clientY - containerRect.top;
        exportElement.style.transformOrigin = "0 0";
        exportElement.style.willChange = "transform";
        exportElement.style.transform = `scale(${scale})`;
        layout.style.width = `${paradeLayoutWidthPx * scale}px`;
        layout.style.height = `${paradeLayoutHeightPx * scale}px`;
        if (pinch.anchorWithinLayout) {
          container.scrollLeft = Math.max(
            0,
            layout.offsetLeft + pinch.anchorWithinLayout.x * scale - anchorX,
          );
          container.scrollTop = Math.max(
            0,
            layout.offsetTop + pinch.anchorWithinLayout.y * scale - anchorY,
          );
        }
      });
    };

    const updateZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      cancelPendingZoom();
      const container = scrollRef.current;
      if (!anchor && container) {
        const rect = container.getBoundingClientRect();
        applyZoom(nextZoom, {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        });
        return;
      }
      applyZoom(nextZoom, anchor);
    };

    const handleViewportScroll = () => {
      const container = scrollRef.current;
      if (container) {
        horizontalScrollRangeRef.current = Math.max(
          0,
          container.scrollWidth - container.clientWidth,
        );
      }
      scheduleSaveViewState();
    };

    const getPinchDistance = (first: PinchTouchPoint, second: PinchTouchPoint) =>
      Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);

    const getPinchMidpoint = (
      first: PinchTouchPoint,
      second: PinchTouchPoint,
    ) => ({
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2,
    });

    const beginPinchIfReady = () => {
      if (isPinchLockedRef.current) {
        return;
      }
      cancelTouchContextMenu();
      if (saveViewTimerRef.current !== null) {
        window.clearTimeout(saveViewTimerRef.current);
        saveViewTimerRef.current = null;
      }
      const touchEntries = Array.from(pinchTouchPointsRef.current.entries());
      if (touchEntries.length < 2) {
        return;
      }
      const [firstEntry, secondEntry] = touchEntries;
      const midpoint = getPinchMidpoint(firstEntry[1], secondEntry[1]);
      const container = scrollRef.current;
      const layout = zoomLayoutRef.current;
      const containerRect = container?.getBoundingClientRect();
      pinchZoomRef.current = {
        pointerIds: [firstEntry[0], secondEntry[0]],
        startDistance: Math.max(
          1,
          getPinchDistance(firstEntry[1], secondEntry[1]),
        ),
        startZoom: zoomRef.current,
        anchorWithinLayout:
          container && layout && containerRect
            ? {
                x:
                  container.scrollLeft + midpoint.clientX - containerRect.left -
                  layout.offsetLeft,
                y:
                  container.scrollTop + midpoint.clientY - containerRect.top -
                  layout.offsetTop,
              }
            : null,
        lastAnchor: midpoint,
      };
      if (dragState) {
        const shouldEndEdit = dragState.hasMoved;
        setDragState(null);
        if (shouldEndEdit) {
          onEndProjectEdit();
        }
      }
      setIsPinching(true);
    };

    const handleViewportPointerDownCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      if (event.pointerType !== "touch" || isPinchLockedRef.current) {
        return;
      }
      pinchTouchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (pinchTouchPointsRef.current.size >= 2) {
        if (!pinchZoomRef.current) {
          beginPinchIfReady();
        }
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleViewportPointerMoveCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      trackTouchContextMenuMove(event);
      if (
        event.pointerType !== "touch" ||
        isPinchLockedRef.current ||
        !pinchTouchPointsRef.current.has(event.pointerId)
      ) {
        return;
      }
      pinchTouchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      const pinch = pinchZoomRef.current;
      if (!pinch) {
        return;
      }
      const first = pinchTouchPointsRef.current.get(pinch.pointerIds[0]);
      const second = pinchTouchPointsRef.current.get(pinch.pointerIds[1]);
      if (!first || !second) {
        return;
      }
      const distance = Math.max(1, getPinchDistance(first, second));
      const midpoint = getPinchMidpoint(first, second);
      pinch.lastAnchor = midpoint;
      scheduleZoom(
        pinch.startZoom * (distance / pinch.startDistance),
        midpoint,
      );
      event.preventDefault();
      event.stopPropagation();
    };

    const handleViewportPointerEndCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      if (event.pointerType !== "touch") {
        return;
      }
      stopTouchContextMenu(event);
      pinchTouchPointsRef.current.delete(event.pointerId);
      if (pinchTouchPointsRef.current.size < 2) {
        const completedPinch = pinchZoomRef.current;
        cancelPendingZoom();
        const finalZoom = zoomRef.current;
        const finalAnchor = completedPinch?.lastAnchor;
        clearTransientZoom();
        pinchZoomRef.current = null;
        setIsPinching(false);
        applyZoom(finalZoom, finalAnchor, {
          persist: true,
          layoutAnchor: completedPinch?.anchorWithinLayout,
          sourceZoom: completedPinch?.startZoom,
        });
        return;
      }
      beginPinchIfReady();
    };

    const jumpToStart = () => {
      if (!scrollRef.current) {
        return;
      }
      scrollRef.current.scrollTop = Math.max(
        0,
        scrollRef.current.scrollHeight - scrollRef.current.clientHeight,
      );
      scheduleSaveViewState();
    };

    const jumpToGoal = () => {
      if (!scrollRef.current) {
        return;
      }
      scrollRef.current.scrollTop = 0;
      scheduleSaveViewState();
    };

    const startMemberDrag = (
      memberId: string,
      position: Position,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      if (event.button !== 0) {
        return;
      }
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const appendSelection =
        isMemberSelectionMode || event.ctrlKey || event.metaKey;
      const dragMemberIds =
        !appendSelection &&
        selectedMemberIds.length > 1 &&
        selectedMemberIds.includes(memberId)
          ? selectedMemberIds
          : [memberId];
      if (!dragMemberIds.includes(memberId)) {
        dragMemberIds.unshift(memberId);
      }
      if (!(dragMemberIds.length > 1 && dragMemberIds.includes(memberId))) {
        onSelect({ type: "member", id: memberId }, { append: appendSelection });
      }
      const remoteLockOwner = dragMemberIds
        .map((id) => remoteMemberLocks[id])
        .find(Boolean);
      if (remoteLockOwner) {
        onLockedElementEditAttempt?.(remoteLockOwner);
        return;
      }
      if (isReadOnly) {
        onReadOnlyEditAttempt?.();
        return;
      }
      startTouchContextMenu(event, { type: "member", id: memberId });
      if (appendSelection) {
        return;
      }
      cancelPendingMemberDragClear();
      const startPositions = Object.fromEntries(
        dragMemberIds
          .map((id) => [id, snapshot.positions[id]] as const)
          .filter((entry): entry is readonly [string, Position] =>
            Boolean(entry[1]),
          ),
      );
      setDragState({
        type: "member",
        id: memberId,
        memberIds:
          Object.keys(startPositions).length > 0
            ? Object.keys(startPositions)
            : [memberId],
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
        startScrollTop: scrollRef.current?.scrollTop ?? 0,
        startPosition: position,
        startPositions:
          Object.keys(startPositions).length > 0
            ? startPositions
            : { [memberId]: position },
        hasMoved: false,
        isBeginPending: false,
      });
    };

    const startObjectDrag = (
      objectId: string,
      state: ObjectState,
      event: PointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) {
        return;
      }
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSelect({ type: "object", id: objectId });
      const remoteLockOwner = remoteObjectLocks[objectId];
      if (remoteLockOwner) {
        onLockedElementEditAttempt?.(remoteLockOwner);
        return;
      }
      if (isReadOnly) {
        onReadOnlyEditAttempt?.();
        return;
      }
      startTouchContextMenu(event, { type: "object", id: objectId });
      cancelPendingObjectDragClear();
      setDragState({
        type: "object",
        interaction: "move",
        id: objectId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
        startScrollTop: scrollRef.current?.scrollTop ?? 0,
        startState: state,
        hasMoved: false,
        isBeginPending: false,
      });
    };

    const startObjectResize = (
      objectId: string,
      state: ObjectState,
      event: PointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) {
        return;
      }
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSelect({ type: "object", id: objectId });
      const remoteLockOwner = remoteObjectLocks[objectId];
      if (remoteLockOwner) {
        onLockedElementEditAttempt?.(remoteLockOwner);
        return;
      }
      if (isReadOnly) {
        onReadOnlyEditAttempt?.();
        return;
      }
      cancelPendingObjectDragClear();
      setDragState({
        type: "object",
        interaction: "resize",
        id: objectId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
        startScrollTop: scrollRef.current?.scrollTop ?? 0,
        startState: state,
        hasMoved: false,
        isBeginPending: false,
      });
    };

    const startObjectRotate = (
      objectId: string,
      state: ObjectState,
      event: PointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) {
        return;
      }
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const objectElement = event.currentTarget.closest(".parade-object");
      if (!(objectElement instanceof HTMLElement)) {
        return;
      }
      const rect = objectElement.getBoundingClientRect();
      const centerClientX = rect.left + rect.width / 2;
      const centerClientY = rect.top + rect.height / 2;
      const startAngle =
        (Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX) *
          180) /
        Math.PI;
      onSelect({ type: "object", id: objectId });
      const remoteLockOwner = remoteObjectLocks[objectId];
      if (remoteLockOwner) {
        onLockedElementEditAttempt?.(remoteLockOwner);
        return;
      }
      if (isReadOnly) {
        onReadOnlyEditAttempt?.();
        return;
      }
      cancelPendingObjectDragClear();
      setDragState({
        type: "object",
        interaction: "rotate",
        id: objectId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
        startScrollTop: scrollRef.current?.scrollTop ?? 0,
        startState: state,
        startAngle,
        centerClientX,
        centerClientY,
        hasMoved: false,
        isBeginPending: false,
      });
    };

    return (
      <div className={isReadOnly ? "parade-canvas-shell is-read-only" : "parade-canvas-shell"}>
        <aside className="parade-control-panel" aria-label="パレード操作">
          <div className="parade-control-panel__header">
            <div className="parade-control-panel__heading">
              <strong>パレード操作</strong>
              <span>{selectedFrameLabel}</span>
            </div>
            <div className="parade-history-controls" aria-label="編集履歴">
              <button
                className="mini-button icon-only undo-redo-button"
                type="button"
                onClick={onUndo}
                disabled={!canUndo || isReadOnly}
                title="元に戻す（Ctrl+Z）"
                aria-label="元に戻す"
              >
                <Undo2 size={17} />
              </button>
              <button
                className="mini-button icon-only undo-redo-button"
                type="button"
                onClick={onRedo}
                disabled={!canRedo || isReadOnly}
                title="やり直し（Ctrl+Y / Ctrl+Shift+Z）"
                aria-label="やり直し"
              >
                <Redo2 size={17} />
              </button>
            </div>
          </div>
          {isReadOnly && (
            <p className="stage-readonly-pill parade-readonly-pill" title={readOnlyMessage}>
              閲覧中
            </p>
          )}
          <section className="parade-control-section">
            <h3>前シーン反映</h3>
            <button
              className="mini-button"
              type="button"
              disabled={isReadOnly}
              onClick={() =>
                onReflectPreviousFrame({
                  target: "all",
                  direction: "forward",
                  moveMeters: 0,
                  moveObjects: reflectMoveObjects,
                })
              }
            >
              前シーンを反映
            </button>
            <label>
              対象
              <select
                value={reflectTarget}
                onChange={(event) => setReflectTarget(event.target.value as "all" | "group")}
              >
                <option value="all">全員</option>
                <option value="group">指定グループ</option>
              </select>
            </label>
            {reflectTarget === "group" && (
              <label>
                グループ
                <select
                  value={reflectGroupId}
                  onChange={(event) => setReflectGroupId(event.target.value)}
                >
                  {(project.memberGroups ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              方向
              <select
                value={reflectDirection}
                onChange={(event) =>
                  setReflectDirection(
                    event.target.value as "forward" | "backward" | "left" | "right",
                  )
                }
              >
                <option value="forward">前へ</option>
                <option value="backward">後ろへ</option>
                <option value="left">左へ</option>
                <option value="right">右へ</option>
              </select>
            </label>
            <label>
              移動量
              <span className="meter-input compact">
                <NumericInput
                  min={0}
                  step="0.5"
                  value={reflectMoveMeters}
                  onValueChange={setReflectMoveMeters}
                />
                m
              </span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={reflectMoveObjects}
                onChange={(event) => setReflectMoveObjects(event.target.checked)}
              />
              道具も移動
            </label>
            <button
              className="mini-button primary"
              type="button"
              disabled={isReadOnly}
              onClick={() =>
                onReflectPreviousFrame({
                  target: reflectTarget,
                  groupId: reflectTarget === "group" ? reflectGroupId : undefined,
                  direction: reflectDirection,
                  moveMeters: reflectMoveMeters,
                  moveObjects: reflectMoveObjects,
                })
              }
            >
              反映して移動
            </button>
          </section>
          <section className="parade-control-section">
            <h3>表示</h3>
            <div className="parade-control-row">
              <button type="button" className="icon-button" title="スタートへ" onClick={jumpToStart}>
                <ArrowDownToLine size={16} />
              </button>
              <button type="button" className="icon-button" title="ゴールへ" onClick={jumpToGoal}>
                <ArrowUpToLine size={16} />
              </button>
              <button type="button" className="icon-button" title="縮小" onClick={() => updateZoom(zoom - 0.1)}>
                <ZoomOut size={16} />
              </button>
              <button type="button" className="mini-button" onClick={() => updateZoom(1)}>
                100%
              </button>
              <button type="button" className="icon-button" title="拡大" onClick={() => updateZoom(zoom + 0.1)}>
                <ZoomIn size={16} />
              </button>
              {onCaptureStageImage && (
                <button
                  type="button"
                  className="icon-button"
                  title="ステージを画像保存"
                  aria-label="ステージを画像保存"
                  onClick={onCaptureStageImage}
                >
                  <Camera size={16} />
                </button>
              )}
              <button
                type="button"
                className={`icon-button stage-pinch-lock-button ${isPinchLocked ? "is-locked" : ""}`}
                title={
                  isPinchLocked
                    ? "ピンチ拡大縮小のロックを解除"
                    : "ピンチ拡大縮小をロック"
                }
                aria-label={
                  isPinchLocked
                    ? "ピンチ拡大縮小のロックを解除"
                    : "ピンチ拡大縮小をロック"
                }
                onClick={() => setIsPinchLocked((locked) => !locked)}
              >
                {isPinchLocked ? <Lock size={16} /> : <Unlock size={16} />}
              </button>
            </div>
            <div className="parade-control-row">
              <button type="button" className="mini-button" title="スタート地点を表示" onClick={jumpToStart}>
                スタートへ
              </button>
            </div>
            <button
              type="button"
              className="mini-button"
              title={isFullscreen ? "フルスクリーンを終了" : "フルスクリーン"}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {isFullscreen ? "解除" : "全画面"}
            </button>
          </section>
        </aside>

        <div
          className={[
            "parade-viewport",
            isPinching ? "is-parade-pinching" : "",
            isPinchLocked ? "is-parade-pinch-locked" : "",
          ].join(" ")}
          ref={scrollRef}
          onScroll={handleViewportScroll}
          onPointerDownCapture={handleViewportPointerDownCapture}
          onPointerMoveCapture={handleViewportPointerMoveCapture}
          onPointerUpCapture={handleViewportPointerEndCapture}
          onPointerCancelCapture={handleViewportPointerEndCapture}
        >
          <div
            className="parade-zoom-layout"
            ref={zoomLayoutRef}
            style={{
              height: paradeLayoutHeightPx,
              width: paradeLayoutWidthPx,
            }}
          >
            <div
              className="parade-stage-wrap"
              style={{
                gridTemplateColumns: `${leftRulerVisible ? RULER_WIDTH : 0}px ${canvasWidthPx}px ${rightRulerVisible ? RULER_WIDTH : 0}px`,
                gridTemplateRows: `${horizontalRulerHeight}px ${canvasHeightPx}px`,
              }}
              ref={exportElementRef}
            >
            <div className="parade-ruler-spacer" />
            <div
              className="parade-horizontal-ruler"
              style={{ width: canvasWidthPx, height: horizontalRulerHeight }}
            >
              {settings.horizontalMeasureMode === "centerSplit"
                ? centerSplitLabels.map((item) => (
                    <span
                      key={`horizontal-center-${item.key}`}
                      style={{ left: item.positionMeters * pxPerMeter }}
                    >
                      {item.label}
                    </span>
                  ))
                : horizontalTicks.map((meter) => (
                    <span
                      key={`horizontal-${meter}`}
                      style={{ left: meter * pxPerMeter }}
                    >
                      {formatHorizontalTick(meter)}
                    </span>
                  ))}
            </div>
            <div className="parade-ruler-spacer" />
            {leftRulerVisible && (
              <div
                className="parade-ruler parade-ruler--left"
                style={{ height: canvasHeightPx, gridColumn: 1, gridRow: 2 }}
              >
                {meterTicks.map((meter) => {
                  const top = (settings.totalDistance - meter) * pxPerMeter;
                  return (
                    <span
                      key={`left-${meter}`}
                      className={getParadeMeterRulerClassName(meter)}
                      style={{ top }}
                    >
                      {meter}m
                    </span>
                  );
                })}
              </div>
            )}
            <div
              className="parade-stage"
              ref={stageRef}
              style={{
                gridColumn: 2,
                gridRow: 2,
                width: canvasWidthPx,
                height: canvasHeightPx,
              }}
              onPointerDown={(event) => {
                trackStagePointerPosition(event.clientX, event.clientY);
                if (!isMemberSelectionMode) {
                  onSelect(null);
                }
                startTouchContextMenu(event, { type: "stage" });
              }}
              onPointerMove={(event) => {
                handleStagePointerMove(event);
                trackTouchContextMenuMove(event);
              }}
              onPointerUp={stopTouchContextMenu}
              onPointerCancel={stopTouchContextMenu}
              onContextMenu={(event) => openContextMenu(event, { type: "stage" })}
            >
              <div className="parade-grid-layer" aria-hidden="true">
                {verticalGridTicks.map((meter) => (
                  <span
                    key={`grid-vertical-${meter}`}
                    className="parade-grid-line parade-grid-line--vertical"
                    style={{ left: meter * pxPerMeter }}
                  />
                ))}
                {horizontalGridTicks.map((meter) => {
                  const top = (settings.totalDistance - meter) * pxPerMeter;
                  const isMajor =
                    settings.emphasizeEvery10m && isMeterMultiple(meter, 10);
                  const isMedium =
                    !isMajor &&
                    settings.emphasizeEvery5m &&
                    isMeterMultiple(meter, 5);
                  return (
                    <span
                      key={`grid-horizontal-${meter}`}
                      className={[
                        "parade-grid-line",
                        "parade-grid-line--horizontal",
                        isMajor ? "is-major" : "",
                        isMedium ? "is-medium" : "",
                      ].join(" ")}
                      style={{ top }}
                    />
                  );
                })}
              </div>
              <div
                className="parade-center-line"
                style={{ left: canvasWidthPx / 2 }}
              />
              {visibleObjects.map(({ object, state }) => {
                const left = state.x * pxPerMeter;
                const top = state.y * pxPerMeter;
                const width = state.widthMeters * pxPerMeter;
                const height = state.heightMeters * pxPerMeter;
                const isSelected = selected?.type === "object" && selected.id === object.id;
                const remoteObjectLockOwner = remoteObjectLocks[object.id] ?? null;
                const objectStyle: ParadeObjectStyle = {
                  left: `calc(${left}px + var(--object-drag-x, 0px))`,
                  top: `calc(${top}px + var(--object-drag-y, 0px))`,
                  width: `calc(${width}px + var(--object-drag-width, 0px))`,
                  height: `calc(${height}px + var(--object-drag-height, 0px))`,
                  borderColor: object.color,
                  background: getObjectFill(object),
                  transform: `rotate(calc(${state.rotation}deg + var(--object-drag-rotation, 0deg)))`,
                  zIndex: state.zIndex,
                };
                return (
                  <button
                    key={object.id}
                    ref={(element) => setObjectElementRef(object.id, element)}
                    type="button"
                    className={`parade-object ${isSelected ? "is-selected" : ""} ${
                      remoteObjectLockOwner ? "is-remote-locked" : ""
                    }`}
                    style={objectStyle}
                    onPointerDown={(event) => startObjectDrag(object.id, state, event)}
                    onContextMenu={(event) =>
                      openContextMenu(event, { type: "object", id: object.id })
                    }
                    title={
                      remoteObjectLockOwner
                        ? `${remoteObjectLockOwner}が操作中です`
                        : object.name
                    }
                  >
                    <span className="parade-object__label">{object.name}</span>
                    {isSelected && !object.locked && !isReadOnly && !remoteObjectLockOwner && (
                      <>
                        <span className="object-anchor-point" aria-hidden="true" />
                        <span
                          aria-label="サイズ変更"
                          className="resize-handle parade-object__resize-handle"
                          onPointerDown={(event) =>
                            startObjectResize(object.id, state, event)
                          }
                          role="button"
                          tabIndex={-1}
                          title="サイズ変更"
                        />
                        <span
                          aria-label="回転"
                          className="rotate-handle parade-object__rotate-handle"
                          onPointerDown={(event) =>
                            startObjectRotate(object.id, state, event)
                          }
                          role="button"
                          tabIndex={-1}
                          title="回転"
                        />
                      </>
                    )}
                  </button>
                );
              })}
              {visibleMembers.map((member) => {
                const position =
                  snapshot.positions[member.id] ?? {
                    x: settings.width / 2,
                    y: settings.totalDistance,
                  };
                const diameter =
                  (project.stage.memberDiameterMeters ?? 0.5) * pxPerMeter;
                const color = getMemberDisplayColor(member, {
                  frame: currentFrame,
                  groups: project.memberGroups,
                  snapshot,
                });
                const isSelected =
                  selected?.type === "member" && selected.id === member.id;
                const isMultiSelected = selectedMemberIds.includes(member.id);
                const isFocus = focusMode && focusMemberId === member.id;
                const remoteMemberLockOwner = remoteMemberLocks[member.id] ?? null;
                const labelLines = splitMemberLabel(member.name);
                const memberLabelClassName = getMemberLabelClassName(
                  "parade-member",
                  labelLines,
                );
                const labelColor = getReadableMemberLabelColor(color);
                const overlapOffset =
                  memberDisplayOffsets.get(member.id) ?? { x: 0, y: 0 };
                const memberStyle: ParadeMemberStyle = {
                  "--member-overlap-x": `${overlapOffset.x}px`,
                  "--member-overlap-y": `${overlapOffset.y}px`,
                  left: position.x * pxPerMeter,
                  top: position.y * pxPerMeter,
                  width: diameter,
                  height: diameter,
                  backgroundColor: color,
                  color: labelColor,
                  fontSize: getMemberLabelFontSize(diameter, labelLines),
                  textShadow:
                    labelColor === "#ffffff"
                      ? "0 1px 2px rgba(15, 23, 42, 0.45)"
                      : "0 1px 1px rgba(255, 255, 255, 0.6)",
                  zIndex: member.zIndex,
                };
                return (
                  <button
                    key={member.id}
                    ref={(element) => setMemberElementRef(member.id, element)}
                    type="button"
                    className={`parade-member ${isSelected || isMultiSelected ? "is-selected" : ""} ${isFocus ? "is-focus" : ""} ${
                      memberLabelClassName
                    } ${remoteMemberLockOwner ? "is-remote-locked" : ""} ${
                      simplifyMemberLabels && !isSelected && !isMultiSelected && !isFocus
                        ? "is-label-simplified"
                        : ""
                    }`}
                    style={memberStyle}
                    onPointerDown={(event) => startMemberDrag(member.id, position, event)}
                    onContextMenu={(event) =>
                      openContextMenu(event, { type: "member", id: member.id })
                    }
                    title={
                      remoteMemberLockOwner
                        ? `${remoteMemberLockOwner}が操作中です`
                        : member.name
                    }
                  >
                    {!(simplifyMemberLabels && !isSelected && !isMultiSelected && !isFocus) && (
                      <span className="parade-member__label" aria-hidden="true">
                        {labelLines.map((line, index) => (
                          <span
                            className="parade-member__label-line"
                            key={`${member.id}-label-${index}`}
                          >
                            {line}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {rightRulerVisible && (
              <div
                className="parade-ruler parade-ruler--right"
                style={{ height: canvasHeightPx, gridColumn: 3, gridRow: 2 }}
              >
                {meterTicks.map((meter) => {
                  const top = (settings.totalDistance - meter) * pxPerMeter;
                  return (
                    <span
                      key={`right-${meter}`}
                      className={getParadeMeterRulerClassName(meter)}
                      style={{ top }}
                    >
                      {meter}m
                    </span>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

ParadeCanvas.displayName = "ParadeCanvas";

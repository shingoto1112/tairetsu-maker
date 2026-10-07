import { useAnnotationEditor } from "./useAnnotationEditor";
import { paradeMeterTicks } from "../utils/boundedTicks";
import type { AnnotationLine } from "../types";
import { horizontalEmphasizedLines, verticalEmphasizedLines, gridLineStyle } from "../utils/gridEmphasis";
import { horizontalGridOriginMeters, snapHorizontalPositionInBounds, snapMemberGroupHorizontal } from "../utils/horizontalGrid";
import { createHorizontalRulerLabels, toHorizontalCountingMode } from "../utils/horizontalRuler";
import {
  Camera,
  Lock,
  Maximize2,
  Minimize2,
  Redo2,
  Undo2,
  Unlock,
} from "lucide-react";
import {
  CSSProperties,
  forwardRef,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  internalYToParadeDistance,
  clampParadeObjectTopY,
  getSafeParadeBackwardDistance,
  getSafeParadeCanvasDistance,
  normalizeParadeHorizontalMeasureMode,
  PARADE_MAX_ZOOM,
} from "../utils/parade";
import {
  TOUCH_LONG_PRESS_DELAY_MS,
  hasTouchLongPressMoved,
} from "../utils/touchLongPress";
import { NumericInput } from "./NumericInput";
import { commitPinchView, stickyRulerTranslate, resolvePinchView, stageAnchorMeters, type PinchGeometry } from "../utils/pinchGeometry";
import { useCanvasWheelZoom } from "../hooks/useCanvasWheelZoom";
import { createTouchScroller } from "../utils/touchScroll";
import type { ReactNode } from 'react';
import type { EphemeralSession, EphemeralTarget } from '../collaboration/ephemeralSession';

export type ParadeReflectOptions = {
  target: "all" | "group";
  groupId?: string;
  direction?: "forward" | "backward" | "left" | "right";
  moveMeters: number;
  moveObjects: boolean;
};

type ParadeCanvasProps = {
  ephemeral?: EphemeralSession | null;
  remoteLayer?: ReactNode;
  isPlaying?: boolean;
  onAnnotationLineChange?: (id: string, line: AnnotationLine | null) => void;
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
      pointerId: number;
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
      pointerId: number;
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
      pointerId: number;
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
  geometry: PinchGeometry;
  frameId: string;
  continuousZoom: number;
  finishing: boolean;
  lastAnchor: { clientX: number; clientY: number };
  rulers: { element: HTMLElement; top: number }[];
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
const MAX_ZOOM = PARADE_MAX_ZOOM;
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
  // Keep pinch precision: rounding a long route to 1% shifts distant members
  // when the transformed preview is replaced by committed dimensions.
  clamp(value, MIN_ZOOM, MAX_ZOOM);

const snapMeters = (value: number, gridSize: number) => {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return roundMeters(value);
  }
  return roundMeters(Math.round(value / gridSize) * gridSize);
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
      onAnnotationLineChange,
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
      isPlaying = false,
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
      ephemeral,
      remoteLayer,
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
    const [reflectGroupId, setReflectGroupId] = useState("");
    const activeReflectGroupId = (project.memberGroups ?? []).some(group => group.id === reflectGroupId)
      ? reflectGroupId : "";
    useEffect(() => {
      if (reflectGroupId && !activeReflectGroupId) setReflectGroupId("");
    }, [reflectGroupId, activeReflectGroupId]);
    const reflectTarget: "all" | "group" = activeReflectGroupId ? "group" : "all";
    const [reflectDirection, setReflectDirection] = useState<
      "forward" | "backward" | "left" | "right"
    >("forward");
    const [reflectMoveMeters, setReflectMoveMeters] = useState(5);
    const [reflectMoveObjects, setReflectMoveObjects] = useState(true);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const exportElementRef = useRef<HTMLDivElement | null>(null);
    const zoomLayoutRef = useRef<HTMLDivElement | null>(null);
    const transientZoomRef = useRef<HTMLDivElement | null>(null);
    const committedPinchScrollRef = useRef<{ x: number; y: number } | null>(null);
    const memberElementRefs = useRef(new Map<string, HTMLElement>());
    const objectElementRefs = useRef(new Map<string, HTMLElement>());
    const memberDragClearFrameRef = useRef<number | null>(null);
    const objectDragClearFrameRef = useRef<number | null>(null);
    const zoomRef = useRef(zoom);
    const pinchTouchPointsRef = useRef(new Map<number, PinchTouchPoint>());
    const pinchZoomRef = useRef<PinchZoomState | null>(null);
    const touchScrollerRef = useRef<ReturnType<typeof createTouchScroller> | null>(null);
    const pendingTouchSelectionRef = useRef<{
      pointerId: number; point: PinchTouchPoint; selection: Selection; options?: { append?: boolean };
    } | null>(null);
    const touchContextMenuRef = useRef<TouchContextMenuState | null>(null);
    const zoomFrameRef = useRef<number | null>(null);
    const viewportWidthRef = useRef<number | null>(null);
    const horizontalScrollRangeRef = useRef<number | null>(null);
    const stableHorizontalViewRef = useRef<{
      scrollLeft: number;
      scrollRange: number;
    } | null>(null);
    const isPinchLockedRef = useRef(false);
    const saveViewTimerRef = useRef<number | null>(null);
    const pendingViewRef = useRef<{ id: string; state: SceneViewState } | null>(null);
    const [isPinching, setIsPinching] = useState(false);
    const [isPinchLocked, setIsPinchLocked] = useState(false);
    const backwardDistanceMeters = getSafeParadeBackwardDistance(
      settings.backwardDistanceMeters,
    );
    const canvasDistanceMeters = getSafeParadeCanvasDistance(
      settings.totalDistance,
      backwardDistanceMeters,
    );
    const annotation = useAnnotationEditor({ lines: currentFrame?.annotationLines,
      width: settings.width, depth: canvasDistanceMeters, step: settings.cellSizeMeters, counting: settings.horizontalMeasureMode,
      verticalOrigin: settings.totalDistance,
      context: project.id + ":" + selectedFrameId, disabled: Boolean(isPlaying) || isReadOnly, onChange: onAnnotationLineChange });
    useLayoutEffect(() => {
      if (annotation.active) touchScrollerRef.current?.stop();
    }, [annotation.active]);
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

    const frontDistance = useMemo(() => {
      const finiteY = visibleMembers.map(member => snapshot.positions[member.id]?.y)
        .filter((y): y is number => typeof y === "number" && Number.isFinite(y));
      return finiteY.length ? internalYToParadeDistance(
        finiteY.reduce((min, y) => Math.min(min, y), Infinity),
        settings.totalDistance, settings.backwardDistanceMeters,
      ) : undefined;
    }, [visibleMembers, snapshot.positions, settings.totalDistance, settings.backwardDistanceMeters]);

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
      return paradeMeterTicks(
        -backwardDistanceMeters,
        settings.totalDistance,
      );
    }, [backwardDistanceMeters, settings.totalDistance]);

    const gridStepMeters =
      Number.isFinite(settings.cellSizeMeters) && settings.cellSizeMeters > 0
        ? settings.cellSizeMeters
        : 1;
    const verticalGridTicks = useMemo(() => horizontalEmphasizedLines(settings.width,
      toHorizontalCountingMode(settings.horizontalMeasureMode), gridStepMeters, settings), [settings, gridStepMeters]);
    const horizontalGridTicks = useMemo(() => verticalEmphasizedLines(settings.totalDistance + backwardDistanceMeters,
      gridStepMeters, project.stage, settings), [settings, backwardDistanceMeters, gridStepMeters, project.stage]);

    const horizontalLabels = useMemo(
      () => createHorizontalRulerLabels(settings.width, toHorizontalCountingMode(settings.horizontalMeasureMode)),
      [settings.width, settings.horizontalMeasureMode],
    );

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

    const readViewState = (nextZoom = zoomRef.current): SceneViewState | null => {
      const container = scrollRef.current;
      return container ? { scrollTop: container.scrollTop, scrollLeft: container.scrollLeft,
        zoom: clampZoom(nextZoom), viewportHeight: container.clientHeight, viewportWidth: container.clientWidth } : null;
    };
    const flushPendingViewState = () => {
      if (saveViewTimerRef.current !== null) window.clearTimeout(saveViewTimerRef.current);
      saveViewTimerRef.current = null;
      const pending = pendingViewRef.current; pendingViewRef.current = null;
      if (pending) onFrameViewStateChange(pending.id, pending.state);
    };
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
      pendingViewRef.current = { id: currentFrame.id, state: readViewState(nextZoom)! };
      flushPendingViewState();
    };

    const scheduleSaveViewState = () => {
      if (pinchZoomRef.current) {
        return;
      }
      const state = readViewState();
      if (!currentFrame?.id || !state) return;
      pendingViewRef.current = { id: currentFrame.id, state };
      if (saveViewTimerRef.current !== null) {
        window.clearTimeout(saveViewTimerRef.current);
      }
      saveViewTimerRef.current = window.setTimeout(flushPendingViewState, 300);
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
          x: snapHorizontalPositionInBounds(rawX, settings.cellSizeMeters,
            horizontalGridOriginMeters(settings.width, settings.horizontalMeasureMode), 0, settings.width),
          y: clamp(
            snapMeters(rawY, settings.cellSizeMeters),
            0,
            canvasDistanceMeters,
          ),
        };
      },
      [canvasDistanceMeters, settings.cellSizeMeters, settings.totalDistance, settings.width, settings.horizontalMeasureMode],
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

    useLayoutEffect(() => {
      setZoom(clampZoom(currentFrame?.sceneViewState?.zoom ?? 1));
      // Saved view echoes belong to this canvas. Reapplying an older debounced
      // scroll save during a pinch would resize the committed DOM under its preview.
    }, [currentFrame?.id]);

    useLayoutEffect(() => {
      zoomRef.current = zoom;
      const pinch = pinchZoomRef.current;
      const container = scrollRef.current;
      const layout = zoomLayoutRef.current;
      if (!pinch?.finishing || !container || !layout) return;
      // React has committed dimensions. Read the final untransformed origin,
      // position the anchor and release the preview together before paint.
      clearTransientZoom();
      if (stageRef.current) committedPinchScrollRef.current = commitPinchView(container, stageRef.current, pinch.geometry,
        { x: pinch.lastAnchor.clientX, y: pinch.lastAnchor.clientY });
      pinchZoomRef.current = null;
      saveViewState(zoom);
    }, [zoom, isPinching]);

    const clearTransientZoom = () => {
      pinchZoomRef.current?.rulers.forEach(({ element }) => element.style.removeProperty("transform"));
      const preview = transientZoomRef.current;
      if (preview) {
        preview.style.removeProperty("transform");
        preview.style.removeProperty("transform-origin");
        preview.style.removeProperty("will-change");
      }
    };

    const cancelPendingZoom = () => {
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
    };

    function drawTransientPinch(pinch: PinchZoomState) {
      const preview = transientZoomRef.current;
      if (!preview) return;
      const view = resolvePinchView(pinch.geometry, pinch.continuousZoom, { x: pinch.lastAnchor.clientX, y: pinch.lastAnchor.clientY });
      preview.style.transform = `translate(${view.translate.x}px, ${view.translate.y}px) scale(${view.scale})`;
      const origin = pinch.geometry.viewport.top + pinch.geometry.startOrigin.y - pinch.geometry.startScroll.y;
      const natural = pinch.geometry.viewport.top + view.origin.y - view.scroll.y;
      const edge = pinch.geometry.viewport.top + pinch.geometry.padding.top;
      pinch.rulers.forEach(({ element, top }) => {
        element.style.transform = `translateY(${stickyRulerTranslate(top, natural, edge, origin, view.scale, view.translate.y)}px)`;
      });
    }

    // Cancel/lock commit the preview. Scene changes/unmount restore the last
    // committed view, so a transient zoom can never be saved into another scene.
    function finishPinch(mode: "commit" | "restore", notify = true) {
      cancelPendingZoom();
      cancelTouchContextMenu();
      pinchTouchPointsRef.current.clear();
      pendingTouchSelectionRef.current = null;
      touchScrollerRef.current?.stop();
      const pinch = pinchZoomRef.current;
      if (!pinch) return;
      if (mode === "restore") {
        clearTransientZoom();
        pinchZoomRef.current = null;
        const { startScroll, viewport, startZoom } = pinch.geometry;
        onFrameViewStateChange(pinch.frameId, { zoom: startZoom, scrollLeft: startScroll.x, scrollTop: startScroll.y, viewportWidth: viewport.width, viewportHeight: viewport.height });
        if (notify) setIsPinching(false);
        return;
      }
      if (pinch.finishing) return;
      pinch.finishing = true;
      pinch.continuousZoom = clampZoom(pinch.continuousZoom);
      drawTransientPinch(pinch);
      setZoom(pinch.continuousZoom);
      setIsPinching(false);
    }

    useLayoutEffect(() => {
      setIsPinching(false);
      return () => {
        touchScrollerRef.current?.stop();
        pendingTouchSelectionRef.current = null;
        flushPendingViewState();
        finishPinch("restore", false);
        if (saveViewTimerRef.current !== null) {
          window.clearTimeout(saveViewTimerRef.current);
          saveViewTimerRef.current = null;
        }
      };
    }, [currentFrame?.id]);

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
        pendingTouchSelectionRef.current = null;
        touchScrollerRef.current?.stop();
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

    useLayoutEffect(() => {
      isPinchLockedRef.current = isPinchLocked;
      if (isPinchLocked) {
        finishPinch("commit");
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
        if (pinchZoomRef.current) return;
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
            viewportWidth: container.clientWidth,
            viewportHeight: container.clientHeight,
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
          if (pinchZoomRef.current) return;
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
      if (isPlaying && dragState) {
        clearMemberDragTransforms([...memberElementRefs.current.keys()]);
        [...objectElementRefs.current.keys()].forEach(clearObjectDragPreview);
        if (dragState.hasMoved) onEndProjectEdit();
        ephemeral?.cancel();
        setDragState(null);
      }
    }, [isPlaying]);

    useEffect(() => {
      if (!dragState || isPlaying) {
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
        const measuredAt = ephemeral ? performance.now() : 0;
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
        // Pointer deltas are screen pixels; scrolling is in CSS layout pixels.
        // Convert them separately so the horizontal origin also works under CSS zoom.
        const screenWidth = stageRef.current?.getBoundingClientRect().width ?? canvasWidthPx;
        const dx = (clientX - dragState.startClientX) * settings.width / Math.max(1, screenWidth)
          + (scrollLeft - dragState.startScrollLeft) / pxPerMeter;
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
            if (dragState.type === 'member') ephemeral?.begin(selectedFrameId, dragState.memberIds.map(id => ['member', id, dragState.startPositions[id].x, dragState.startPositions[id].y] as EphemeralTarget));
            else if (dragState.interaction === 'move') ephemeral?.begin(selectedFrameId, [['object', dragState.id, dragState.startState.x, dragState.startState.y, dragState.startState.widthMeters, dragState.startState.heightMeters, dragState.startState.rotation]]);
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
              ephemeral?.finish();
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
            x: snapMemberGroupHorizontal(primaryStartPosition.x + dx, primaryStartPosition.x,
              Object.values(dragState.startPositions), settings.width, settings.cellSizeMeters,
              horizontalGridOriginMeters(settings.width, settings.horizontalMeasureMode)),
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
            ephemeral?.latestMeasured(primaryDelta.x, primaryDelta.y, measuredAt);
            return;
          }
          Object.entries(nextPositions).forEach(([id, position]) => {
            onMoveMember(id, position);
          });
          ephemeral?.latestMeasured(primaryDelta.x, primaryDelta.y, measuredAt);
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
          const nextX = snapHorizontalPositionInBounds(
            dragState.startState.x + dx, OBJECT_DRAG_SNAP_METERS,
            horizontalGridOriginMeters(settings.width, settings.horizontalMeasureMode), 0, maxObjectX,
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
            ephemeral?.latestMeasured(nextX - dragState.startState.x, nextY - dragState.startState.y, measuredAt);
            return;
          }
          onUpdateObjectState(dragState.id, latestObjectPatch);
          ephemeral?.latestMeasured(nextX - dragState.startState.x, nextY - dragState.startState.y, measuredAt);
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
        if (event.pointerId !== dragState.pointerId) return;
        applyDrag(event.clientX, event.clientY);
        autoScroller?.update(event.clientX, event.clientY);
      };
      const handlePointerUp = (event?: globalThis.PointerEvent) => {
        if (event && event.pointerId !== dragState.pointerId) return;
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
          if (event?.type === 'pointercancel') ephemeral?.cancel(); else ephemeral?.finish();
        }
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      return () => {
        isCancelled = true;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        autoScroller?.stop();
      };
    }, [
      dragState,
      isPlaying,
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
      ephemeral,
      settings.totalDistance,
      settings.width,
    ]);

    const applyZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
      options?: {
        persist?: boolean;
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
        if (!nextContainer || pinchZoomRef.current) {
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

    const scheduleZoom = (nextZoom: number, anchor: { clientX: number; clientY: number }) => {
      const pinch = pinchZoomRef.current;
      if (!pinch || pinch.finishing) return;
      // Full precision until commit; gesture frames update refs and transform only.
      pinch.continuousZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      pinch.lastAnchor = anchor;
      if (zoomFrameRef.current !== null) return;
      zoomFrameRef.current = window.requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        const active = pinchZoomRef.current;
        if (active && !active.finishing) drawTransientPinch(active);
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

    useCanvasWheelZoom(scrollRef, isPinchLockedRef, (factor, anchor) => updateZoom(Math.round(zoomRef.current * factor * 100) / 100, anchor));

    useEffect(() => {
      const viewport = scrollRef.current;
      if (!viewport) return;
      // Local non-passive fallback for WKWebView gesture handling. Pointer events
      // remain the only source of positions; never handle movement twice.
      const preventNativeGesture = (event: Event) => { if (event.cancelable) event.preventDefault(); };
      const stopInertia = () => touchScrollerRef.current?.stop();
      viewport.addEventListener("touchmove", preventNativeGesture, { passive: false });
      viewport.addEventListener("gesturestart", preventNativeGesture);
      viewport.addEventListener("gesturechange", preventNativeGesture);
      viewport.addEventListener("gestureend", preventNativeGesture);
      viewport.addEventListener("wheel", stopInertia, { passive: true });
      return () => {
        touchScrollerRef.current?.stop();
        viewport.removeEventListener("touchmove", preventNativeGesture);
        viewport.removeEventListener("gesturestart", preventNativeGesture);
        viewport.removeEventListener("gesturechange", preventNativeGesture);
        viewport.removeEventListener("gestureend", preventNativeGesture);
        viewport.removeEventListener("wheel", stopInertia);
      };
    }, []);

    const handleViewportScroll = () => {
      if (pinchZoomRef.current) return;
      const container = scrollRef.current;
      const committed = committedPinchScrollRef.current;
      if (container && committed && container.scrollLeft === committed.x && container.scrollTop === committed.y) return;
      committedPinchScrollRef.current = null;
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
      if (isPinchLockedRef.current && !annotation.active) {
        return;
      }
      cancelTouchContextMenu();
      flushPendingViewState();
      const touchEntries = Array.from(pinchTouchPointsRef.current.entries());
      if (touchEntries.length < 2) {
        return;
      }
      const [firstEntry, secondEntry] = touchEntries;
      pendingTouchSelectionRef.current = null;
      touchScrollerRef.current?.stop();
      const midpoint = getPinchMidpoint(firstEntry[1], secondEntry[1]);
      const container = scrollRef.current;
      const layout = zoomLayoutRef.current;
      const stage = stageRef.current;
      const preview = transientZoomRef.current;
      if (!container || !layout || !stage || !preview || !currentFrame?.id) return;
      const containerRect = container.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const layoutRect = layout.getBoundingClientRect();
      const css = window.getComputedStyle(container);
      const padding = { left: parseFloat(css.paddingLeft) || 0, right: parseFloat(css.paddingRight) || 0, top: parseFloat(css.paddingTop) || 0, bottom: parseFloat(css.paddingBottom) || 0 };
      const viewport = { left: containerRect.left + container.clientLeft, top: containerRect.top + container.clientTop, width: container.clientWidth, height: container.clientHeight };
      const startZoom = zoomRef.current;
      pinchZoomRef.current = {
        pointerIds: [firstEntry[0], secondEntry[0]],
        startDistance: Math.max(1, getPinchDistance(firstEntry[1], secondEntry[1])),
        startZoom, continuousZoom: startZoom, finishing: false, frameId: currentFrame.id,
        geometry: {
          viewport, padding, startZoom, pixelsPerMeter: BASE_PX_PER_METER,
          fixed: { left: leftRulerVisible ? RULER_WIDTH : 0, right: rightRulerVisible ? RULER_WIDTH : 0, top: horizontalRulerHeight },
          stageMeters: { width: settings.width, height: canvasDistanceMeters },
          startScroll: { x: container.scrollLeft, y: container.scrollTop },
          startOrigin: { x: layoutRect.left - viewport.left + container.scrollLeft, y: layoutRect.top - viewport.top + container.scrollTop },
          anchorMeters: stageAnchorMeters({ x: midpoint.clientX, y: midpoint.clientY }, { x: stageRect.left, y: stageRect.top }, BASE_PX_PER_METER * startZoom),
        },
        lastAnchor: midpoint,
        rulers: [...preview.querySelectorAll<HTMLElement>(".parade-horizontal-ruler, .parade-ruler-spacer")].map(element => ({ element, top: element.getBoundingClientRect().top })),
      };
      preview.style.transformOrigin = "0 0";
      preview.style.willChange = "transform";
      committedPinchScrollRef.current = null;
      if (dragState) {
        const shouldEndEdit = dragState.hasMoved;
        setDragState(null);
        if (shouldEndEdit) {
          onEndProjectEdit();
          ephemeral?.cancel();
        }
      }
      setIsPinching(true);
    };

    const handleViewportPointerDownCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      if (event.pointerType !== "touch") {
        return;
      }
      touchScrollerRef.current?.stop();
      pinchTouchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (pinchTouchPointsRef.current.size >= 2) {
        pendingTouchSelectionRef.current = null;
        cancelTouchContextMenu();
        if (!pinchZoomRef.current) {
          beginPinchIfReady();
        }
        if (isPinchLockedRef.current) setDragState(null);
        event.preventDefault();
        event.stopPropagation();
      } else if (!annotation.active && !(event.target as Element).closest("button, input, select, textarea, [contenteditable='true'], [role='button']") && scrollRef.current) {
        touchScrollerRef.current ??= createTouchScroller(scrollRef.current);
        touchScrollerRef.current.start(event);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
    };

    const handleViewportPointerMoveCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      trackTouchContextMenuMove(event);
      const pending = pendingTouchSelectionRef.current;
      if (!pinchZoomRef.current && pinchTouchPointsRef.current.size === 1 && pending?.pointerId === event.pointerId &&
          Math.hypot(event.clientX - pending.point.clientX, event.clientY - pending.point.clientY) >= 3) {
        // Empty-space panning should not clear the current selection.
        if (pending.selection) flushTouchSelection(); else pendingTouchSelectionRef.current = null;
      }
      if (!annotation.active && event.pointerType === "touch" && !pinchZoomRef.current && touchScrollerRef.current?.move(event)) {
        cancelTouchContextMenu();
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (
        event.pointerType !== "touch" ||
        (isPinchLockedRef.current && !annotation.active) ||
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
        isPinchLockedRef.current ? pinch.startZoom : pinch.startZoom * (distance / pinch.startDistance),
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
      if (event.type === "pointercancel") pendingTouchSelectionRef.current = null;
      else if (!pinchZoomRef.current && pendingTouchSelectionRef.current?.pointerId === event.pointerId) flushTouchSelection();
      touchScrollerRef.current?.end(event, event.type === "pointercancel");
      pinchTouchPointsRef.current.delete(event.pointerId);
      if (event.type === "pointercancel" || pinchTouchPointsRef.current.size < 2 || pinchZoomRef.current?.pointerIds.includes(event.pointerId)) {
        // Ordinary or locked pointer releases never commit or persist a zoom.
        if (!pinchZoomRef.current) return;
        finishPinch("commit");
      }
    };

    const selectPointerTarget = (selection: Selection, options?: { append?: boolean }) => {
      const entry = [...pinchTouchPointsRef.current.entries()][0];
      if (entry && pinchTouchPointsRef.current.size === 1) {
        pendingTouchSelectionRef.current = { pointerId: entry[0], point: { ...entry[1] }, selection, options };
      } else onSelect(selection, options);
    };
    function flushTouchSelection() {
      const pending = pendingTouchSelectionRef.current;
      pendingTouchSelectionRef.current = null;
      if (pending) onSelect(pending.selection, pending.options);
    }

    const startMemberDrag = (
      memberId: string,
      position: Position,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      if (event.button !== 0 || isPlaying) {
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
        selectPointerTarget({ type: "member", id: memberId }, { append: appendSelection });
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
        pointerId: event.pointerId,
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
      if (event.button !== 0 || isPlaying) {
        return;
      }
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectPointerTarget({ type: "object", id: objectId });
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
        pointerId: event.pointerId,
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
      if (event.button !== 0 || isPlaying) {
        return;
      }
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectPointerTarget({ type: "object", id: objectId });
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
        pointerId: event.pointerId,
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
      if (event.button !== 0 || isPlaying) {
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
      selectPointerTarget({ type: "object", id: objectId });
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
        pointerId: event.pointerId,
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
              <span className="parade-front-distance">最前 {frontDistance === undefined ? "—" : frontDistance + "m"}</span>
            </div>
            <div className="parade-history-controls" aria-label="パレードの操作">
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
              {onCaptureStageImage && (
                <button
                  type="button"
                  className="mini-button icon-only"
                  title="ステージを画像保存"
                  aria-label="ステージを画像保存"
                  onClick={onCaptureStageImage}
                >
                  <Camera size={16} />
                </button>
              )}
              <button
                type="button"
                className={`mini-button icon-only stage-pinch-lock-button ${isPinchLocked ? "is-locked" : ""}`}
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
              <button
                type="button" className="mini-button icon-only"
                title="パレードフルスクリーン"
                aria-label={isFullscreen ? "全画面を終了" : "全画面"}
                onClick={onToggleFullscreen}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
          {isReadOnly && (
            <p className="stage-readonly-pill parade-readonly-pill" title={readOnlyMessage}>
              閲覧中
            </p>
          )}
          {annotation.toolbar}
          <section className="parade-control-section">
            <h3>前シーン反映</h3>
            <button
              className="mini-button"
              type="button"
              disabled={isReadOnly}
              onClick={() =>
                onReflectPreviousFrame({
                  target: reflectTarget,
                  groupId: activeReflectGroupId || undefined,
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
                value={activeReflectGroupId}
                onChange={(event) => setReflectGroupId(event.target.value)}
              >
                <option value="">全員</option>
                {(project.memberGroups ?? []).map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
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
                  groupId: activeReflectGroupId || undefined,
                  direction: reflectDirection,
                  moveMeters: reflectMoveMeters,
                  moveObjects: reflectMoveObjects,
                })
              }
            >
              反映して移動
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
            <div className="parade-pinch-preview" ref={transientZoomRef}>
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
              {horizontalLabels.map((item) => (
                <span key={item.key} style={{ left: item.positionMeters * pxPerMeter }}>{item.label}</span>
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
              className={`parade-stage ${annotation.active ? "is-annotation-editing" : ""}`}
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
                  selectPointerTarget(null);
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
              {annotation.inkLayer}
              {annotation.interactionLayer}
              {remoteLayer}
              <div className="parade-grid-layer" aria-hidden="true">
                {verticalGridTicks.map((meter) => (
                  <span
                    key={`grid-vertical-${meter.positionMeters}`}
                    className={`parade-grid-line parade-grid-line--vertical ${meter.kind === "counting" ? "is-counting" : ""}`}
                    data-emphasis={meter.emphasis}
                    data-position={meter.positionMeters}
                    style={{ ...gridLineStyle(meter.emphasis, true), left: meter.positionMeters * pxPerMeter }}
                  />
                ))}
                {horizontalGridTicks.map(line => <span key={"grid-horizontal-" + line.positionMeters}
                  className={"parade-grid-line parade-grid-line--horizontal " + (line.emphasis === "10" ? "is-major" : line.emphasis === "5" ? "is-medium" : "")}
                  data-emphasis={line.emphasis} data-position={line.positionMeters}
                  style={{ ...gridLineStyle(line.emphasis, false), top: line.positionMeters * pxPerMeter }} />)}
              </div>
              <div
                className="parade-center-line"
                style={{ left: canvasWidthPx / 2 }}
              />
              <div className="canvas-elements-layer">
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
                    } ${remoteMemberLockOwner ? "is-remote-locked" : ""}`}
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
                  </button>
                );
              })}
              </div>
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
      </div>
    );
  },
);

ParadeCanvas.displayName = "ParadeCanvas";

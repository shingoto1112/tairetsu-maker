import { useCanvasEditScope, type CanvasEditOperation } from "../hooks/useCanvasEditScope";
import { useAnnotationEditor } from "./useAnnotationEditor";
import type { AnnotationLine } from "../types";
import { horizontalEmphasizedLines, verticalEmphasizedLines, gridLineStyle, stageVerticalRulerPositions } from "../utils/gridEmphasis";
import { horizontalGridOriginMeters, snapMemberGroupHorizontal } from "../utils/horizontalGrid";
import { memberGroupAxisBounds, snapMemberGroupAxis, snapPositionInBounds } from "../utils/positionGrid";
import { stageVerticalGridOriginMeters } from "../utils/verticalGrid";
import { createHorizontalRulerLabels } from "../utils/horizontalRuler";
import { stageRulerPosition } from "../utils/rulerPosition";
import {
  Camera,
  ArrowUpDown,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Save,
  Redo2,
  Undo2,
  Unlock,
} from "lucide-react";
import {
  CSSProperties,
  forwardRef,
  memo,
  useCallback,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditingMode,
  FrontDirection,
  MovementPathMode,
  ObjectState,
  OriginMode,
  Position,
  Project,
  SceneElementEditTarget,
  SceneViewState,
  Selection,
  StageContextMenuRequest,
  StageSnapshot,
  ViewerPerspective,
} from "../types";
import {
  clientPointToMeters,
  constrainMemberPosition,
  constrainObjectPosition,
  roundMeters,
  stagePointToDisplayPoint,
} from "../utils/coordinates";
import {
  createEdgeAutoScroller,
  type EdgeAutoScroller,
} from "../utils/edgeAutoScroll";
import {
  getMovementPathType,
  getSnapshotForFrame,
  isAnimationEnabledForTarget,
  resolveMovementPlan,
  sortFrames,
} from "../utils/interpolation";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../utils/memberAppearance";
import {
  getMemberLabelClassName,
  getMemberLabelFontSize,
  splitMemberLabel,
} from "../utils/memberLabel";
import { formatTime } from "../utils/time";
import { commitPinchView, resolvePinchView, stageAnchorMeters, type PinchGeometry } from "../utils/pinchGeometry";
import {
  TOUCH_LONG_PRESS_DELAY_MS,
  hasTouchLongPressMoved,
} from "../utils/touchLongPress";
import { ResizableRotatableObject } from "./ResizableRotatableObject";
import { StageTimeBar } from "./StageTimeBar";
import { CompactStageControls } from "./CompactStageControls";
import { useCanvasWheelZoom } from "../hooks/useCanvasWheelZoom";
import type { ReactNode } from 'react';
import type { EphemeralSession, EphemeralTarget } from '../collaboration/ephemeralSession';

type StageCanvasProps = {
  ephemeral?: EphemeralSession | null;
  remoteLayer?: ReactNode;
  viewStates?: Map<string, SceneViewState>;
  compact?: boolean;
  onAnnotationLineChange?: (id: string, line: AnnotationLine | null) => void;
  project: Project;
  snapshot: StageSnapshot;
  selected: Selection;
  selectedFrameLabel: string;
  selectedFrameTime: number;
  mode: EditingMode;
  isPlaying: boolean;
  isFullscreen: boolean;
  selectedFrameId: string | null;
  viewerPerspective: ViewerPerspective;
  showMovementPaths: boolean;
  showMeterRulers: boolean;
  movementPathMode: MovementPathMode;
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
  currentTime: number;
  audioDuration: number;
  audioName: string | null;
  onSelect: (
    selection: Selection,
    options?: { append?: boolean },
  ) => void;
  onStagePointerPositionChange: (position: Position) => void;
  onMoveMember: (id: string, position: Position) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBeginProjectEdit: (
    label?: string,
    target?: SceneElementEditTarget | SceneElementEditTarget[],
  ) => boolean | void | Promise<boolean | void>;
  onEndProjectEdit: (
    target?: SceneElementEditTarget | SceneElementEditTarget[],
  ) => void;
  onTogglePlayback: () => void;
  onSaveFrame: () => void;
  onCaptureStageImage: () => void;
  onTogglePerspective: () => void;
  onToggleFullscreen: () => void;
  onSeekAudio: (timeSec: number) => void;
  onContextMenuRequest: (request: StageContextMenuRequest) => void;
  onReadOnlyEditAttempt?: () => void;
  onLockedElementEditAttempt?: (ownerName: string) => void;
};

export type StageCanvasHandle = HTMLDivElement & {
  scrollTargetIntoView: (bounds: StageScrollBounds) => void;
};

export type StageScrollBounds = {
  minimumScroll?: boolean;
  heightMeters: number;
  widthMeters: number;
  x: number;
  y: number;
};

type MemberDrag = {
  operation: CanvasEditOperation;
  pointerId: number;
  memberId: string;
  memberIds: string[];
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  startPointer: Position;
  startPosition: Position;
  startPositions: Record<string, Position>;
  latestPositions: Record<string, Position> | null;
  hasMoved: boolean;
  isBeginPending: boolean;
  endRequested: boolean;
};

type StageTouchPoint = {
  clientX: number;
  clientY: number;
};

type StagePinchZoom = {
  pointerIds: [number, number];
  startDistance: number;
  startZoom: number;
  geometry: PinchGeometry;
  continuousZoom: number;
  finishing: boolean;
  lastAnchor: { clientX: number; clientY: number };
};

type StagePanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  hasMoved: boolean;
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

type SnapGuide = {
  axis: "x" | "y";
  value: number;
};

type MemberDisplayOffset = {
  x: number;
  y: number;
};

type MemberTokenStyle = CSSProperties & {
  "--member-drag-x"?: string;
  "--member-drag-y"?: string;
  "--member-overlap-x": string;
  "--member-overlap-y": string;
};

// The label subtree is unchanged while positions move. Reuse its DOM and text.
const StageMemberLabel = memo(({ name }: { name: string }) => <span className="member-token__label" aria-hidden="true">
  {splitMemberLabel(name).map((line, index) => <span className="member-token__label-line" key={index}>{line}</span>)}
</span>);

type StageMemberTokenProps = {
  memberId: string; name: string; showLabel: boolean;
  className: string; style: MemberTokenStyle; title: string;
  handlers: {
    ref: (id: string, node: HTMLDivElement | null) => void;
    down: (event: PointerEvent<HTMLDivElement>, id: string) => void;
    move: (event: PointerEvent<HTMLDivElement>) => void;
    stop: (event: PointerEvent<HTMLDivElement>) => void;
    menu: (event: ReactMouseEvent<HTMLDivElement>, id: string) => void;
  };
};
// Unchanged members skip DOM reconciliation during drag/pan. Stable handlers
// dispatch to the latest committed state; compare every visual value.
const StageMemberToken = memo((props: StageMemberTokenProps) => {
  const { memberId, name, showLabel, handlers, className, style, title } = props;
  const setRef = useCallback((node: HTMLDivElement | null) => handlers.ref(memberId, node), [handlers, memberId]);
  return <div ref={setRef} className={className} style={style} title={title}
    role="button" tabIndex={0} aria-label={name}
    onPointerDown={event => handlers.down(event, memberId)} onPointerMove={handlers.move}
    onPointerUp={handlers.stop} onPointerCancel={handlers.stop}
    onContextMenu={event => handlers.menu(event, memberId)}>
    {showLabel && <StageMemberLabel name={name} />}
  </div>;
}, (a, b) => a.memberId === b.memberId && a.name === b.name && a.showLabel === b.showLabel &&
  a.className === b.className && a.title === b.title && a.handlers === b.handlers &&
  Object.keys(a.style).length === Object.keys(b.style).length &&
  (Object.keys(a.style) as (keyof MemberTokenStyle)[]).every(key => a.style[key] === b.style[key]));

const RULER_LABEL_WIDTH_PX = 30;
const RULER_LABEL_HEIGHT_PX = 20;
const RULER_BOTTOM_PADDING_PX = 18;
const MEMBER_OVERLAP_KEY_SCALE = 100;
const STAGE_ZOOM_MIN = 1;
const STAGE_ZOOM_MAX = 4;

const formatMeter = (value: number): string => {
  const rounded = Math.abs(value) < 0.001 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}m`;
};

const formatDepthMeter = (value: number): string => {
  const rounded = Math.abs(value) < 0.001 ? 0 : value;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}m`;
};

const createMovementPathD = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  pathType: string,
  control?: { x: number; y: number } | null,
): string | null => {
  if (pathType === "hold") {
    return null;
  }
  if (pathType === "curve" && control) {
    return `M ${startX} ${startY} Q ${control.x} ${control.y} ${endX} ${endY}`;
  }
  if (pathType === "orthogonal-hv") {
    return `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`;
  }
  if (pathType === "orthogonal-vh") {
    return `M ${startX} ${startY} L ${startX} ${endY} L ${endX} ${endY}`;
  }
  return `M ${startX} ${startY} L ${endX} ${endY}`;
};

const coordinateLabel = (
  axis: "x" | "y",
  displayedValue: number,
  stageWidth: number,
  stageDepth: number,
  originMode: OriginMode,
  frontDirection: FrontDirection,
  viewerPerspective: ViewerPerspective,
): string => {
  const stageValue =
    viewerPerspective === "performer"
      ? axis === "x"
        ? stageWidth - displayedValue
        : stageDepth - displayedValue
      : displayedValue;

  if (axis === "x") {
    const xMeters = stageValue - stageWidth / 2;
    return formatMeter(xMeters);
  }

  if (frontDirection === "top") {
    return formatDepthMeter(stageValue);
  }
  if (frontDirection === "bottom") {
    return formatDepthMeter(stageDepth - stageValue);
  }
  return formatDepthMeter(stageDepth - stageValue);
};

const isSnapshotMemberVisible = (
  snapshot: StageSnapshot,
  memberId: string,
): boolean => snapshot.memberVisibility[memberId] ?? true;

export const StageCanvas = forwardRef<HTMLDivElement, StageCanvasProps>(
  (
    {
      compact = false,
      viewStates,
      onAnnotationLineChange,
      project,
      snapshot,
      selected,
      selectedFrameLabel,
      selectedFrameTime,
      mode,
      isPlaying,
      isFullscreen,
      selectedFrameId,
      viewerPerspective,
      showMovementPaths,
      showMeterRulers,
      movementPathMode,
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
      currentTime,
      audioDuration,
      audioName,
      onSelect,
      onStagePointerPositionChange,
      onMoveMember,
      onUpdateObjectState,
      canUndo,
      canRedo,
      onUndo,
      onRedo,
      onBeginProjectEdit,
      onEndProjectEdit,
      onTogglePlayback,
      onSaveFrame,
      onCaptureStageImage,
      onTogglePerspective,
      onToggleFullscreen,
      onSeekAudio,
      onContextMenuRequest,
      onReadOnlyEditAttempt,
      onLockedElementEditAttempt,
      ephemeral,
      remoteLayer,
    },
    exportRef,
  ) => {
    const localViewsRef = useRef({ projectId: project.id, views: new Map<string, SceneViewState>() });
    if (localViewsRef.current.projectId !== project.id) localViewsRef.current = { projectId: project.id, views: new Map() };
    const sceneViews = viewStates ?? localViewsRef.current.views;
    const pendingRestoreRef = useRef<SceneViewState | null>(null);
    const transientZoomRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const fitAreaRef = useRef<HTMLDivElement | null>(null);
    const exportElementRef = useRef<HTMLDivElement | null>(null);
    const editScope = useCanvasEditScope(project.id, selectedFrameId, isPlaying || isReadOnly, onBeginProjectEdit, onEndProjectEdit);
    const memberDragRef = useRef<MemberDrag | null>(null);
    const memberElementRefs = useRef(new Map<string, HTMLElement>());
    const memberDragClearFrameRef = useRef<number | null>(null);
    const memberAutoScrollerRef = useRef<EdgeAutoScroller | null>(null);
    const stageTouchPointsRef = useRef(new Map<number, StageTouchPoint>());
    const pendingTouchSelectionRef = useRef<{
      pointerId: number; point: StageTouchPoint; selection: Selection; options?: { append?: boolean };
    } | null>(null);
    const stagePinchZoomRef = useRef<StagePinchZoom | null>(null);
    const stagePanRef = useRef<StagePanState | null>(null);
    const touchContextMenuRef = useRef<TouchContextMenuState | null>(null);
    const stageZoomFrameRef = useRef<number | null>(null);
    const initialZoom = STAGE_ZOOM_MIN;
    const stageZoomRef = useRef(initialZoom);
    const portraitFitAppliedRef = useRef(compact);
    const stageHorizontalViewInitializedRef = useRef(false);
    const viewReadyRef = useRef(false);
    const isStagePinchLockedRef = useRef(false);
    const [fitAreaSize, setFitAreaSize] = useState({ width: 0, height: 0 });
    const [isStageInteracting, setIsStageInteracting] = useState(false);
    const [isStagePinching, setIsStagePinching] = useState(false);
    const [isStagePanning, setIsStagePanning] = useState(false);
    const [isMemberDragging, setIsMemberDragging] = useState(false);
    const [activeSnapGuides, setActiveSnapGuides] = useState<SnapGuide[]>([]);
    const [stageZoom, setStageZoom] = useState(initialZoom);
    const [isStagePinchLocked, setIsStagePinchLocked] = useState(false);
    const stableFitAreaSizeRef = useRef(fitAreaSize);
    const stage = project.stage;
    const memberGroups = project.memberGroups ?? [];
    const guideSettings = {
      snapGuideEnabled: project.guideSettings?.snapGuideEnabled ?? true,
      snapToGuideEnabled: project.guideSettings?.snapToGuideEnabled ?? false,
    };
    const frontDirection =
      stage.frontDirection ?? stage.audienceSide ?? "bottom";
    const originMode = stage.originMode ?? "center";
    const memberDiameterMeters = Math.min(
      1,
      Math.max(0.2, stage.memberDiameterMeters ?? 0.5),
    );
    const memberSizeStyle = {
      width: `${(memberDiameterMeters / stage.widthMeters) * 100}%`,
      height: `${(memberDiameterMeters / stage.depthMeters) * 100}%`,
    };
    const memberEditing = !isPlaying;
    const objectEditing = mode === "objects" && !isPlaying;
    // Names stay visible while dragging/panning regardless of member count (user decision 2026-10-06).
    const memberLabels = useMemo(() => new Map(project.members.map(member => {
      const lines = splitMemberLabel(member.name);
      return [member.id, { lines, className: getMemberLabelClassName("member-token", lines) }] as const;
    })), [project.members]);
    const memberColors = useMemo(() => new Map(project.members.map(member => {
      const color = snapshot.memberAppearanceOverrides?.[member.id]?.color
        ?? getMemberDisplayColor(member, { groups: memberGroups });
      return [member.id, { color, labelColor: getReadableMemberLabelColor(color) }] as const;
    })), [project.members, memberGroups, snapshot.memberAppearanceOverrides]);
    const horizontalGuideMode = stage.horizontalGuideMode ?? "meters";
    const horizontalLabels = useMemo(
      () => createHorizontalRulerLabels(stage.widthMeters, horizontalGuideMode),
      [stage.widthMeters, horizontalGuideMode],
    );
    const verticalTicks = useMemo(
      () => stageVerticalRulerPositions(stage.depthMeters, stageVerticalGridOriginMeters(stage.depthMeters, stage) === 0)
        .map(y => viewerPerspective === "performer" ? stage.depthMeters - y : y).sort((a,b) => a-b),
      [stage.depthMeters, frontDirection, viewerPerspective],
    );

    useImperativeHandle(exportRef, () => {
      const exportElement = exportElementRef.current;
      if (!exportElement) {
        return null as unknown as StageCanvasHandle;
      }
      return Object.assign(exportElement, {
        scrollTargetIntoView: (bounds: StageScrollBounds) => {
          const container = fitAreaRef.current;
          const stageElement = stageRef.current;
          if (!container || !stageElement) {
            return;
          }
          const containerRect = container.getBoundingClientRect();
          const stageRect = stageElement.getBoundingClientRect();
          const marginPx = bounds.minimumScroll ? 0 : 72;
          const left =
            stageRect.left + (bounds.x / stage.widthMeters) * stageRect.width;
          const right =
            stageRect.left +
            ((bounds.x + bounds.widthMeters) / stage.widthMeters) *
              stageRect.width;
          const top =
            stageRect.top + (bounds.y / stage.depthMeters) * stageRect.height;
          const bottom =
            stageRect.top +
            ((bounds.y + bounds.heightMeters) / stage.depthMeters) *
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
        },
      }) as StageCanvasHandle;
    }, [exportRef, stage.depthMeters, stage.widthMeters]);

    useEffect(() => {
      const element = fitAreaRef.current;
      if (!element) {
        return undefined;
      }

      const setMeasuredSize = (width: number, height: number) => {
        setFitAreaSize((previous) =>
          Math.abs(previous.width - width) < 2 &&
          Math.abs(previous.height - height) < 2
            ? previous
            : { width, height },
        );
      };

      const rect = element.getBoundingClientRect();
      let resizeFrame = 0;
      let previousWidth = rect.width;
      const scheduleMeasuredSize = (width: number, height: number) => {
        if (resizeFrame) {
          window.cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          if (stagePinchZoomRef.current) return;
          if (
            element.classList.contains("is-stage-zoomed") &&
            Math.abs(previousWidth - width) >= 1
          ) {
            const centeredScrollLeft =
              element.scrollLeft + (previousWidth - width) / 2;
            element.scrollLeft = Math.min(
              Math.max(0, centeredScrollLeft),
              Math.max(0, element.scrollWidth - element.clientWidth),
            );
          }
          previousWidth = width;
          setMeasuredSize(width, height);
        });
      };

      setMeasuredSize(rect.width, rect.height);

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        // 外側の表示領域だけを基準にし、選択枠やハンドルの微小な揺れは倍率へ反映しない。
        // Zoom adds viewport padding; keep the fit basis independent of that padding.
        scheduleMeasuredSize(element.clientWidth || entry.contentRect.width, element.clientHeight || entry.contentRect.height);
      });
      observer.observe(element);

      return () => {
        if (resizeFrame) {
          window.cancelAnimationFrame(resizeFrame);
        }
        observer.disconnect();
      };
    }, []);

    useEffect(() => {
      if (!isStageInteracting) {
        stableFitAreaSizeRef.current = fitAreaSize;
      }
    }, [fitAreaSize, isStageInteracting]);

    useEffect(() => {
      stageZoomRef.current = stageZoom;
    }, [stageZoom]);

    const cancelPendingStageZoom = () => {
      if (stageZoomFrameRef.current !== null) {
        window.cancelAnimationFrame(stageZoomFrameRef.current);
        stageZoomFrameRef.current = null;
      }
    };

    const clearStagePinch = () => {
      stageTouchPointsRef.current.clear();
      finishStagePinch("commit");
    };

    const clearStagePan = () => {
      stagePanRef.current = null;
      setIsStagePanning(false);
    };

    const selectPointerTarget = (selection: Selection, options?: { append?: boolean }) => {
      const touches = [...stageTouchPointsRef.current];
      if (touches.length === 1) {
        const [pointerId, point] = touches[0];
        pendingTouchSelectionRef.current = { pointerId, point, selection, options };
      } else if (!stagePinchZoomRef.current) onSelect(selection, options);
    };
    const flushTouchSelection = () => {
      const pending = pendingTouchSelectionRef.current;
      pendingTouchSelectionRef.current = null;
      if (pending) onSelect(pending.selection, pending.options);
    };

    const cancelTouchContextMenu = () => {
      const pending = touchContextMenuRef.current;
      if (pending) {
        window.clearTimeout(pending.timerId);
        touchContextMenuRef.current = null;
      }
    };

    const setMemberElementRef = (memberId: string, element: HTMLElement | null) => {
      if (element) {
        memberElementRefs.current.set(memberId, element);
        return;
      }
      memberElementRefs.current.delete(memberId);
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

    useEffect(() => {
      isStagePinchLockedRef.current = isStagePinchLocked;
      if (isStagePinchLocked) {
        cancelPendingStageZoom();
        clearStagePinch();
      }
    }, [isStagePinchLocked]);

    useEffect(
      () => () => {
        cancelPendingStageZoom();
        cancelTouchContextMenu();
        cancelPendingMemberDragClear();
        clearMemberDragTransforms([...memberElementRefs.current.keys()]);
        memberAutoScrollerRef.current?.stop();
      },
      [],
    );

    useEffect(() => {
      if (!isStageInteracting) {
        return undefined;
      }
      const releaseFitLock = (event: Event) => {
        const pinch = stagePinchZoomRef.current;
        if (pinch && "pointerId" in event && !pinch.pointerIds.includes((event as globalThis.PointerEvent).pointerId)) return;
        cancelTouchContextMenu();
        clearStagePinch();
        clearStagePan();
        setIsStageInteracting(false);
      };
      window.addEventListener("pointerup", releaseFitLock);
      window.addEventListener("pointercancel", releaseFitLock);
      window.addEventListener("blur", releaseFitLock);
      return () => {
        window.removeEventListener("pointerup", releaseFitLock);
        window.removeEventListener("pointercancel", releaseFitLock);
        window.removeEventListener("blur", releaseFitLock);
      };
    }, [isStageInteracting]);

    const fitWidth = isStageInteracting
      ? stableFitAreaSizeRef.current.width
      : fitAreaSize.width;
    const fitHeight = isStageInteracting
      ? stableFitAreaSizeRef.current.height
      : fitAreaSize.height;

    const fittedStageSize = useMemo(() => {
      const rulerBottomPadding = showMeterRulers ? RULER_BOTTOM_PADDING_PX : 0;
      const rulerLabelWidth = showMeterRulers ? RULER_LABEL_WIDTH_PX : 0;
      const rulerLabelHeight = showMeterRulers ? RULER_LABEL_HEIGHT_PX : 0;
      const rulerSideCount = showMeterRulers ? 2 : 0;
      const memberBleedMeters = showMeterRulers ? memberDiameterMeters / 2 : 0;
      const availableWidth = Math.max(0, fitWidth - rulerLabelWidth * rulerSideCount);
      const availableHeight = Math.max(
        0,
        fitHeight - rulerLabelHeight - rulerBottomPadding,
      );
      const safeWidthMeters = Math.max(1, stage.widthMeters);
      const safeDepthMeters = Math.max(1, stage.depthMeters);
      const measured = availableWidth > 0 && availableHeight > 0;

      // The rendered meter scale is derived from both axes, so tall or wide scenes
      // fit without changing the saved meter coordinates.
      const pxPerMeter = measured
        ? Math.max(
            1,
            Math.min(
              availableWidth /
                (safeWidthMeters + memberBleedMeters * rulerSideCount),
              availableHeight / (safeDepthMeters + memberBleedMeters),
            ),
          )
        : 48;
      const memberBleedPx = memberBleedMeters * pxPerMeter;

      return {
        heightPx: safeDepthMeters * pxPerMeter,
        memberBleedPx,
        pxPerMeter,
        rulerBottomPadding,
        rulerHeight: showMeterRulers ? rulerLabelHeight + memberBleedPx : 0,
        rulerLabelOffset: memberBleedPx + 7,
        rulerWidth: showMeterRulers ? rulerLabelWidth + memberBleedPx : 0,
        widthPx: safeWidthMeters * pxPerMeter,
      };
    }, [
      fitHeight,
      fitWidth,
      memberDiameterMeters,
      showMeterRulers,
      stage.depthMeters,
      stage.widthMeters,
    ]);

    const visibleStageSize = useMemo(() => {
      const safeWidthMeters = Math.max(1, stage.widthMeters);
      const safeDepthMeters = Math.max(1, stage.depthMeters);
      const pxPerMeter = fittedStageSize.pxPerMeter * stageZoom;
      const memberBleedMeters = showMeterRulers ? memberDiameterMeters / 2 : 0;
      const memberBleedPx = memberBleedMeters * pxPerMeter;

      return {
        heightPx: safeDepthMeters * pxPerMeter,
        memberBleedPx,
        pxPerMeter,
        rulerBottomPadding: fittedStageSize.rulerBottomPadding,
        rulerHeight: showMeterRulers ? RULER_LABEL_HEIGHT_PX + memberBleedPx : 0,
        rulerLabelOffset: memberBleedPx + 7,
        rulerWidth: showMeterRulers ? RULER_LABEL_WIDTH_PX + memberBleedPx : 0,
        widthPx: safeWidthMeters * pxPerMeter,
      };
    }, [
      fittedStageSize.pxPerMeter,
      fittedStageSize.rulerBottomPadding,
      memberDiameterMeters,
      showMeterRulers,
      stage.depthMeters,
      stage.widthMeters,
      stageZoom,
    ]);

    const isStageZoomed = stageZoom > STAGE_ZOOM_MIN + 0.001;

    useEffect(() => {
      const container = fitAreaRef.current;
      if (!container || fitAreaSize.width <= 0) return undefined;
      if (stagePinchZoomRef.current || pendingRestoreRef.current) return undefined;
      if (!isStageZoomed) {
        stageHorizontalViewInitializedRef.current = false;
        viewReadyRef.current = true;
        return undefined;
      }
      if (stageHorizontalViewInitializedRef.current || stagePinchZoomRef.current || pendingRestoreRef.current) return undefined;

      let correctionFrame = 0;
      const frame = window.requestAnimationFrame(() => {
        const nextContainer = fitAreaRef.current;
        if (!nextContainer || stagePinchZoomRef.current || pendingRestoreRef.current) return;
        nextContainer.scrollLeft = Math.max(
          0,
          (nextContainer.scrollWidth - nextContainer.clientWidth) / 2,
        );
        correctionFrame = window.requestAnimationFrame(() => {
          const settledContainer = fitAreaRef.current;
          const canvas = exportElementRef.current;
          if (!settledContainer || !canvas || stagePinchZoomRef.current || pendingRestoreRef.current) return;
          const containerRect = settledContainer.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          settledContainer.scrollLeft +=
            canvasRect.left + canvasRect.width / 2 -
            (containerRect.left + containerRect.width / 2);
          stageHorizontalViewInitializedRef.current = true;
          viewReadyRef.current = true;
        });
      });
      return () => {
        window.cancelAnimationFrame(frame);
        window.cancelAnimationFrame(correctionFrame);
      };
    }, [fitAreaSize.width, isStageZoomed, visibleStageSize.widthPx]);

    const clampStageZoom = (nextZoom: number) =>
      Math.round(
        Math.min(STAGE_ZOOM_MAX, Math.max(STAGE_ZOOM_MIN, nextZoom)) * 100,
      ) / 100;

    const applyStageZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      const clampedZoom = clampStageZoom(nextZoom);
      stageZoomRef.current = clampedZoom;
      stageHorizontalViewInitializedRef.current = true;
      const container = fitAreaRef.current;
      if (!container) {
        setStageZoom(clampedZoom);
        return;
      }

      const rect = container.getBoundingClientRect();
      const anchorX = anchor
        ? anchor.clientX - rect.left
        : container.clientWidth / 2;
      const anchorY = anchor
        ? anchor.clientY - rect.top
        : container.clientHeight / 2;
      const stageRect = stageRef.current?.getBoundingClientRect();
      const anchorStageRatio =
        anchor && stageRect
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
      const scrollWidth = Math.max(1, container.scrollWidth);
      const scrollHeight = Math.max(1, container.scrollHeight);
      const ratioX = (container.scrollLeft + anchorX) / scrollWidth;
      const ratioY = (container.scrollTop + anchorY) / scrollHeight;

      setStageZoom(clampedZoom);
      window.requestAnimationFrame(() => {
        const nextContainer = fitAreaRef.current;
        if (!nextContainer) {
          return;
        }
        if (clampedZoom <= STAGE_ZOOM_MIN + 0.001) {
          nextContainer.scrollLeft = 0;
          nextContainer.scrollTop = 0;
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
      });
    };

    const rememberView = (id = selectedFrameId) => {
      const container = fitAreaRef.current;
      if (!container || !id || !viewReadyRef.current || stagePinchZoomRef.current) return;
      sceneViews.set(id, { zoom: stageZoomRef.current, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop,
        viewportWidth: container.clientWidth, viewportHeight: container.clientHeight });
    };
    const clearTransientZoom = () => {
      const preview = transientZoomRef.current;
      if (preview) { preview.style.removeProperty("transform"); preview.style.removeProperty("will-change"); preview.style.removeProperty("transform-origin"); }
    };
    const drawTransientPinch = (pinch: StagePinchZoom) => {
      const preview = transientZoomRef.current;
      if (!preview) return;
      const view = resolvePinchView(pinch.geometry, pinch.continuousZoom, { x: pinch.lastAnchor.clientX, y: pinch.lastAnchor.clientY });
      preview.style.transform = `translate(${view.translate.x}px, ${view.translate.y}px) scale(${view.scale})`;
    };
    function finishStagePinch(mode: "commit" | "restore") {
      cancelPendingStageZoom();
      stageTouchPointsRef.current.clear();
      if (mode === "restore") pendingTouchSelectionRef.current = null;
      const pinch = stagePinchZoomRef.current;
      if (!pinch) return;
      if (mode === "restore") { clearTransientZoom(); stagePinchZoomRef.current = null; return; }
      if (pinch.finishing) return;
      pinch.finishing = true;
      // Commit the preview's exact scale. Rounding only on release moves distant
      // labels by several pixels even when the gesture midpoint stays fixed.
      pinch.continuousZoom = Math.min(STAGE_ZOOM_MAX, Math.max(STAGE_ZOOM_MIN, pinch.continuousZoom));
      stageHorizontalViewInitializedRef.current = true;
      drawTransientPinch(pinch);
      // Re-measure once at release, including the rendered border, rulers and
      // clamped scroll. The committed layout must preserve this visible anchor.
      const previewRect = stageRef.current?.getBoundingClientRect();
      if (previewRect && previewRect.width > 0 && previewRect.height > 0) {
        pinch.geometry.anchorMeters = {
          x: (pinch.lastAnchor.clientX - previewRect.left) / previewRect.width * pinch.geometry.stageMeters.width,
          y: (pinch.lastAnchor.clientY - previewRect.top) / previewRect.height * pinch.geometry.stageMeters.height,
        };
      }
      setStageZoom(pinch.continuousZoom);
      setIsStagePinching(false);
    }
    useLayoutEffect(() => {
      const saved = selectedFrameId ? sceneViews.get(selectedFrameId) : undefined;
      pendingRestoreRef.current = saved ?? null;
      stageHorizontalViewInitializedRef.current = Boolean(saved);
      viewReadyRef.current = Boolean(saved);
      if (!saved && fitAreaRef.current) {
        fitAreaRef.current.scrollLeft = 0;
        fitAreaRef.current.scrollTop = 0;
      }
      setStageZoom(saved?.zoom ?? STAGE_ZOOM_MIN);
      setIsStagePinching(false);
      return () => { finishStagePinch("restore"); rememberView(selectedFrameId); };
    }, [selectedFrameId, sceneViews]);
    useLayoutEffect(() => {
      stageZoomRef.current = stageZoom;
      const container = fitAreaRef.current;
      if (!container) return;
      const saved = pendingRestoreRef.current;
      if (saved && saved.zoom === stageZoom) {
        container.scrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth,
          saved.scrollLeft + ((saved.viewportWidth ?? container.clientWidth) - container.clientWidth) / 2));
        container.scrollTop = saved.scrollTop;
        pendingRestoreRef.current = null;
      }
      const pinch = stagePinchZoomRef.current;
      if (!pinch?.finishing || !stageRef.current) return;
      clearTransientZoom();
      commitPinchView(container, stageRef.current, pinch.geometry, { x: pinch.lastAnchor.clientX, y: pinch.lastAnchor.clientY });
      stagePinchZoomRef.current = null;
      viewReadyRef.current = true;
      rememberView();
    }, [stageZoom, isStagePinching, selectedFrameId]);
    const scheduleStageZoom = (nextZoom: number, anchor: { clientX: number; clientY: number }) => {
      const pinch = stagePinchZoomRef.current;
      if (!pinch || pinch.finishing) return;
      pinch.continuousZoom = Math.min(STAGE_ZOOM_MAX, Math.max(STAGE_ZOOM_MIN, nextZoom));
      pinch.lastAnchor = anchor;
      if (stageZoomFrameRef.current !== null) return;
      stageZoomFrameRef.current = window.requestAnimationFrame(() => {
        stageZoomFrameRef.current = null;
        const active = stagePinchZoomRef.current;
        if (active && !active.finishing) drawTransientPinch(active);
      });
    };

    const updateStageZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      cancelPendingStageZoom();
      applyStageZoom(nextZoom, anchor);
    };

    // Apply fit once on the first portrait entry. Playback, panel size and later
    // rotations must preserve the user's multiplier and pinch state.
    useEffect(() => {
      if (!compact || portraitFitAppliedRef.current) return;
      portraitFitAppliedRef.current = true;
      cancelPendingStageZoom();
      applyStageZoom(STAGE_ZOOM_MIN);
    }, [compact]);

    useCanvasWheelZoom(fitAreaRef, isStagePinchLockedRef, (factor, anchor) => updateStageZoom(stageZoomRef.current * factor, anchor));

    const getTouchDistance = (first: StageTouchPoint, second: StageTouchPoint) =>
      Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);

    const getTouchMidpoint = (
      first: StageTouchPoint,
      second: StageTouchPoint,
    ) => ({
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2,
    });

    const beginStagePinchIfReady = () => {
      if (isStagePinchLockedRef.current && !annotation.active) {
        return;
      }
      cancelTouchContextMenu();
      const touchEntries = Array.from(stageTouchPointsRef.current.entries());
      if (touchEntries.length < 2) {
        return;
      }
      const [firstEntry, secondEntry] = touchEntries;
      // A two-finger gesture must not open/scroll the roster from its first touch.
      pendingTouchSelectionRef.current = null;
      const startDistance = Math.max(
        1,
        getTouchDistance(firstEntry[1], secondEntry[1]),
      );
      const container = fitAreaRef.current, layout = exportElementRef.current, stageElement = stageRef.current, preview = transientZoomRef.current;
      if (!container || !layout || !stageElement || !preview) return;
      const midpoint = getTouchMidpoint(firstEntry[1], secondEntry[1]);
      const rect = container.getBoundingClientRect(), layoutRect = layout.getBoundingClientRect(), stageRect = stageElement.getBoundingClientRect();
      const startZoom = stageZoomRef.current;
      const viewport = { left: rect.left + container.clientLeft, top: rect.top + container.clientTop, width: container.clientWidth, height: container.clientHeight };
      stagePinchZoomRef.current = {
        pointerIds: [firstEntry[0], secondEntry[0]],
        startDistance,
        startZoom, continuousZoom: startZoom, finishing: false, lastAnchor: midpoint,
        geometry: { viewport, padding: { left: 0, right: 0, top: 0, bottom: 0 }, startZoom, pixelsPerMeter: fittedStageSize.pxPerMeter,
          fixed: { left: showMeterRulers ? RULER_LABEL_WIDTH_PX : 0, right: showMeterRulers ? RULER_LABEL_WIDTH_PX : 0, top: showMeterRulers ? RULER_LABEL_HEIGHT_PX : 0 },
          bleedMeters: showMeterRulers ? memberDiameterMeters / 2 : 0, bottom: showMeterRulers ? RULER_BOTTOM_PADDING_PX : 0, centerAtFit: true,
          stageMeters: { width: stage.widthMeters, height: stage.depthMeters }, startScroll: { x: container.scrollLeft, y: container.scrollTop },
          startOrigin: { x: layoutRect.left - viewport.left + container.scrollLeft, y: layoutRect.top - viewport.top + container.scrollTop },
          anchorMeters: stageAnchorMeters({ x: midpoint.clientX, y: midpoint.clientY }, { x: stageRect.left, y: stageRect.top }, visibleStageSize.pxPerMeter) },
      };
      preview.style.transformOrigin = "0 0"; preview.style.willChange = "transform";
      const activeMemberDrag = memberDragRef.current;
      clearStagePan();
      memberDragRef.current = null;
      memberAutoScrollerRef.current?.stop();
      memberAutoScrollerRef.current = null;
      setIsMemberDragging(false);
      if (activeMemberDrag) {
        activeMemberDrag.operation.end();
        ephemeral?.cancel();
      }
      setActiveSnapGuides([]);
      setIsStagePinching(true);
    };

    const canPanStageFromTarget = (target: EventTarget | null) => {
      if (!isStageZoomed || !(target instanceof Element)) {
        return false;
      }
      return !target.closest(
        [
          "button",
          "input",
          "textarea",
          "select",
          "[contenteditable='true']",
          ".member-token",
          ".stage-object",
          ".object-resize-handle",
          ".object-rotate-handle",
          ".stage-zoom-controls",
        ].join(","),
      );
    };

    const handleStagePointerDownCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      setIsStageInteracting(true);
      if (event.pointerType !== "touch") {
        return;
      }
      if (!annotation.active && canPanStageFromTarget(event.target) && fitAreaRef.current) {
        stagePanRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: fitAreaRef.current.scrollLeft,
          startScrollTop: fitAreaRef.current.scrollTop,
          hasMoved: false,
        };
      }
      if (isStagePinchLockedRef.current && !annotation.active) {
        return;
      }
      stageTouchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (stageTouchPointsRef.current.size >= 2) {
        if (!stagePinchZoomRef.current) {
          beginStagePinchIfReady();
        }
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleStagePointerMoveCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      trackTouchContextMenuMove(event);
      const pending = pendingTouchSelectionRef.current;
      if (!stagePinchZoomRef.current && pending?.pointerId === event.pointerId &&
          Math.hypot(event.clientX - pending.point.clientX, event.clientY - pending.point.clientY) >= 3) flushTouchSelection();
      const pan = stagePanRef.current;
      if (
        event.pointerType === "touch" &&
        !annotation.active &&
        pan?.pointerId === event.pointerId &&
        !stagePinchZoomRef.current &&
        fitAreaRef.current
      ) {
        const dx = event.clientX - pan.startClientX;
        const dy = event.clientY - pan.startClientY;
        if (pan.hasMoved || Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          cancelTouchContextMenu();
          pan.hasMoved = true;
          setIsStagePanning(true);
          fitAreaRef.current.scrollLeft = Math.max(0, pan.startScrollLeft - dx);
          fitAreaRef.current.scrollTop = Math.max(0, pan.startScrollTop - dy);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (
        event.pointerType !== "touch" ||
        (isStagePinchLockedRef.current && !annotation.active) ||
        !stageTouchPointsRef.current.has(event.pointerId)
      ) {
        return;
      }
      stageTouchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      const pinch = stagePinchZoomRef.current;
      if (!pinch) {
        return;
      }
      const first = stageTouchPointsRef.current.get(pinch.pointerIds[0]);
      const second = stageTouchPointsRef.current.get(pinch.pointerIds[1]);
      if (!first || !second) {
        return;
      }
      const distance = Math.max(1, getTouchDistance(first, second));
      const anchor = getTouchMidpoint(first, second);
      scheduleStageZoom(
        isStagePinchLockedRef.current ? pinch.startZoom : pinch.startZoom * (distance / pinch.startDistance),
        anchor,
      );
      event.preventDefault();
      event.stopPropagation();
    };

    const handleStagePointerEndCapture = (
      event: PointerEvent<HTMLDivElement>,
    ) => {
      if (event.pointerType !== "touch") {
        return;
      }
      stopTouchContextMenu(event);
      if (!stagePinchZoomRef.current && pendingTouchSelectionRef.current?.pointerId === event.pointerId) flushTouchSelection();
      if (stagePanRef.current?.pointerId === event.pointerId) {
        clearStagePan();
      }
      stageTouchPointsRef.current.delete(event.pointerId);
      if (stageTouchPointsRef.current.size < 2 || event.type === "pointercancel") finishStagePinch("commit");
    };

    const updateStagePointerPosition = (event: PointerEvent<HTMLElement>) => {
      if (!stageRef.current) {
        return;
      }
      const rect = stageRef.current.getBoundingClientRect();
      const isInsideStage =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!isInsideStage) {
        return;
      }
      const pointer = clientPointToMeters(
        event.clientX,
        event.clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      onStagePointerPositionChange(pointer);
    };

    const applySnapGuides = (
      position: Position,
      target: { type: "member" | "object"; id: string },
    ): { position: Position; guides: SnapGuide[] } => {
      if (!guideSettings.snapGuideEnabled) {
        return { position, guides: [] };
      }
      const thresholdMeters = Math.max(0.02, 8 / visibleStageSize.pxPerMeter);
      const xGuides = [stage.widthMeters / 2];
      const yGuides: number[] = [];

      project.members.forEach((member) => {
        if (target.type === "member" && member.id === target.id) {
          return;
        }
        const memberPosition = snapshot.positions[member.id];
        if (memberPosition && isSnapshotMemberVisible(snapshot, member.id)) {
          xGuides.push(memberPosition.x);
          yGuides.push(memberPosition.y);
        }
      });
      project.stageObjects.forEach((object) => {
        if (target.type === "object" && object.id === target.id) {
          return;
        }
        const state = snapshot.objectStates[object.id];
        if (!state?.visible) {
          return;
        }
        xGuides.push(state.x + state.widthMeters / 2);
        yGuides.push(state.y + state.heightMeters / 2);
      });

      const findNearest = (value: number, values: number[]) =>
        values.reduce<{ value: number; distance: number } | null>((nearest, guide) => {
          const distance = Math.abs(value - guide);
          if (distance > thresholdMeters) {
            return nearest;
          }
          if (!nearest || distance < nearest.distance) {
            return { value: guide, distance };
          }
          return nearest;
        }, null);

      const nearestX = findNearest(position.x, xGuides);
      const nearestY = findNearest(position.y, yGuides);
      const guides: SnapGuide[] = [];
      const next = { ...position };
      if (nearestX) {
        guides.push({ axis: "x", value: nearestX.value });
        if (guideSettings.snapToGuideEnabled) {
          next.x = nearestX.value;
        }
      }
      if (nearestY) {
        guides.push({ axis: "y", value: nearestY.value });
        if (guideSettings.snapToGuideEnabled) {
          next.y = nearestY.value;
        }
      }
      if (!nearestX) {
        guides.push({ axis: "x", value: next.x });
      }
      if (!nearestY) {
        guides.push({ axis: "y", value: next.y });
      }
      return {
        guides,
        position: {
          x: roundMeters(next.x),
          y: roundMeters(next.y),
        },
      };
    };

    function openContextMenuAt(
      clientX: number,
      clientY: number,
      target: StageContextMenuRequest["target"],
    ) {
      if (!stageRef.current) {
        return;
      }
      const pointer = clientPointToMeters(
        clientX,
        clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      onStagePointerPositionChange(pointer);
      onContextMenuRequest({
        clientX,
        clientY,
        stagePosition: pointer,
        target,
      });
    }

    function startTouchContextMenu(
      event: PointerEvent<HTMLElement>,
      target: StageContextMenuRequest["target"],
    ) {
      if (
        event.pointerType !== "touch" ||
        event.button !== 0 ||
        stagePinchZoomRef.current ||
        stageTouchPointsRef.current.size > 1
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
    }

    function trackTouchContextMenuMove(event: PointerEvent<HTMLElement>) {
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
    }

    function stopTouchContextMenu(event: PointerEvent<HTMLElement>) {
      if (touchContextMenuRef.current?.pointerId === event.pointerId) {
        cancelTouchContextMenu();
      }
    }

    function openContextMenu(
      event: ReactMouseEvent<HTMLElement>,
      target: StageContextMenuRequest["target"],
    ) {
      event.preventDefault();
      event.stopPropagation();
      openContextMenuAt(event.clientX, event.clientY, target);
    }

    const previewMemberDragTransforms = (
      drag: MemberDrag,
      nextPositions: Record<string, Position>,
    ) => {
      const stageElement = stageRef.current;
      if (!stageElement) {
        return;
      }
      // CSS transforms use layout pixels, before the desktop root's CSS zoom.
      const layoutWidth = stageElement.clientWidth;
      const layoutHeight = stageElement.clientHeight;
      drag.memberIds.forEach((id) => {
        const startPosition = drag.startPositions[id];
        const nextPosition = nextPositions[id];
        const element = memberElementRefs.current.get(id);
        if (!startPosition || !nextPosition || !element) {
          return;
        }
        const startDisplayPosition = stagePointToDisplayPoint(
          startPosition,
          stage,
          viewerPerspective,
        );
        const nextDisplayPosition = stagePointToDisplayPoint(
          nextPosition,
          stage,
          viewerPerspective,
        );
        const dxPx =
          ((nextDisplayPosition.x - startDisplayPosition.x) / stage.widthMeters) *
          layoutWidth;
        const dyPx =
          ((nextDisplayPosition.y - startDisplayPosition.y) / stage.depthMeters) *
          layoutHeight;
        element.style.setProperty("--member-drag-x", `${dxPx}px`);
        element.style.setProperty("--member-drag-y", `${dyPx}px`);
      });
    };

    const commitDeferredMemberDrag = (drag: MemberDrag) => {
      if (!deferMemberDragCommit || !drag.latestPositions) {
        return;
      }
      Object.entries(drag.latestPositions).forEach(([id, position]) => {
        onMoveMember(id, position);
      });
      scheduleClearMemberDragTransforms(drag.memberIds);
    };

    const moveDraggedMember = (clientX: number, clientY: number) => {
      const measuredAt = ephemeral ? performance.now() : 0;
      const drag = memberDragRef.current;
      if (!drag?.operation.active || !stageRef.current) {
        return;
      }
      drag.currentClientX = clientX;
      drag.currentClientY = clientY;
      const pointer = clientPointToMeters(
        clientX,
        clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      const primaryStartPosition =
        drag.startPositions[drag.memberId] ?? drag.startPosition;
      const requested = {
        x: primaryStartPosition.x + pointer.x - drag.startPointer.x,
        y: primaryStartPosition.y + pointer.y - drag.startPointer.y,
      };
      if (!stage.showGrid) {
        requested.x = roundMeters(requested.x);
        requested.y = roundMeters(requested.y);
      }
      const next = {
        x: snapMemberGroupHorizontal(
          requested.x,
          primaryStartPosition.x,
          Object.values(drag.startPositions),
          stage.widthMeters,
          stage.showGrid ? stage.gridSizeMeters : NaN,
          horizontalGridOriginMeters(stage.widthMeters, horizontalGuideMode),
        ),
        y: snapMemberGroupAxis(
          requested.y,
          primaryStartPosition.y, Object.values(drag.startPositions).map(p => p.y), stage.depthMeters,
          stage.showGrid ? stage.gridSizeMeters : NaN,
          stageVerticalGridOriginMeters(stage.depthMeters, stage),
        ),
      };
      const guided = applySnapGuides(next, {
        type: "member",
        id: drag.memberId,
      });
      if (!deferMemberDragCommit) {
        setActiveSnapGuides(guided.guides);
      }
      const primaryNextPosition = stage.showGrid ? guided.position : {
        x: roundMeters(guided.position.x), y: roundMeters(guided.position.y),
      };
      const delta = {
        x: Math.min(
          Math.min(...Object.values(drag.startPositions).map(p => stage.widthMeters - p.x)),
          Math.max(Math.max(...Object.values(drag.startPositions).map(p => -p.x)), primaryNextPosition.x - primaryStartPosition.x),
        ),
        // Guides win over the grid, but the entire selection must still fit.
        y: snapPositionInBounds(primaryNextPosition.y, NaN, 0,
          ...memberGroupAxisBounds(primaryStartPosition.y, Object.values(drag.startPositions).map(p => p.y), stage.depthMeters)) - primaryStartPosition.y,
      };
      const nextPositions: Record<string, Position> = {};
      drag.memberIds.forEach((id) => {
        const startPosition = drag.startPositions[id];
        if (!startPosition) {
          return;
        }
        // The shared delta is already bounded; preserve the group's exact relative positions.
        nextPositions[id] = { x: startPosition.x + delta.x, y: startPosition.y + delta.y };
      });
      drag.latestPositions = nextPositions;
      if (deferMemberDragCommit) {
        previewMemberDragTransforms(drag, nextPositions);
        ephemeral?.latestMeasured(delta.x, delta.y, measuredAt);
        return;
      }
      Object.entries(nextPositions).forEach(([id, position]) => {
        onMoveMember(id, position);
      });
      ephemeral?.latestMeasured(delta.x, delta.y, measuredAt);
    };

    const handleMemberPointerDown = (
      event: PointerEvent<HTMLDivElement>,
      memberId: string,
    ) => {
      if (stagePinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      if (event.button !== 0) {
        return;
      }
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
        event.preventDefault();
        onLockedElementEditAttempt?.(remoteLockOwner);
        return;
      }
      if (isReadOnly) {
        event.preventDefault();
        onReadOnlyEditAttempt?.();
        return;
      }
      startTouchContextMenu(event, { type: "member", id: memberId });
      if (appendSelection) {
        event.preventDefault();
        return;
      }
      if (!memberEditing || !stageRef.current) {
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
      const startPointer = clientPointToMeters(
        event.clientX,
        event.clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      memberDragRef.current = {
        operation: editScope.create(event.currentTarget, event.pointerId),
        pointerId: event.pointerId,
        memberId,
        memberIds: Object.keys(startPositions).length > 0 ? Object.keys(startPositions) : [memberId],
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        startPointer,
        startPosition: snapshot.positions[memberId] ?? { x: 0, y: 0 },
        startPositions:
          Object.keys(startPositions).length > 0
            ? startPositions
            : { [memberId]: snapshot.positions[memberId] ?? { x: 0, y: 0 } },
        latestPositions: null,
        hasMoved: false,
        isBeginPending: false,
        endRequested: false,
      };
      if (fitAreaRef.current) {
        memberAutoScrollerRef.current?.stop();
        memberAutoScrollerRef.current = createEdgeAutoScroller(fitAreaRef.current, {
          onScroll: () => {
            const drag = memberDragRef.current;
            if (drag?.hasMoved) {
              moveDraggedMember(drag.currentClientX, drag.currentClientY);
            }
          },
        });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleMemberPointerMove = (event: PointerEvent<HTMLDivElement>) => {
      trackTouchContextMenuMove(event);
      if (stagePinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const drag = memberDragRef.current;
      if (!drag?.operation.active || drag.pointerId !== event.pointerId || !stageRef.current) {
        return;
      }
      drag.currentClientX = event.clientX;
      drag.currentClientY = event.clientY;
      if (drag.isBeginPending) {
        return;
      }
      if (!drag.hasMoved) {
        const movementPx = Math.hypot(
          event.clientX - drag.startClientX,
          event.clientY - drag.startClientY,
        );
        if (movementPx < 3) {
          return;
        }
        cancelTouchContextMenu();
        drag.isBeginPending = true;
        const editTargets: SceneElementEditTarget[] = drag.memberIds.map((id) => ({
          id,
          type: "member-position",
        }));
        const editTarget =
          editTargets.length === 1 ? editTargets[0] : editTargets;
        const beginResult = drag.operation.begin(
          editTargets.length > 1 ? "複数メンバー移動" : "メンバー移動",
          editTarget,
        );
        void Promise.resolve(beginResult).then((canEdit) => {
          const latestDrag = memberDragRef.current;
          if (latestDrag !== drag || !drag.operation.active) return;
          latestDrag.isBeginPending = false;
          if (canEdit === false) {
            latestDrag.operation.end();
            memberDragRef.current = null;
            memberAutoScrollerRef.current?.stop();
            memberAutoScrollerRef.current = null;
            setActiveSnapGuides([]);
            setIsMemberDragging(false);
            return;
          }
          latestDrag.hasMoved = true;
          ephemeral?.begin(selectedFrameId, latestDrag.memberIds.map(id => ['member', id, latestDrag.startPositions[id].x, latestDrag.startPositions[id].y] as EphemeralTarget));
          setIsMemberDragging(true);
          moveDraggedMember(latestDrag.currentClientX, latestDrag.currentClientY);
          if (latestDrag.endRequested) {
            commitDeferredMemberDrag(latestDrag);
            memberDragRef.current = null;
            memberAutoScrollerRef.current?.stop();
            memberAutoScrollerRef.current = null;
            setActiveSnapGuides([]);
            setIsMemberDragging(false);
            latestDrag.operation.end(editTarget);
            ephemeral?.finish();
            return;
          }
          memberAutoScrollerRef.current?.update(
            latestDrag.currentClientX,
            latestDrag.currentClientY,
          );
        });
        return;
      }
      moveDraggedMember(event.clientX, event.clientY);
      memberAutoScrollerRef.current?.update(event.clientX, event.clientY);
    };

    const stopMemberDrag = (event: PointerEvent<HTMLDivElement>) => {
      stopTouchContextMenu(event);
      const drag = memberDragRef.current;
      if (drag?.pointerId === event.pointerId) {
        if (drag.isBeginPending && !drag.hasMoved) {
          drag.endRequested = true;
          drag.currentClientX = event.clientX;
          drag.currentClientY = event.clientY;
          memberAutoScrollerRef.current?.stop();
          memberAutoScrollerRef.current = null;
          setActiveSnapGuides([]);
          setIsMemberDragging(false);
          return;
        }
        memberDragRef.current = null;
        memberAutoScrollerRef.current?.stop();
        memberAutoScrollerRef.current = null;
        setActiveSnapGuides([]);
        if (drag.hasMoved) {
          commitDeferredMemberDrag(drag);
          if (event.type === 'pointercancel') ephemeral?.cancel(); else ephemeral?.finish();
        }
        drag.operation.end();
        setIsMemberDragging(false);
      }
    };

    useLayoutEffect(() => () => {
      memberDragRef.current?.operation.end();
      memberDragRef.current = null;
      memberAutoScrollerRef.current?.stop();
      memberAutoScrollerRef.current = null;
      cancelTouchContextMenu();
      cancelPendingMemberDragClear();
      clearMemberDragTransforms([...memberElementRefs.current.keys()]);
      pendingTouchSelectionRef.current = null;
      stageTouchPointsRef.current.clear();
      clearStagePan();
      setActiveSnapGuides([]);
      setIsMemberDragging(false);
      ephemeral?.cancel();
    }, [editScope]);

    const stageGridVerticalTicks = useMemo(() => horizontalEmphasizedLines(stage.widthMeters,
      horizontalGuideMode, stage.gridSizeMeters, stage, stage.showGrid, stage.showCenterLine), [stage, horizontalGuideMode]);
    const stageGridHorizontalTicks = useMemo(() => verticalEmphasizedLines(stage.depthMeters,
      stage.gridSizeMeters, stage, undefined, stage.showGrid), [stage]);

    const visibleObjects = project.stageObjects
      .filter((object) => snapshot.objectStates[object.id]?.visible ?? object.visible)
      .sort(
        (a, b) =>
          (snapshot.objectStates[a.id]?.zIndex ?? a.zIndex) -
          (snapshot.objectStates[b.id]?.zIndex ?? b.zIndex),
      );
    const visibleStageMembers = useMemo(
      () =>
        project.members.filter(
          (member) =>
            (member.visible ?? true) &&
            isSnapshotMemberVisible(snapshot, member.id) &&
            Boolean(snapshot.positions[member.id]),
        ),
      [project.members, snapshot],
    );
    const memberDisplayOffsets = useMemo(() => {
      const clusters = new Map<string, string[]>();

      visibleStageMembers.forEach((member) => {
        const position = snapshot.positions[member.id];
        if (!position) {
          return;
        }
        const displayPosition = stagePointToDisplayPoint(
          position,
          stage,
          viewerPerspective,
        );
        const key = `${Math.round(displayPosition.x * MEMBER_OVERLAP_KEY_SCALE)}:${Math.round(
          displayPosition.y * MEMBER_OVERLAP_KEY_SCALE,
        )}`;
        const ids = clusters.get(key) ?? [];
        ids.push(member.id);
        clusters.set(key, ids);
      });

      const offsets = new Map<string, MemberDisplayOffset>();
      const radiusPx = Math.min(
        14,
        Math.max(7, visibleStageSize.pxPerMeter * memberDiameterMeters * 0.22),
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
    }, [
      visibleStageSize.pxPerMeter,
      memberDiameterMeters,
      snapshot.positions,
      stage,
      viewerPerspective,
      visibleStageMembers,
    ]);

    const sortedFrames = useMemo(() => sortFrames(project.frames), [project.frames]);
    const selectedFrameIndex = Math.max(
      0,
      sortedFrames.findIndex((frame) => frame.id === selectedFrameId),
    );
    const fromFrame = sortedFrames[selectedFrameIndex];
    const toFrame = sortedFrames[selectedFrameIndex + 1];
    const fromSnapshot = useMemo(
      () => (fromFrame ? getSnapshotForFrame(project, fromFrame.id) : snapshot),
      [fromFrame, project, snapshot],
    );
    const toSnapshot = useMemo(
      () => (toFrame ? getSnapshotForFrame(project, toFrame.id) : null),
      [toFrame, project],
    );
    const pathMemberIds = useMemo(() => {
      if (!toSnapshot) return [];
      if (movementPathMode === "selected" && selectedMemberIds.length > 0) {
        return selectedMemberIds.filter((memberId) => {
          const member = project.members.find((item) => item.id === memberId);
          return (
            (member?.visible ?? true) &&
            isSnapshotMemberVisible(fromSnapshot, memberId)
          );
        });
      }
      return project.members
        .filter(
          (member) =>
            (member.visible ?? true) &&
            isSnapshotMemberVisible(fromSnapshot, member.id),
        )
        .map((member) => member.id);
    }, [
      fromSnapshot,
      movementPathMode,
      project.members,
      selectedMemberIds,
      toSnapshot,
    ]);
    const pathObjectIds = useMemo(() => {
      if (!toSnapshot) return [];
      if (movementPathMode === "selected" && selected?.type === "object") {
        return [selected.id];
      }
      if (movementPathMode === "selected") return [];
      return project.stageObjects.map((object) => object.id);
    }, [movementPathMode, project.stageObjects, selected, toSnapshot]);
    const focusDistanceMeters = useMemo(() => {
      if (!focusMemberId || !toSnapshot) return null;
      if (!isSnapshotMemberVisible(fromSnapshot, focusMemberId)) return null;
      const start = fromSnapshot.positions[focusMemberId];
      const end = toSnapshot.positions[focusMemberId];
      if (!start || !end) return null;
      return Math.hypot(end.x - start.x, end.y - start.y);
    }, [focusMemberId, fromSnapshot, toSnapshot]);

    const currentMemberHandlers = { setMemberElementRef, handleMemberPointerDown, handleMemberPointerMove, stopMemberDrag, openContextMenu };
    const memberHandlersRef = useRef(currentMemberHandlers);
    useLayoutEffect(() => { memberHandlersRef.current = currentMemberHandlers; });
    const memberTokenHandlers = useMemo(() => ({
      ref: (id: string, node: HTMLDivElement | null) => memberHandlersRef.current.setMemberElementRef(id, node),
      down: (event: PointerEvent<HTMLDivElement>, id: string) => memberHandlersRef.current.handleMemberPointerDown(event, id),
      move: (event: PointerEvent<HTMLDivElement>) => memberHandlersRef.current.handleMemberPointerMove(event),
      stop: (event: PointerEvent<HTMLDivElement>) => memberHandlersRef.current.stopMemberDrag(event),
      menu: (event: ReactMouseEvent<HTMLDivElement>, id: string) => memberHandlersRef.current.openContextMenu(event, { type: "member", id }),
    }), []);

    const annotation = useAnnotationEditor({ lines: project.frames.find(f => f.id === selectedFrameId)?.annotationLines,
      width: stage.widthMeters, depth: stage.depthMeters, step: stage.gridSizeMeters, counting: horizontalGuideMode,
      verticalOrigin: stageVerticalGridOriginMeters(stage.depthMeters, stage),
      reflected: viewerPerspective === "performer", context: project.id + ":" + selectedFrameId, disabled: isPlaying || isReadOnly,
      onChange: onAnnotationLineChange });
    useLayoutEffect(() => {
      if (annotation.active) clearStagePan();
    }, [annotation.active]);
    return (
      <main className="stage-area">
        <div className={isReadOnly ? "stage-frame is-read-only" : "stage-frame"}>
          {compact ? <CompactStageControls
            annotationControls={annotation.toolbar}
            currentTime={currentTime} duration={audioDuration} audioName={audioName}
            sceneLabel={selectedFrameLabel} isPlaying={isPlaying} isFullscreen={isFullscreen}
            isReadOnly={isReadOnly} canUndo={canUndo} canRedo={canRedo}
            zoom={stageZoom} pinchLocked={isStagePinchLocked}
            onUndo={onUndo} onRedo={onRedo} onPlay={onTogglePlayback} onSave={onSaveFrame}
            onSeek={onSeekAudio} onZoom={updateStageZoom} onCapture={onCaptureStageImage}
            onPerspective={onTogglePerspective} onFullscreen={onToggleFullscreen}
            onPinchLock={() => setIsStagePinchLocked((locked) => !locked)}
          /> : <div className="stage-export-header">
            <div className="stage-primary-controls">
              <button
                className="mini-button icon-only undo-redo-button"
                onClick={onUndo}
                disabled={!canUndo || isReadOnly}
                type="button"
                title="元に戻す（Ctrl+Z）"
              >
                <Undo2 size={17} />
                <span className="sr-only">元に戻す</span>
              </button>
              <button
                className="mini-button icon-only undo-redo-button"
                onClick={onRedo}
                disabled={!canRedo || isReadOnly}
                type="button"
                title="やり直し（Ctrl+Y / Ctrl+Shift+Z）"
              >
                <Redo2 size={17} />
                <span className="sr-only">やり直し</span>
              </button>
              <button
                className="stage-play-button"
                onClick={onTogglePlayback}
                type="button"
                title="再生 / 停止"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                <span>{isPlaying ? "停止" : "再生"}</span>
              </button>
              <StageTimeBar
                currentTime={currentTime}
                duration={audioDuration}
                audioName={audioName}
                onSeek={onSeekAudio}
              />
            </div>
            <div className="stage-export-header__actions">
              {annotation.toolbar}
              <span
                className="stage-current-scene"
                title={`${selectedFrameLabel} / ${formatTime(
                  isPlaying ? currentTime : selectedFrameTime,
                )}`}
              >
                <span className="stage-current-scene__label">
                  {selectedFrameLabel}
                </span>
                <span className="stage-current-scene__time">
                  {formatTime(isPlaying ? currentTime : selectedFrameTime)}
                </span>
              </span>
              {focusMode && focusDistanceMeters !== null && (
                <span className="focus-distance">
                  推し移動 {focusDistanceMeters.toFixed(1)}m
                </span>
              )}
              {isReadOnly && (
                <span className="stage-readonly-pill" title={readOnlyMessage}>
                  閲覧中
                </span>
              )}
              <button
                className="mini-button"
                onClick={onSaveFrame}
                type="button"
                disabled={isReadOnly}
                title={isReadOnly ? readOnlyMessage ?? "閲覧中です" : "現在のシーンを保存"}
              >
                <Save size={15} />
                保存
              </button>
              <button
                className="mini-button icon-only"
                onClick={onCaptureStageImage}
                type="button"
                title="ステージを画像保存"
                aria-label="ステージを画像保存"
              >
                <Camera size={15} />
              </button>
              <div className="stage-zoom-controls" aria-label="ステージ表示倍率">
                <button
                  className="stage-zoom-reset"
                  onClick={() => updateStageZoom(STAGE_ZOOM_MIN)}
                  type="button"
                  title={`全体表示（現在${Math.round(stageZoom * 100)}%）`}
                  aria-label="ステージを全体表示に戻す"
                >
                  全体表示
                </button>
                <button
                  className={[
                    "mini-button icon-only stage-zoom-button stage-pinch-lock-button",
                    isStagePinchLocked ? "is-locked" : "",
                  ].join(" ")}
                  onClick={() => setIsStagePinchLocked((locked) => !locked)}
                  type="button"
                  title={
                    isStagePinchLocked
                      ? "ピンチ/ホイール拡大縮小を有効にする"
                      : "ピンチ/ホイール拡大縮小をロック"
                  }
                  aria-label={
                    isStagePinchLocked
                      ? "ピンチ拡大縮小のロックを解除"
                      : "ピンチ拡大縮小をロック"
                  }
                >
                  {isStagePinchLocked ? (
                    <Lock size={14} />
                  ) : (
                    <Unlock size={14} />
                  )}
                </button>
              </div>
              <button
                className="mini-button"
                onClick={onTogglePerspective}
                type="button"
                title={`観客側／踊る人側の視点を切り替え（現在：${viewerPerspective === "performer" ? "踊る人側" : "観客側"}）`}
                aria-label={`視点を切り替え（現在：${viewerPerspective === "performer" ? "踊る人側" : "観客側"}）`}
              >
                {/* Front/back swap, not a left-right mirror (user decision 2026-10-06). */}
                <ArrowUpDown size={15} aria-hidden="true" />
                視点
              </button>
              <button
                className="mini-button icon-only"
                onClick={onToggleFullscreen}
                type="button"
                title="ステージフルスクリーン"
                aria-label={isFullscreen ? "全画面を終了" : "全画面"}
              >
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                <span className="sr-only">{isFullscreen ? "戻る" : "全画面"}</span>
              </button>
            </div>
          </div>}
          {showMeterRulers && !compact && (
            <div className="ruler-reference-labels">
              <span>
                {horizontalGuideMode === "centerSplit"
                  ? "横: センターから0.5mずらし（センターは空欄）"
                  : "横: センターから1m刻み（センターは空欄）"}
              </span>
              <span>縦: 最前0m（奥へ行くほどプラス）</span>
            </div>
          )}
          <div
            className={[
              "stage-keyboard-hint",
              selected || selectedMemberIds.length > 0 ? "" : "is-placeholder",
            ].join(" ")}
            aria-hidden={selected || selectedMemberIds.length > 0 ? undefined : true}
          >
            矢印キー: 0.25m移動 / Shift+矢印: グリッド単位 / Ctrl+矢印:
            0.01m移動
          </div>
          <div
            className={[
              "stage-fit-area",
              annotation.active ? "is-annotation-mode" : "",
              isStageZoomed ? "is-stage-zoomed" : "",
              isStagePinching ? "is-stage-pinching" : "",
              isStagePanning ? "is-stage-panning" : "",
              isStagePinchLocked ? "is-stage-pinch-locked" : "",
            ].join(" ")}
            ref={fitAreaRef}
            onScroll={() => rememberView()}
            onPointerDownCapture={handleStagePointerDownCapture}
            onPointerMoveCapture={handleStagePointerMoveCapture}
            onPointerUpCapture={handleStagePointerEndCapture}
            onPointerCancelCapture={handleStagePointerEndCapture}
          >
            <div className="stage-zoom-layout" style={{ width: visibleStageSize.widthPx + visibleStageSize.rulerWidth * 2, height: visibleStageSize.heightPx + visibleStageSize.rulerHeight + visibleStageSize.rulerBottomPadding }}>
            <div className="stage-pinch-preview" ref={transientZoomRef}>
            <div
              ref={exportElementRef}
              className={
                showMeterRulers
                  ? "stage-canvas-with-rulers"
                  : "stage-canvas-with-rulers hide-rulers"
              }
              style={{
                gridTemplateColumns: showMeterRulers
                  ? `${visibleStageSize.rulerWidth}px ${visibleStageSize.widthPx}px ${visibleStageSize.rulerWidth}px`
                  : `${visibleStageSize.widthPx}px`,
                gridTemplateRows: showMeterRulers
                  ? `${visibleStageSize.rulerHeight}px ${visibleStageSize.heightPx}px`
                  : `${visibleStageSize.heightPx}px`,
                paddingBottom: showMeterRulers
                  ? `${visibleStageSize.rulerBottomPadding}px`
                  : undefined,
                "--ruler-member-bleed-px": `${visibleStageSize.memberBleedPx}px`,
                "--ruler-label-offset-px": `${visibleStageSize.rulerLabelOffset}px`,
                "--ruler-label-offset-negative-px": `-${visibleStageSize.rulerLabelOffset}px`,
              } as CSSProperties}
            >
              <div className="ruler-corner" aria-hidden="true" />
              <div className="meter-ruler meter-ruler--horizontal" aria-hidden="true">
                {horizontalLabels.map((item) => (
                  <span key={item.key}
                    className="meter-ruler__tick"
                    data-position={item.positionMeters}
                    style={{ left: stageRulerPosition(viewerPerspective === "performer" ? stage.widthMeters - item.positionMeters : item.positionMeters, stage.widthMeters) }}>
                    {item.label}
                  </span>
                ))}
              </div>
              <div className="ruler-corner ruler-corner--right" aria-hidden="true" />
              <div
                className="meter-ruler meter-ruler--vertical meter-ruler--vertical-left"
                aria-hidden="true"
              >
                {verticalTicks.map((tick) => (
                  <span
                    key={`y-${tick}`}
                    className="meter-ruler__tick"
                    data-position={viewerPerspective === "performer" ? stage.depthMeters - tick : tick}
                    style={{ top: stageRulerPosition(tick, stage.depthMeters) }}
                  >
                    {coordinateLabel(
                      "y",
                      tick,
                      stage.widthMeters,
                      stage.depthMeters,
                      originMode,
                      frontDirection,
                      viewerPerspective,
                    )}
                  </span>
                ))}
              </div>
              <div
                ref={stageRef}
                data-stage-surface="true"
                className={[
                  "stage-surface",
                  annotation.active ? "is-annotation-editing" : "",
                  stage.showGrid ? "has-grid" : "",
                  isPlaying ? "is-previewing" : "",
                  mode === "animation" ? "is-animation-editing" : "",
                ].join(" ")}
                style={{
                  height: `${visibleStageSize.heightPx}px`,
                  width: `${visibleStageSize.widthPx}px`,
                }}
                onPointerDown={(event) => {
                  updateStagePointerPosition(event);
                  if (!isMemberSelectionMode) {
                    selectPointerTarget(null);
                  }
                  startTouchContextMenu(event, { type: "stage" });
                }}
                onPointerEnter={updateStagePointerPosition}
                onPointerMove={(event) => {
                  updateStagePointerPosition(event);
                  trackTouchContextMenuMove(event);
                }}
                onPointerUp={stopTouchContextMenu}
                onPointerCancel={stopTouchContextMenu}
                onContextMenu={(event) => openContextMenu(event, { type: "stage" })}
              >
              {annotation.inkLayer}
              {annotation.interactionLayer}
              {remoteLayer}
              {(stageGridVerticalTicks.length > 0 || stageGridHorizontalTicks.length > 0) && (
                <div className="stage-grid-layer" aria-hidden="true">
                  {stageGridVerticalTicks.map((tick) => (
                    <span
                      className={`stage-grid-line stage-grid-line--vertical ${tick.kind === "counting" ? "is-counting" : ""}`}
                      key={`stage-grid-x-${tick.positionMeters}`}
                      data-emphasis={tick.emphasis}
                      data-position={tick.positionMeters}
                      style={{ ...gridLineStyle(tick.emphasis, true), left: `${((viewerPerspective === "performer" ? stage.widthMeters - tick.positionMeters : tick.positionMeters) / stage.widthMeters) * 100}%` }}
                    />
                  ))}
                  {stageGridHorizontalTicks.map((tick) => (
                    <span
                      className="stage-grid-line stage-grid-line--horizontal"
                      key={`stage-grid-y-${tick.positionMeters}`}
                      data-emphasis={tick.emphasis}
                      data-position={tick.positionMeters}
                      style={{ ...gridLineStyle(tick.emphasis, false), top: `${((viewerPerspective === "performer" ? stage.depthMeters - tick.positionMeters : tick.positionMeters) / stage.depthMeters) * 100}%` }}
                    />
                  ))}
                </div>
              )}
              {stage.showCenterLine && <span className="center-line" />}
              {(stage.showCenterMarker ?? true) && (
                <span className="center-marker" aria-hidden="true" />
              )}
              <div className="canvas-elements-layer">
              {activeSnapGuides.map((guide, index) => {
                const displayPosition = stagePointToDisplayPoint(
                  guide.axis === "x"
                    ? { x: guide.value, y: 0 }
                    : { x: 0, y: guide.value },
                  stage,
                  viewerPerspective,
                );
                return (
                  <span
                    className={`snap-guide snap-guide--${guide.axis}`}
                    key={`${guide.axis}-${guide.value}-${index}`}
                    style={
                      guide.axis === "x"
                        ? { left: `${(displayPosition.x / stage.widthMeters) * 100}%` }
                        : { top: `${(displayPosition.y / stage.depthMeters) * 100}%` }
                    }
                  />
                );
              })}
              {showMovementPaths && toSnapshot && fromFrame && toFrame && (
                <svg className="movement-path-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <marker
                      id="movement-arrow"
                      markerHeight="5"
                      markerWidth="5"
                      orient="auto"
                      refX="4.4"
                      refY="2.5"
                    >
                      <path d="M 0 0 L 5 2.5 L 0 5 z" fill="context-stroke" />
                    </marker>
                  </defs>
                  {pathMemberIds.map((memberId) => {
                    const member = project.members.find((item) => item.id === memberId);
                    const start = fromSnapshot.positions[memberId];
                    const end = toSnapshot.positions[memberId];
                    if (!member || !start || !end) return null;
                    if (!isAnimationEnabledForTarget(project, "member", memberId)) {
                      return null;
                    }
                    const savedPath = resolveMovementPlan(
                      project,
                      "member",
                      memberId,
                      fromFrame,
                      toFrame,
                    );
                    if (!savedPath || savedPath.enabled === false) return null;
                    const pathType = getMovementPathType(savedPath);
                    const displayStart = stagePointToDisplayPoint(
                      start,
                      stage,
                      viewerPerspective,
                    );
                    const displayEnd = stagePointToDisplayPoint(
                      end,
                      stage,
                      viewerPerspective,
                    );
                    const control = savedPath?.controlPoint
                      ? stagePointToDisplayPoint(
                          savedPath.controlPoint,
                          stage,
                          viewerPerspective,
                        )
                      : null;
                    const startX = (displayStart.x / stage.widthMeters) * 100;
                    const startY = (displayStart.y / stage.depthMeters) * 100;
                    const endX = (displayEnd.x / stage.widthMeters) * 100;
                    const endY = (displayEnd.y / stage.depthMeters) * 100;
                    const controlPercent = control
                      ? {
                          x: (control.x / stage.widthMeters) * 100,
                          y: (control.y / stage.depthMeters) * 100,
                        }
                      : null;
                    const pathD = createMovementPathD(
                      startX,
                      startY,
                      endX,
                      endY,
                      pathType,
                      controlPercent,
                    );
                    if (!pathD) return null;
                    const isFocus = focusMemberId === memberId;
                    const memberColor = getMemberDisplayColor(member, {
                      groups: memberGroups,
                      snapshot: fromSnapshot,
                    });
                    return (
                      <g key={memberId}>
                        <path
                          d={pathD}
                          className={[
                            "movement-path",
                            `path-${pathType}`,
                            isFocus ? "is-focus" : "",
                          ].join(" ")}
                          markerEnd="url(#movement-arrow)"
                          stroke={memberColor}
                        />
                        {controlPercent && (
                          <circle
                            cx={controlPercent.x}
                            cy={controlPercent.y}
                            r={1}
                            className="movement-control-point"
                          />
                        )}
                        <circle
                          cx={endX}
                          cy={endY}
                          r={isFocus ? 1.2 : 0.85}
                          fill={memberColor}
                        />
                      </g>
                    );
                  })}
                  {pathObjectIds.map((objectId) => {
                    const object = project.stageObjects.find((item) => item.id === objectId);
                    const start = fromSnapshot.objectStates[objectId];
                    const end = toSnapshot.objectStates[objectId];
                    if (!object || !start || !end) return null;
                    if (!isAnimationEnabledForTarget(project, "object", objectId)) {
                      return null;
                    }
                    const savedPath = resolveMovementPlan(
                      project,
                      "object",
                      objectId,
                      fromFrame,
                      toFrame,
                    );
                    if (!savedPath || savedPath.enabled === false) return null;
                    const pathType = getMovementPathType(savedPath);
                    const startCenter = {
                      x: start.x + start.widthMeters / 2,
                      y: start.y + start.heightMeters / 2,
                    };
                    const endCenter = {
                      x: end.x + end.widthMeters / 2,
                      y: end.y + end.heightMeters / 2,
                    };
                    const displayStart = stagePointToDisplayPoint(
                      startCenter,
                      stage,
                      viewerPerspective,
                    );
                    const displayEnd = stagePointToDisplayPoint(
                      endCenter,
                      stage,
                      viewerPerspective,
                    );
                    const control = savedPath?.controlPoint
                      ? stagePointToDisplayPoint(
                          savedPath.controlPoint,
                          stage,
                          viewerPerspective,
                        )
                      : null;
                    const startX = (displayStart.x / stage.widthMeters) * 100;
                    const startY = (displayStart.y / stage.depthMeters) * 100;
                    const endX = (displayEnd.x / stage.widthMeters) * 100;
                    const endY = (displayEnd.y / stage.depthMeters) * 100;
                    const controlPercent = control
                      ? {
                          x: (control.x / stage.widthMeters) * 100,
                          y: (control.y / stage.depthMeters) * 100,
                        }
                      : null;
                    const pathD = createMovementPathD(
                      startX,
                      startY,
                      endX,
                      endY,
                      pathType,
                      controlPercent,
                    );
                    if (!pathD) return null;
                    return (
                      <g key={objectId}>
                        <path
                          d={pathD}
                          className={["movement-path", "is-object", `path-${pathType}`].join(" ")}
                          markerEnd="url(#movement-arrow)"
                          stroke={object.color}
                        />
                        {controlPercent && (
                          <circle
                            cx={controlPercent.x}
                            cy={controlPercent.y}
                            r={1}
                            className="movement-control-point"
                          />
                        )}
                        <circle cx={endX} cy={endY} r={0.9} fill={object.color} />
                      </g>
                    );
                  })}
                </svg>
              )}
              {mode === "animation" && toSnapshot && (
                <>
                  {project.stageObjects.map((object) => {
                    const objectState = toSnapshot.objectStates[object.id];
                    if (!objectState?.visible) return null;
                    const displayTopLeft =
                      viewerPerspective === "performer"
                        ? {
                            x:
                              stage.widthMeters -
                              objectState.x -
                              objectState.widthMeters,
                            y:
                              stage.depthMeters -
                              objectState.y -
                              objectState.heightMeters,
                          }
                        : { x: objectState.x, y: objectState.y };
                    return (
                      <div
                        key={`next-object-${object.id}`}
                        className={`transition-object-ghost shape-${object.shape}`}
                        style={{
                          left: `${(displayTopLeft.x / stage.widthMeters) * 100}%`,
                          top: `${(displayTopLeft.y / stage.depthMeters) * 100}%`,
                          width: `${(objectState.widthMeters / stage.widthMeters) * 100}%`,
                          height: `${(objectState.heightMeters / stage.depthMeters) * 100}%`,
                          borderColor: object.color,
                          backgroundColor: `${object.color}18`,
                          transform: `rotate(${objectState.rotation}deg)`,
                          zIndex: objectState.zIndex + 1,
                        }}
                      >
                        <span>{object.name} 次</span>
                      </div>
                    );
                  })}
                  {project.members
                    .filter(
                      (member) =>
                        (member.visible ?? true) &&
                        isSnapshotMemberVisible(toSnapshot, member.id),
                    )
                    .map((member) => {
                      const position = toSnapshot.positions[member.id];
                      if (!position) return null;
                      const memberColor = getMemberDisplayColor(member, {
                        groups: memberGroups,
                        snapshot: toSnapshot,
                      });
                      const displayPosition = stagePointToDisplayPoint(
                        position,
                        stage,
                        viewerPerspective,
                      );
                      return (
                        <div
                          key={`next-member-${member.id}`}
                          className="transition-member-ghost"
                          style={{
                          left: `${(displayPosition.x / stage.widthMeters) * 100}%`,
                          top: `${(displayPosition.y / stage.depthMeters) * 100}%`,
                          ...memberSizeStyle,
                          borderColor: memberColor,
                          color: memberColor,
                        }}
                        >
                          {member.name}
                        </div>
                      );
                    })}
                </>
              )}
              {visibleObjects.map((object) => {
                const objectState = snapshot.objectStates[object.id];
                if (!objectState) {
                  return null;
                }
                const remoteObjectLockOwner = remoteObjectLocks[object.id] ?? null;
                return (
                  <ResizableRotatableObject
                    editScope={editScope}
                    key={object.id}
                    object={object}
                    state={objectState}
                    stage={stage}
                    viewerPerspective={viewerPerspective}
                    selected={selected?.type === "object" && selected.id === object.id}
                    disabled={!objectEditing || isReadOnly}
                    deferCommit={deferObjectDragCommit}
                    ephemeral={ephemeral}
                    sceneId={selectedFrameId}
                    remoteLockOwner={remoteObjectLockOwner}
                    onSelect={() => selectPointerTarget({ type: "object", id: object.id })}
                    onContextMenu={(event) =>
                      openContextMenu(event, { type: "object", id: object.id })
                    }
                    onTouchLongPressStart={(event) =>
                      startTouchContextMenu(event, { type: "object", id: object.id })
                    }
                    onTouchLongPressMove={trackTouchContextMenuMove}
                    onTouchLongPressEnd={stopTouchContextMenu}
                    onMove={(patch) => onUpdateObjectState(object.id, patch)}
                    resolveMove={(patch) => {
                      if (isReadOnly) {
                        onReadOnlyEditAttempt?.();
                        return patch;
                      }
                      if (patch.x === undefined && patch.y === undefined) {
                        return patch;
                      }
                      const width = patch.widthMeters ?? objectState.widthMeters;
                      const height = patch.heightMeters ?? objectState.heightMeters;
                      const center = {
                        x: (patch.x ?? objectState.x) + width / 2,
                        y: (patch.y ?? objectState.y) + height / 2,
                      };
                      const guided = applySnapGuides(center, {
                        type: "object",
                        id: object.id,
                      });
                      const guidedTopLeft = constrainObjectPosition(
                        {
                          x: roundMeters(guided.position.x - width / 2),
                          y: roundMeters(guided.position.y - height / 2),
                        },
                        { widthMeters: width, heightMeters: height, rotation: patch.rotation ?? objectState.rotation },
                        stage,
                      );
                      setActiveSnapGuides(guided.guides.filter(guide => guide.axis === "x"
                        ? Math.abs(guidedTopLeft.x + width / 2 - guided.position.x) < 0.001
                        : Math.abs(guidedTopLeft.y + height / 2 - guided.position.y) < 0.001));
                      return { ...patch, x: guidedTopLeft.x, y: guidedTopLeft.y };
                    }}
                    onInteractionStart={(kind) =>
                      isReadOnly
                        ? onReadOnlyEditAttempt?.()
                        : onBeginProjectEdit(
                            kind === "resize"
                              ? "道具サイズ変更"
                              : kind === "rotate"
                                ? "道具回転"
                                : "道具移動",
                            { id: object.id, type: "object-state" },
                          )
                    }
                    onInteractionEnd={() => {
                      setActiveSnapGuides([]);
                      onEndProjectEdit({ id: object.id, type: "object-state" });
                    }}
                    onLockedElementEditAttempt={onLockedElementEditAttempt}
                  />
                );
              })}
              {visibleStageMembers.map((member) => {
                  const position = snapshot.positions[member.id];
                  if (!position) return null;
                  const constrainedPosition = constrainMemberPosition(
                    position,
                    stage,
                  );
                  const displayPosition = stagePointToDisplayPoint(
                    constrainedPosition,
                    stage,
                    viewerPerspective,
                  );
                  const isSelected =
                    selected?.type === "member" && selected.id === member.id;
                  const isFocus = focusMemberId === member.id;
                  const isDimmed = focusMode && Boolean(focusMemberId) && !isFocus;
                  const remoteMemberLockOwner = remoteMemberLocks[member.id] ?? null;
                  const { lines: labelLines, className: memberLabelClassName } = memberLabels.get(member.id)!;
                  const { color: memberColor, labelColor } = memberColors.get(member.id)!;
                  const overlapOffset =
                    memberDisplayOffsets.get(member.id) ?? { x: 0, y: 0 };
                  return (
                    <StageMemberToken
                      key={member.id}
                      memberId={member.id}
                      name={member.name}
                      showLabel
                      handlers={memberTokenHandlers}
                      className={[
                        "member-token",
                        isSelected || selectedMemberIds.includes(member.id)
                          ? "is-selected"
                          : "",
                        isFocus ? "is-focus" : "",
                        isDimmed ? "is-dimmed" : "",
                        remoteMemberLockOwner ? "is-remote-locked" : "",
                        memberLabelClassName,
                      ].join(" ")}
                      style={{
                        "--member-overlap-x": `${overlapOffset.x}px`,
                        "--member-overlap-y": `${overlapOffset.y}px`,
                        left: `${(displayPosition.x / stage.widthMeters) * 100}%`,
                        top: `${(displayPosition.y / stage.depthMeters) * 100}%`,
                        ...memberSizeStyle,
                        backgroundColor: memberColor,
                        color: labelColor,
                        fontSize: `${getMemberLabelFontSize(
                          visibleStageSize.pxPerMeter * memberDiameterMeters,
                          labelLines,
                        )}px`,
                        textShadow:
                          labelColor === "#ffffff"
                            ? "0 1px 2px rgba(15, 23, 42, 0.48)"
                            : "0 1px 1px rgba(255, 255, 255, 0.56)",
                        zIndex: member.zIndex ?? 20,
                      } as MemberTokenStyle}
                      title={
                        remoteMemberLockOwner
                          ? `${member.name}（${remoteMemberLockOwner}が操作中です）`
                          : member.name
                      }
                    >
                    </StageMemberToken>
                  );
                })}
              </div>
              </div>
              <div
                className="meter-ruler meter-ruler--vertical meter-ruler--vertical-right"
                aria-hidden="true"
              >
                {verticalTicks.map((tick) => (
                  <span
                    key={`y-right-${tick}`}
                    className="meter-ruler__tick"
                    data-position={viewerPerspective === "performer" ? stage.depthMeters - tick : tick}
                    style={{ top: stageRulerPosition(tick, stage.depthMeters) }}
                  >
                    {coordinateLabel(
                      "y",
                      tick,
                      stage.widthMeters,
                      stage.depthMeters,
                      originMode,
                      frontDirection,
                      viewerPerspective,
                    )}
                  </span>
                ))}
              </div>
            </div>
            </div>
            </div>
          </div>
        </div>
      </main>
    );
  },
);

StageCanvas.displayName = "StageCanvas";

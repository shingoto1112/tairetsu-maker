import {
  Camera,
  FlipHorizontal2,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Save,
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
  WheelEvent as ReactWheelEvent,
  useEffect,
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
  snapToGrid,
} from "../utils/coordinates";
import {
  getMovementPathType,
  getSnapshotForFrame,
  isAnimationEnabledForTarget,
  resolveMovementPlan,
  sortFrames,
} from "../utils/interpolation";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../utils/memberAppearance";
import { formatTime } from "../utils/time";
import { ResizableRotatableObject } from "./ResizableRotatableObject";
import { StageTimeBar } from "./StageTimeBar";

type StageCanvasProps = {
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
  focusMemberId?: string;
  focusMode: boolean;
  currentTime: number;
  audioDuration: number;
  audioName: string | null;
  onSelect: (selection: Selection) => void;
  onStagePointerPositionChange: (position: Position) => void;
  onMoveMember: (id: string, position: Position) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBeginProjectEdit: (label?: string) => void;
  onEndProjectEdit: () => void;
  onTogglePlayback: () => void;
  onSaveFrame: () => void;
  onCaptureStageImage: () => void;
  onTogglePerspective: () => void;
  onToggleFullscreen: () => void;
  onSeekAudio: (timeSec: number) => void;
  onContextMenuRequest: (request: StageContextMenuRequest) => void;
};

type MemberDrag = {
  pointerId: number;
  memberId: string;
  startClientX: number;
  startClientY: number;
  startPointer: Position;
  startPosition: Position;
  hasMoved: boolean;
};

type StageTouchPoint = {
  clientX: number;
  clientY: number;
};

type StagePinchZoom = {
  pointerIds: [number, number];
  startDistance: number;
  startZoom: number;
};

type StagePanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  hasMoved: boolean;
};

type SnapGuide = {
  axis: "x" | "y";
  value: number;
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

type MemberTokenStyle = CSSProperties & {
  "--member-overlap-x": string;
  "--member-overlap-y": string;
};

const RULER_LABEL_WIDTH_PX = 30;
const RULER_LABEL_HEIGHT_PX = 20;
const RULER_BOTTOM_PADDING_PX = 18;
const MEMBER_OVERLAP_KEY_SCALE = 100;
const STAGE_ZOOM_MIN = 1;
const STAGE_ZOOM_MAX = 4;
const STAGE_ZOOM_STEP = 0.25;

const createMajorTicks = (lengthMeters: number): number[] => {
  const safeLength = Math.max(0, lengthMeters);
  const step = safeLength <= 16 ? 1 : Math.ceil(safeLength / 12);
  const ticks: number[] = [];
  for (let value = 0; value < safeLength; value += step) {
    ticks.push(value);
  }
  if (!ticks.includes(safeLength)) {
    ticks.push(safeLength);
  }
  return ticks;
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

const oppositeDirection: Record<FrontDirection, FrontDirection> = {
  bottom: "top",
  top: "bottom",
  left: "right",
  right: "left",
};

const directionClass = (
  direction: FrontDirection,
  viewerPerspective: ViewerPerspective,
): string =>
  `pos-${viewerPerspective === "performer" ? oppositeDirection[direction] : direction}`;

const formatMeter = (value: number): string => {
  const rounded = Math.abs(value) < 0.001 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}m`;
};

const formatDepthMeter = (value: number): string => {
  const rounded = Math.abs(value) < 0.001 ? 0 : value;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}m`;
};

const createStageGridTicks = (lengthMeters: number, stepMeters: number) => {
  const safeLength = Math.max(0, lengthMeters);
  const safeStep = Number.isFinite(stepMeters) && stepMeters > 0 ? stepMeters : 1;
  const ticks: number[] = [];
  for (let value = 0; value <= safeLength + 0.001; value += safeStep) {
    ticks.push(roundMeters(value));
  }
  const roundedEnd = roundMeters(safeLength);
  if (!ticks.some((tick) => Math.abs(tick - roundedEnd) < 0.001)) {
    ticks.push(roundedEnd);
  }
  return Array.from(new Set(ticks)).sort((a, b) => a - b);
};

const splitMemberLabel = (name: string): string[] => {
  const trimmed = name.trim();
  if (!trimmed) {
    return [""];
  }
  const characters = Array.from(trimmed);
  const hasWideCharacters = /[^\u0020-\u007e]/.test(trimmed);
  if (characters.length <= 3 || (characters.length <= 4 && !hasWideCharacters)) {
    return [trimmed];
  }
  const midpoint = Math.ceil(characters.length / 2);
  return [
    characters.slice(0, midpoint).join(""),
    characters.slice(midpoint).join(""),
  ].filter(Boolean);
};

const getMemberLabelFontSize = (
  diameterPx: number,
  labelLines: string[],
): number => {
  const safeDiameter = Math.max(16, diameterPx);
  const longestLine = Math.max(
    1,
    ...labelLines.map((line) => Array.from(line).length),
  );
  const lineCount = Math.max(1, labelLines.length);
  if (lineCount === 1 && longestLine === 3) {
    return Math.round(Math.max(18, safeDiameter * 0.62) * 10) / 10;
  }
  const widthBased = (safeDiameter * 0.9) / Math.max(1.8, longestLine * 0.74);
  const heightBased = (safeDiameter * 0.82) / lineCount;
  const maxReadable = safeDiameter * (lineCount === 1 ? 0.56 : 0.46);
  return Math.round(Math.max(8, Math.min(maxReadable, widthBased, heightBased)) * 10) / 10;
};

const isThreeCharacterLabel = (labelLines: string[]): boolean =>
  labelLines.length === 1 && Array.from(labelLines[0] ?? "").length === 3;

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
      focusMemberId,
      focusMode,
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
    },
    exportRef,
  ) => {
    const stageRef = useRef<HTMLDivElement | null>(null);
    const fitAreaRef = useRef<HTMLDivElement | null>(null);
    const memberDragRef = useRef<MemberDrag | null>(null);
    const stageTouchPointsRef = useRef(new Map<number, StageTouchPoint>());
    const stagePinchZoomRef = useRef<StagePinchZoom | null>(null);
    const stagePanRef = useRef<StagePanState | null>(null);
    const pendingStageZoomRef = useRef<{
      zoom: number;
      anchor?: { clientX: number; clientY: number };
    } | null>(null);
    const stageZoomFrameRef = useRef<number | null>(null);
    const stageZoomRef = useRef(1);
    const isStagePinchLockedRef = useRef(false);
    const [fitAreaSize, setFitAreaSize] = useState({ width: 0, height: 0 });
    const [isStageInteracting, setIsStageInteracting] = useState(false);
    const [isStagePinching, setIsStagePinching] = useState(false);
    const [isStagePanning, setIsStagePanning] = useState(false);
    const [isMemberDragging, setIsMemberDragging] = useState(false);
    const [activeSnapGuides, setActiveSnapGuides] = useState<SnapGuide[]>([]);
    const [stageZoom, setStageZoom] = useState(1);
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
    const memberEditing = mode === "members" && !isPlaying;
    const objectEditing = mode === "objects" && !isPlaying;
    const isDenseProject = project.members.length >= 120;
    const simplifyMemberLabels =
      isDenseProject && (isMemberDragging || isStagePinching || isStagePanning);
    const horizontalTicks = useMemo(
      () => createMajorTicks(stage.widthMeters),
      [stage.widthMeters],
    );
    const centerSplitLabels = useMemo(
      () => createCenterSplitLabels(stage.widthMeters),
      [stage.widthMeters],
    );
    const horizontalGuideMode = stage.horizontalGuideMode ?? "meters";
    const verticalTicks = useMemo(
      () => createMajorTicks(stage.depthMeters),
      [stage.depthMeters],
    );

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

      let resizeFrame = 0;
      const scheduleMeasuredSize = (width: number, height: number) => {
        if (resizeFrame) {
          window.cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          setMeasuredSize(width, height);
        });
      };

      const rect = element.getBoundingClientRect();
      setMeasuredSize(rect.width, rect.height);

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        // 外側の表示領域だけを基準にし、選択枠やハンドルの微小な揺れは倍率へ反映しない。
        scheduleMeasuredSize(entry.contentRect.width, entry.contentRect.height);
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
      pendingStageZoomRef.current = null;
      if (stageZoomFrameRef.current !== null) {
        window.cancelAnimationFrame(stageZoomFrameRef.current);
        stageZoomFrameRef.current = null;
      }
    };

    const clearStagePinch = () => {
      stageTouchPointsRef.current.clear();
      stagePinchZoomRef.current = null;
      setIsStagePinching(false);
    };

    const clearStagePan = () => {
      stagePanRef.current = null;
      setIsStagePanning(false);
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
      },
      [],
    );

    useEffect(() => {
      if (!isStageInteracting) {
        return undefined;
      }
      const releaseFitLock = () => {
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
      const memberBleedMeters = showMeterRulers ? memberDiameterMeters / 2 : 0;
      const availableWidth = Math.max(0, fitWidth - rulerLabelWidth);
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
              availableWidth / (safeWidthMeters + memberBleedMeters),
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

    const scheduleStageZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      const clampedZoom = clampStageZoom(nextZoom);
      stageZoomRef.current = clampedZoom;
      pendingStageZoomRef.current = { zoom: clampedZoom, anchor };
      if (stageZoomFrameRef.current !== null) {
        return;
      }
      stageZoomFrameRef.current = window.requestAnimationFrame(() => {
        stageZoomFrameRef.current = null;
        const pending = pendingStageZoomRef.current;
        pendingStageZoomRef.current = null;
        if (!pending) {
          return;
        }
        applyStageZoom(pending.zoom, pending.anchor);
      });
    };

    const updateStageZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      cancelPendingStageZoom();
      applyStageZoom(nextZoom, anchor);
    };

    const handleStageWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      if (isStagePinchLockedRef.current) {
        return;
      }
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
      updateStageZoom(stageZoom * factor, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

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
      if (isStagePinchLockedRef.current) {
        return;
      }
      const touchEntries = Array.from(stageTouchPointsRef.current.entries());
      if (touchEntries.length < 2) {
        return;
      }
      const [firstEntry, secondEntry] = touchEntries;
      const startDistance = Math.max(
        1,
        getTouchDistance(firstEntry[1], secondEntry[1]),
      );
      stagePinchZoomRef.current = {
        pointerIds: [firstEntry[0], secondEntry[0]],
        startDistance,
        startZoom: stageZoomRef.current,
      };
      const activeMemberDrag = memberDragRef.current;
      clearStagePan();
      memberDragRef.current = null;
      setIsMemberDragging(false);
      if (activeMemberDrag?.hasMoved) {
        onEndProjectEdit();
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
      if (canPanStageFromTarget(event.target) && fitAreaRef.current) {
        stagePanRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: fitAreaRef.current.scrollLeft,
          startScrollTop: fitAreaRef.current.scrollTop,
          hasMoved: false,
        };
      }
      if (isStagePinchLockedRef.current) {
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
      const pan = stagePanRef.current;
      if (
        event.pointerType === "touch" &&
        pan?.pointerId === event.pointerId &&
        !stagePinchZoomRef.current &&
        fitAreaRef.current
      ) {
        const dx = event.clientX - pan.startClientX;
        const dy = event.clientY - pan.startClientY;
        if (pan.hasMoved || Math.abs(dx) > 2 || Math.abs(dy) > 2) {
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
        isStagePinchLockedRef.current ||
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
        pinch.startZoom * (distance / pinch.startDistance),
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
      if (stagePanRef.current?.pointerId === event.pointerId) {
        clearStagePan();
      }
      stageTouchPointsRef.current.delete(event.pointerId);
      if (stageTouchPointsRef.current.size < 2) {
        stagePinchZoomRef.current = null;
        setIsStagePinching(false);
        return;
      }
      beginStagePinchIfReady();
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
      const constrained = constrainMemberPosition(pointer, stage);
      onStagePointerPositionChange({
        x: roundMeters(constrained.x),
        y: roundMeters(constrained.y),
      });
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

    const openContextMenu = (
      event: ReactMouseEvent<HTMLElement>,
      target: StageContextMenuRequest["target"],
    ) => {
      if (!stageRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pointer = clientPointToMeters(
        event.clientX,
        event.clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      const constrained = constrainMemberPosition(pointer, stage);
      onStagePointerPositionChange(constrained);
      onContextMenuRequest({
        clientX: event.clientX,
        clientY: event.clientY,
        stagePosition: constrained,
        target,
      });
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
      onSelect({ type: "member", id: memberId });
      if (!memberEditing || !stageRef.current) {
        return;
      }
      const startPointer = clientPointToMeters(
        event.clientX,
        event.clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      memberDragRef.current = {
        pointerId: event.pointerId,
        memberId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPointer,
        startPosition: snapshot.positions[memberId] ?? { x: 0, y: 0 },
        hasMoved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleMemberPointerMove = (event: PointerEvent<HTMLDivElement>) => {
      if (stagePinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const drag = memberDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !stageRef.current) {
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
        onBeginProjectEdit("メンバー移動");
        drag.hasMoved = true;
        setIsMemberDragging(true);
      }
      const pointer = clientPointToMeters(
        event.clientX,
        event.clientY,
        stageRef.current,
        stage,
        viewerPerspective,
      );
      const next = constrainMemberPosition(
        {
          x: snapToGrid(
            drag.startPosition.x + pointer.x - drag.startPointer.x,
            stage.gridSizeMeters,
            stage.showGrid,
          ),
          y: snapToGrid(
            drag.startPosition.y + pointer.y - drag.startPointer.y,
            stage.gridSizeMeters,
            stage.showGrid,
          ),
        },
        stage,
      );
      const guided = applySnapGuides(next, {
        type: "member",
        id: drag.memberId,
      });
      setActiveSnapGuides(guided.guides);
      onMoveMember(drag.memberId, constrainMemberPosition(guided.position, stage));
    };

    const stopMemberDrag = (event: PointerEvent<HTMLDivElement>) => {
      const drag = memberDragRef.current;
      if (drag?.pointerId === event.pointerId) {
        memberDragRef.current = null;
        setActiveSnapGuides([]);
        if (drag.hasMoved) {
          onEndProjectEdit();
        }
        setIsMemberDragging(false);
      }
    };

    const stageGridVerticalTicks = useMemo(
      () =>
        stage.showGrid && stage.gridSizeMeters > 0
          ? createStageGridTicks(stage.widthMeters, stage.gridSizeMeters)
          : [],
      [stage.gridSizeMeters, stage.showGrid, stage.widthMeters],
    );
    const stageGridHorizontalTicks = useMemo(
      () =>
        stage.showGrid && stage.gridSizeMeters > 0
          ? createStageGridTicks(stage.depthMeters, stage.gridSizeMeters)
          : [],
      [stage.depthMeters, stage.gridSizeMeters, stage.showGrid],
    );

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
      if (movementPathMode === "focus" && focusMemberId) {
        const focusMember = project.members.find((member) => member.id === focusMemberId);
        return (focusMember?.visible ?? true) &&
          isSnapshotMemberVisible(fromSnapshot, focusMemberId)
          ? [focusMemberId]
          : [];
      }
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
      focusMemberId,
      fromSnapshot,
      movementPathMode,
      project.members,
      selectedMemberIds,
      toSnapshot,
    ]);
    const pathObjectIds = useMemo(() => {
      if (!toSnapshot || movementPathMode === "focus") return [];
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

    return (
      <main className="stage-area">
        <div className="stage-frame">
          <div className="stage-export-header">
            <div className="stage-primary-controls">
              <button
                className="mini-button icon-only undo-redo-button"
                onClick={onUndo}
                disabled={!canUndo}
                type="button"
                title="元に戻す（Ctrl+Z）"
              >
                <Undo2 size={17} />
                <span className="sr-only">元に戻す</span>
              </button>
              <button
                className="mini-button icon-only undo-redo-button"
                onClick={onRedo}
                disabled={!canRedo}
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
              <button
                className="mini-button"
                onClick={onSaveFrame}
                type="button"
                title="現在のシーンを保存"
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
                  className="mini-button icon-only stage-zoom-button"
                  onClick={() => updateStageZoom(stageZoom - STAGE_ZOOM_STEP)}
                  disabled={stageZoom <= STAGE_ZOOM_MIN + 0.001}
                  type="button"
                  title="ステージを縮小"
                  aria-label="ステージを縮小"
                >
                  <ZoomOut size={15} />
                </button>
                <button
                  className="stage-zoom-reset"
                  onClick={() => updateStageZoom(STAGE_ZOOM_MIN)}
                  type="button"
                  title="全体表示に戻す"
                  aria-label="ステージを全体表示に戻す"
                >
                  {Math.round(stageZoom * 100)}%
                </button>
                <button
                  className="mini-button icon-only stage-zoom-button"
                  onClick={() => updateStageZoom(stageZoom + STAGE_ZOOM_STEP)}
                  disabled={stageZoom >= STAGE_ZOOM_MAX - 0.001}
                  type="button"
                  title="ステージを拡大"
                  aria-label="ステージを拡大"
                >
                  <ZoomIn size={15} />
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
                title="観客側視点 / 踊る人側視点"
              >
                <FlipHorizontal2 size={15} />
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
          </div>
          {showMeterRulers && (
            <div className="ruler-reference-labels">
              <span>
                {horizontalGuideMode === "centerSplit"
                  ? "横: センター割り表示（中心0は空欄）"
                  : "横: センター0m（左がマイナス / 右がプラス）"}
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
              isStageZoomed ? "is-stage-zoomed" : "",
              isStagePinching ? "is-stage-pinching" : "",
              isStagePanning ? "is-stage-panning" : "",
              isStagePinchLocked ? "is-stage-pinch-locked" : "",
            ].join(" ")}
            ref={fitAreaRef}
            onWheel={handleStageWheel}
            onPointerDownCapture={handleStagePointerDownCapture}
            onPointerMoveCapture={handleStagePointerMoveCapture}
            onPointerUpCapture={handleStagePointerEndCapture}
            onPointerCancelCapture={handleStagePointerEndCapture}
          >
            <div
              ref={exportRef}
              className={
                showMeterRulers
                  ? "stage-canvas-with-rulers"
                  : "stage-canvas-with-rulers hide-rulers"
              }
              style={{
                gridTemplateColumns: showMeterRulers
                  ? `${visibleStageSize.rulerWidth}px ${visibleStageSize.widthPx}px`
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
                {horizontalGuideMode === "centerSplit"
                  ? centerSplitLabels.map((item) => (
                      <span
                        key={`center-split-${item.key}`}
                        className="meter-ruler__tick meter-ruler__tick--label-only"
                        style={{
                          left: `${(item.positionMeters / stage.widthMeters) * 100}%`,
                        }}
                      >
                        {item.label}
                      </span>
                    ))
                  : horizontalTicks.map((tick) => (
                      <span
                        key={`x-${tick}`}
                        className="meter-ruler__tick"
                        style={{ left: `${(tick / stage.widthMeters) * 100}%` }}
                      >
                        {coordinateLabel(
                          "x",
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
              <div className="meter-ruler meter-ruler--vertical" aria-hidden="true">
                {verticalTicks.map((tick) => (
                  <span
                    key={`y-${tick}`}
                    className="meter-ruler__tick"
                    style={{ top: `${(tick / stage.depthMeters) * 100}%` }}
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
                  onSelect(null);
                }}
                onPointerEnter={updateStagePointerPosition}
                onPointerMove={updateStagePointerPosition}
                onContextMenu={(event) => openContextMenu(event, { type: "stage" })}
              >
              {stage.showGrid && (
                <div className="stage-grid-layer" aria-hidden="true">
                  {stageGridVerticalTicks.map((tick) => (
                    <span
                      className="stage-grid-line stage-grid-line--vertical"
                      key={`stage-grid-x-${tick}`}
                      style={{ left: `${(tick / stage.widthMeters) * 100}%` }}
                    />
                  ))}
                  {stageGridHorizontalTicks.map((tick) => (
                    <span
                      className="stage-grid-line stage-grid-line--horizontal"
                      key={`stage-grid-y-${tick}`}
                      style={{ top: `${(tick / stage.depthMeters) * 100}%` }}
                    />
                  ))}
                </div>
              )}
              {stage.showStageLabels && (
                <>
                  <span
                    className={`stage-label audience ${directionClass(
                      frontDirection,
                      viewerPerspective,
                    )}`}
                  >
                    客席側
                  </span>
                  <span
                    className={`stage-label upstage ${directionClass(
                      oppositeDirection[frontDirection],
                      viewerPerspective,
                    )}`}
                  >
                    奥
                  </span>
                  <span
                    className={`stage-label stage-left ${
                      frontDirection === "left" || frontDirection === "right"
                        ? directionClass("top", viewerPerspective)
                        : directionClass("left", viewerPerspective)
                    }`}
                  >
                    上手
                  </span>
                  <span
                    className={`stage-label stage-right ${
                      frontDirection === "left" || frontDirection === "right"
                        ? directionClass("bottom", viewerPerspective)
                        : directionClass("right", viewerPerspective)
                    }`}
                  >
                    下手
                  </span>
                </>
              )}
              {stage.showCenterLine && <span className="center-line" />}
              {(stage.showCenterMarker ?? true) && (
                <span className="center-marker" aria-hidden="true" />
              )}
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
                return (
                  <ResizableRotatableObject
                    key={object.id}
                    object={object}
                    state={objectState}
                    stage={stage}
                    viewerPerspective={viewerPerspective}
                    selected={selected?.type === "object" && selected.id === object.id}
                    disabled={!objectEditing}
                    onSelect={() => onSelect({ type: "object", id: object.id })}
                    onContextMenu={(event) =>
                      openContextMenu(event, { type: "object", id: object.id })
                    }
                    onMove={(patch) => {
                      if (patch.x === undefined && patch.y === undefined) {
                        onUpdateObjectState(object.id, patch);
                        return;
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
                        width,
                        height,
                        stage,
                      );
                      setActiveSnapGuides(guided.guides);
                      onUpdateObjectState(object.id, {
                        ...patch,
                        x: guidedTopLeft.x,
                        y: guidedTopLeft.y,
                      });
                    }}
                    onInteractionStart={(kind) =>
                      onBeginProjectEdit(
                        kind === "resize"
                          ? "道具サイズ変更"
                          : kind === "rotate"
                            ? "道具回転"
                            : "道具移動",
                      )
                    }
                    onInteractionEnd={() => {
                      setActiveSnapGuides([]);
                      onEndProjectEdit();
                    }}
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
                  const labelLines = splitMemberLabel(member.name);
                  const hasThreeCharacterLabel = isThreeCharacterLabel(labelLines);
                  const memberColor = getMemberDisplayColor(member, {
                    groups: memberGroups,
                    snapshot,
                  });
                  const labelColor = getReadableMemberLabelColor(memberColor);
                  const overlapOffset =
                    memberDisplayOffsets.get(member.id) ?? { x: 0, y: 0 };
                  return (
                    <div
                      key={member.id}
                      className={[
                        "member-token",
                        isSelected || selectedMemberIds.includes(member.id)
                          ? "is-selected"
                          : "",
                        isFocus ? "is-focus" : "",
                        isDimmed ? "is-dimmed" : "",
                        hasThreeCharacterLabel ? "member-token--three-character" : "",
                        simplifyMemberLabels && !isSelected && !isFocus
                          ? "is-label-simplified"
                          : "",
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
                      onPointerDown={(event) =>
                        handleMemberPointerDown(event, member.id)
                      }
                      onPointerMove={handleMemberPointerMove}
                      onPointerUp={stopMemberDrag}
                      onPointerCancel={stopMemberDrag}
                      onContextMenu={(event) =>
                        openContextMenu(event, { type: "member", id: member.id })
                      }
                      role="button"
                      tabIndex={0}
                      title={member.name}
                      aria-label={member.name}
                    >
                      {!(simplifyMemberLabels && !isSelected && !isFocus) && (
                        <span className="member-token__label" aria-hidden="true">
                          {labelLines.map((line, index) => (
                            <span
                              className="member-token__label-line"
                              key={`${member.id}-label-${index}`}
                            >
                              {line}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  },
);

StageCanvas.displayName = "StageCanvas";

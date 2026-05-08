import {
  ArrowDownToLine,
  ArrowUpToLine,
  Lock,
  Maximize2,
  Minimize2,
  RotateCcw,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  CSSProperties,
  forwardRef,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ObjectState,
  ParadeSettings,
  Position,
  Project,
  SceneViewState,
  Selection,
  StageSnapshot,
} from "../types";
import { roundMeters } from "../utils/coordinates";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../utils/memberAppearance";
import {
  clampParadeObjectTopY,
  formatSignedMeterLabel,
  normalizeParadeHorizontalMeasureMode,
} from "../utils/parade";
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
  focusMemberId?: string;
  focusMode: boolean;
  onSelect: (selection: Selection) => void;
  onMoveMember: (id: string, position: Position) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
  onBeginProjectEdit: (label?: string) => void;
  onEndProjectEdit: () => void;
  onFrameViewStateChange: (frameId: string, viewState: SceneViewState) => void;
  onReflectPreviousFrame: (options: ParadeReflectOptions) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
};

type DragState =
  | {
      type: "member";
      id: string;
      startClientX: number;
      startClientY: number;
      startPosition: Position;
      hasMoved: boolean;
    }
  | {
      type: "object";
      id: string;
      startClientX: number;
      startClientY: number;
      startState: ObjectState;
      hasMoved: boolean;
    };

type PinchTouchPoint = {
  clientX: number;
  clientY: number;
};

type PinchZoomState = {
  pointerIds: [number, number];
  startDistance: number;
  startZoom: number;
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
  "--member-overlap-x": string;
  "--member-overlap-y": string;
};

const BASE_PX_PER_METER = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const RULER_WIDTH = 58;
const MEMBER_OVERLAP_KEY_SCALE = 100;

const DEFAULT_PARADE_SETTINGS: ParadeSettings = {
  totalDistance: 100,
  width: 20,
  cellSizeMeters: 1,
  direction: "up",
  rulerPosition: "both",
  horizontalMeasureMode: "centerSplit",
  emphasizeEvery5m: true,
  emphasizeEvery10m: true,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const snapMeters = (value: number, gridSize: number) => {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return roundMeters(value);
  }
  return roundMeters(Math.round(value / gridSize) * gridSize);
};

const createMeterGridTicks = (lengthMeters: number, stepMeters: number) => {
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

const isMeterMultiple = (value: number, intervalMeters: number) => {
  if (!Number.isFinite(intervalMeters) || intervalMeters <= 0) {
    return false;
  }
  return Math.abs(value / intervalMeters - Math.round(value / intervalMeters)) < 0.001;
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
  return [characters.slice(0, midpoint).join(""), characters.slice(midpoint).join("")];
};

const getMemberLabelFontSize = (diameterPx: number, labelLines: string[]) => {
  const longestLine = Math.max(1, ...labelLines.map((line) => Array.from(line).length));
  const lineCount = Math.max(1, labelLines.length);
  if (lineCount === 1 && longestLine === 3) {
    return Math.round(Math.max(18, diameterPx * 0.62) * 10) / 10;
  }
  const fitWidth = (diameterPx * 0.9) / Math.max(1.8, longestLine * 0.74);
  const fitHeight = (diameterPx * 0.82) / lineCount;
  const maxReadable = diameterPx * (lineCount === 1 ? 0.56 : 0.46);
  return Math.round(Math.max(8, Math.min(maxReadable, fitWidth, fitHeight)) * 10) / 10;
};

const isThreeCharacterLabel = (labelLines: string[]): boolean =>
  labelLines.length === 1 && Array.from(labelLines[0] ?? "").length === 3;

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
      focusMemberId,
      focusMode,
      onSelect,
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
    const zoomRef = useRef(zoom);
    const pinchTouchPointsRef = useRef(new Map<number, PinchTouchPoint>());
    const pinchZoomRef = useRef<PinchZoomState | null>(null);
    const pendingZoomRef = useRef<{
      zoom: number;
      anchor?: { clientX: number; clientY: number };
    } | null>(null);
    const zoomFrameRef = useRef<number | null>(null);
    const isPinchLockedRef = useRef(false);
    const saveViewTimerRef = useRef<number | null>(null);
    const [isPinching, setIsPinching] = useState(false);
    const [isPinchLocked, setIsPinchLocked] = useState(false);
    const pxPerMeter = BASE_PX_PER_METER * zoom;
    const canvasWidthPx = settings.width * pxPerMeter;
    const canvasHeightPx = settings.totalDistance * pxPerMeter;
    const horizontalRulerHeight = 28;
    const leftRulerVisible =
      settings.rulerPosition === "both" || settings.rulerPosition === "left";
    const rightRulerVisible =
      settings.rulerPosition === "both" || settings.rulerPosition === "right";
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
    const simplifyMemberLabels =
      isDenseProject && (isPinching || Boolean(dragState?.hasMoved));

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
      const ticks: number[] = [];
      for (let value = 0; value <= settings.totalDistance + 0.001; value += 5) {
        ticks.push(roundMeters(value));
      }
      return ticks;
    }, [settings.totalDistance]);

    const gridStepMeters =
      Number.isFinite(settings.cellSizeMeters) && settings.cellSizeMeters > 0
        ? settings.cellSizeMeters
        : 1;
    const verticalGridTicks = useMemo(
      () => createMeterGridTicks(settings.width, gridStepMeters),
      [gridStepMeters, settings.width],
    );
    const horizontalGridTicks = useMemo(
      () => createMeterGridTicks(settings.totalDistance, gridStepMeters),
      [gridStepMeters, settings.totalDistance],
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

    const saveViewState = () => {
      if (!currentFrame?.id || !scrollRef.current) {
        return;
      }
      onFrameViewStateChange(currentFrame.id, {
        scrollTop: scrollRef.current.scrollTop,
        scrollLeft: scrollRef.current.scrollLeft,
        zoom,
      });
    };

    const scheduleSaveViewState = () => {
      if (saveViewTimerRef.current !== null) {
        window.clearTimeout(saveViewTimerRef.current);
      }
      saveViewTimerRef.current = window.setTimeout(saveViewState, 300);
    };

    useEffect(() => {
      setZoom(currentFrame?.sceneViewState?.zoom ?? 1);
    }, [currentFrame?.id, currentFrame?.sceneViewState?.zoom]);

    useEffect(() => {
      zoomRef.current = zoom;
    }, [zoom]);

    const cancelPendingZoom = () => {
      pendingZoomRef.current = null;
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
    };

    const clearPinch = () => {
      pinchTouchPointsRef.current.clear();
      pinchZoomRef.current = null;
      setIsPinching(false);
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
          container.scrollLeft = frameViewState.scrollLeft;
          return;
        }
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
        if (frameId) {
          onFrameViewStateChange(frameId, {
            scrollTop: container.scrollTop,
            scrollLeft: container.scrollLeft,
            zoom,
          });
        }
      });
      return () => window.cancelAnimationFrame(raf);
    }, [currentFrame?.id, currentFrame?.sceneViewState, onFrameViewStateChange, zoom]);

    useEffect(
      () => () => {
        if (saveViewTimerRef.current !== null) {
          window.clearTimeout(saveViewTimerRef.current);
        }
        cancelPendingZoom();
      },
      [],
    );

    useEffect(() => {
      if (!dragState) {
        return undefined;
      }
      const handlePointerMove = (event: globalThis.PointerEvent) => {
        const movementPx = Math.hypot(
          event.clientX - dragState.startClientX,
          event.clientY - dragState.startClientY,
        );
        if (movementPx < 3) {
          return;
        }
        const dx = (event.clientX - dragState.startClientX) / pxPerMeter;
        const dy = (event.clientY - dragState.startClientY) / pxPerMeter;
        if (!dragState.hasMoved) {
          onBeginProjectEdit("パレード配置編集");
          setDragState({ ...dragState, hasMoved: true });
        }
        if (dragState.type === "member") {
          const nextPosition = {
            x: clamp(
              snapMeters(dragState.startPosition.x + dx, settings.cellSizeMeters),
              0,
              settings.width,
            ),
            y: clamp(
              snapMeters(dragState.startPosition.y + dy, settings.cellSizeMeters),
              0,
              settings.totalDistance,
            ),
          };
          onMoveMember(dragState.id, nextPosition);
        } else {
          const maxObjectX = Math.max(
            0,
            settings.width - dragState.startState.widthMeters,
          );
          const nextX = clamp(
            snapMeters(dragState.startState.x + dx, settings.cellSizeMeters),
            0,
            maxObjectX,
          );
          const nextY = clampParadeObjectTopY(
            snapMeters(dragState.startState.y + dy, settings.cellSizeMeters),
            dragState.startState.heightMeters,
            settings.totalDistance,
          );
          onUpdateObjectState(dragState.id, { x: nextX, y: nextY });
        }
      };
      const handlePointerUp = () => {
        const shouldEndEdit = dragState.hasMoved;
        setDragState(null);
        if (shouldEndEdit) {
          onEndProjectEdit();
        }
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
      window.addEventListener("pointercancel", handlePointerUp, { once: true });
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }, [
      dragState,
      onEndProjectEdit,
      onBeginProjectEdit,
      onMoveMember,
      onUpdateObjectState,
      pxPerMeter,
      settings.cellSizeMeters,
      settings.totalDistance,
      settings.width,
    ]);

    const applyZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      zoomRef.current = clampedZoom;
      const container = scrollRef.current;
      if (!container || !anchor) {
        setZoom(clampedZoom);
        window.setTimeout(saveViewState, 0);
        return;
      }

      const rect = container.getBoundingClientRect();
      const anchorX = anchor.clientX - rect.left;
      const anchorY = anchor.clientY - rect.top;
      const ratioX = (container.scrollLeft + anchorX) / Math.max(1, container.scrollWidth);
      const ratioY =
        (container.scrollTop + anchorY) / Math.max(1, container.scrollHeight);
      setZoom(clampedZoom);
      window.requestAnimationFrame(() => {
        const nextContainer = scrollRef.current;
        if (!nextContainer) {
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
        saveViewState();
      });
    };

    const scheduleZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      zoomRef.current = clampedZoom;
      pendingZoomRef.current = { zoom: clampedZoom, anchor };
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
        applyZoom(pending.zoom, pending.anchor);
      });
    };

    const updateZoom = (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      cancelPendingZoom();
      applyZoom(nextZoom, anchor);
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
      const touchEntries = Array.from(pinchTouchPointsRef.current.entries());
      if (touchEntries.length < 2) {
        return;
      }
      const [firstEntry, secondEntry] = touchEntries;
      pinchZoomRef.current = {
        pointerIds: [firstEntry[0], secondEntry[0]],
        startDistance: Math.max(
          1,
          getPinchDistance(firstEntry[1], secondEntry[1]),
        ),
        startZoom: zoomRef.current,
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
      scheduleZoom(
        pinch.startZoom * (distance / pinch.startDistance),
        getPinchMidpoint(first, second),
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
      pinchTouchPointsRef.current.delete(event.pointerId);
      if (pinchTouchPointsRef.current.size < 2) {
        pinchZoomRef.current = null;
        setIsPinching(false);
        return;
      }
      beginPinchIfReady();
      window.setTimeout(saveViewState, 0);
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

    const fitAll = () => {
      if (!scrollRef.current) {
        return;
      }
      const horizontalRulers =
        (leftRulerVisible ? RULER_WIDTH : 0) + (rightRulerVisible ? RULER_WIDTH : 0);
      const widthZoom =
        (scrollRef.current.clientWidth - horizontalRulers - 32) /
        (settings.width * BASE_PX_PER_METER);
      const heightZoom =
        (scrollRef.current.clientHeight - 32) /
        (settings.totalDistance * BASE_PX_PER_METER);
      updateZoom(clamp(Math.min(widthZoom, heightZoom), MIN_ZOOM, 1));
      window.setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
          scrollRef.current.scrollLeft = 0;
        }
      }, 0);
    };

    const startMemberDrag = (
      memberId: string,
      position: Position,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSelect({ type: "member", id: memberId });
      setDragState({
        type: "member",
        id: memberId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition: position,
        hasMoved: false,
      });
    };

    const startObjectDrag = (
      objectId: string,
      state: ObjectState,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      if (pinchZoomRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSelect({ type: "object", id: objectId });
      setDragState({
        type: "object",
        id: objectId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startState: state,
        hasMoved: false,
      });
    };

    return (
      <div className="parade-canvas-shell">
        <aside className="parade-control-panel" aria-label="パレード操作">
          <div className="parade-control-panel__header">
            <strong>パレード操作</strong>
            <span>{selectedFrameLabel}</span>
          </div>
          <section className="parade-control-section">
            <h3>前シーン反映</h3>
            <button
              className="mini-button"
              type="button"
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
              <button type="button" className="mini-button" title="全体表示" onClick={fitAll}>
                全体表示
              </button>
              <button type="button" className="mini-button" title="表示を戻す" onClick={jumpToStart}>
                <RotateCcw size={14} />
                戻す
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
          <section className="parade-control-section">
            <h3>編集</h3>
            <div className="parade-control-row">
              <button type="button" className="mini-button" onClick={onUndo} disabled={!canUndo}>
                元に戻す
              </button>
              <button type="button" className="mini-button" onClick={onRedo} disabled={!canRedo}>
                やり直し
              </button>
            </div>
          </section>
        </aside>

        <div
          className={[
            "parade-viewport",
            isPinching ? "is-parade-pinching" : "",
            isPinchLocked ? "is-parade-pinch-locked" : "",
          ].join(" ")}
          ref={scrollRef}
          onScroll={scheduleSaveViewState}
          onPointerDownCapture={handleViewportPointerDownCapture}
          onPointerMoveCapture={handleViewportPointerMoveCapture}
          onPointerUpCapture={handleViewportPointerEndCapture}
          onPointerCancelCapture={handleViewportPointerEndCapture}
        >
          <div
            className="parade-stage-wrap"
            style={{
              gridTemplateColumns: `${leftRulerVisible ? RULER_WIDTH : 0}px ${canvasWidthPx}px ${rightRulerVisible ? RULER_WIDTH : 0}px`,
              gridTemplateRows: `${horizontalRulerHeight}px ${canvasHeightPx}px`,
            }}
            ref={ref}
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
                      className={meter % 10 === 0 ? "major" : "medium"}
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
              style={{
                gridColumn: 2,
                gridRow: 2,
                width: canvasWidthPx,
                height: canvasHeightPx,
              }}
              onPointerDown={() => onSelect(null)}
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
                return (
                  <button
                    key={object.id}
                    type="button"
                    className={`parade-object ${isSelected ? "is-selected" : ""}`}
                    style={{
                      left,
                      top,
                      width,
                      height,
                      borderColor: object.color,
                      background: getObjectFill(object),
                      transform: `rotate(${state.rotation}deg)`,
                      zIndex: state.zIndex,
                    }}
                    onPointerDown={(event) => startObjectDrag(object.id, state, event)}
                  >
                    <span>{object.name}</span>
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
                const labelLines = splitMemberLabel(member.name);
                const hasThreeCharacterLabel = isThreeCharacterLabel(labelLines);
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
                    type="button"
                    className={`parade-member ${isSelected || isMultiSelected ? "is-selected" : ""} ${isFocus ? "is-focus" : ""} ${
                      hasThreeCharacterLabel ? "parade-member--three-character" : ""
                    } ${
                      simplifyMemberLabels && !isSelected && !isMultiSelected && !isFocus
                        ? "is-label-simplified"
                        : ""
                    }`}
                    style={memberStyle}
                    onPointerDown={(event) => startMemberDrag(member.id, position, event)}
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
                      className={meter % 10 === 0 ? "major" : "medium"}
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
    );
  },
);

ParadeCanvas.displayName = "ParadeCanvas";

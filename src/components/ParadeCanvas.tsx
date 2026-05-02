import {
  ArrowDownToLine,
  ArrowUpToLine,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
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
import { getMemberDisplayColor } from "../utils/memberAppearance";

export type ParadeReflectOptions = {
  target: "all" | "group";
  groupId?: string;
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
    }
  | {
      type: "object";
      id: string;
      startClientX: number;
      startClientY: number;
      startState: ObjectState;
    };

const BASE_PX_PER_METER = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const RULER_WIDTH = 58;

const DEFAULT_PARADE_SETTINGS: ParadeSettings = {
  totalDistance: 100,
  width: 20,
  cellSizeMeters: 1,
  direction: "up",
  rulerPosition: "both",
  horizontalMeasureMode: "center",
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
    };
    const [zoom, setZoom] = useState(currentFrame?.sceneViewState?.zoom ?? 1);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [reflectTarget, setReflectTarget] = useState<"all" | "group">("all");
    const [reflectGroupId, setReflectGroupId] = useState(
      project.memberGroups?.[0]?.id ?? "",
    );
    const [reflectMoveMeters, setReflectMoveMeters] = useState(5);
    const [reflectMoveObjects, setReflectMoveObjects] = useState(true);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const saveViewTimerRef = useRef<number | null>(null);
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

    const formatHorizontalTick = (xMeters: number) => {
      if ((settings.horizontalMeasureMode ?? "center") === "normal") {
        return `${xMeters}m`;
      }
      const centered = roundMeters(xMeters - settings.width / 2);
      if (Math.abs(centered) < 0.001) {
        return "0";
      }
      return centered > 0 ? `+${centered}` : `${centered}`;
    };

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
      },
      [],
    );

    useEffect(() => {
      if (!dragState) {
        return undefined;
      }
      const handlePointerMove = (event: globalThis.PointerEvent) => {
        const dx = (event.clientX - dragState.startClientX) / pxPerMeter;
        const dy = (event.clientY - dragState.startClientY) / pxPerMeter;
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
          const nextX = clamp(
            snapMeters(dragState.startState.x + dx, settings.cellSizeMeters),
            0,
            settings.width,
          );
          const nextY = clamp(
            snapMeters(dragState.startState.y + dy, settings.cellSizeMeters),
            0,
            settings.totalDistance,
          );
          onUpdateObjectState(dragState.id, { x: nextX, y: nextY });
        }
      };
      const handlePointerUp = () => {
        setDragState(null);
        onEndProjectEdit();
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
      onMoveMember,
      onUpdateObjectState,
      pxPerMeter,
      settings.cellSizeMeters,
      settings.totalDistance,
      settings.width,
    ]);

    const updateZoom = (nextZoom: number) => {
      setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
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
      event.preventDefault();
      event.stopPropagation();
      onSelect({ type: "member", id: memberId });
      onBeginProjectEdit("パレード配置編集");
      setDragState({
        type: "member",
        id: memberId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition: position,
      });
    };

    const startObjectDrag = (
      objectId: string,
      state: ObjectState,
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect({ type: "object", id: objectId });
      onBeginProjectEdit("パレード配置編集");
      setDragState({
        type: "object",
        id: objectId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startState: state,
      });
    };

    return (
      <div className="parade-canvas-shell">
        <div className="parade-toolbar parade-control-panel">
          <div className="parade-toolbar__main">
            <strong>{selectedFrameLabel}</strong>
            <button
              className="mini-button"
              type="button"
              onClick={() =>
                onReflectPreviousFrame({
                  target: "all",
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
              前へ
              <span className="meter-input compact">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={reflectMoveMeters}
                  onChange={(event) => setReflectMoveMeters(Number(event.target.value))}
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
                  moveMeters: reflectMoveMeters,
                  moveObjects: reflectMoveObjects,
                })
              }
            >
              反映して移動
            </button>
          </div>
          <div className="parade-toolbar__zoom">
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
            <button type="button" className="icon-button" title="全体表示" onClick={fitAll}>
              <Maximize2 size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={isFullscreen ? "フルスクリーンを終了" : "フルスクリーン"}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" className="icon-button" title="表示を戻す" onClick={jumpToStart}>
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        <div className="parade-viewport" ref={scrollRef} onScroll={scheduleSaveViewState}>
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
              {horizontalTicks.map((meter) => (
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
                backgroundSize: `${pxPerMeter}px ${pxPerMeter}px`,
              }}
              onPointerDown={() => onSelect(null)}
            >
              <div
                className="parade-center-line"
                style={{ left: canvasWidthPx / 2 }}
              />
              {meterTicks.map((meter) => {
                const top = (settings.totalDistance - meter) * pxPerMeter;
                const isMajor = meter % 10 === 0 && settings.emphasizeEvery10m;
                const isMedium = meter % 5 === 0 && settings.emphasizeEvery5m;
                return (
                  <div
                    key={`line-${meter}`}
                    className={`parade-distance-line ${isMajor ? "major" : isMedium ? "medium" : ""}`}
                    style={{ top }}
                  />
                );
              })}
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
                      transform: `translate(-50%, -50%) rotate(${state.rotation}deg)`,
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
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={`parade-member ${isSelected || isMultiSelected ? "is-selected" : ""} ${isFocus ? "is-focus" : ""}`}
                    style={{
                      left: position.x * pxPerMeter,
                      top: position.y * pxPerMeter,
                      width: diameter,
                      height: diameter,
                      backgroundColor: color,
                      zIndex: member.zIndex,
                    }}
                    onPointerDown={(event) => startMemberDrag(member.id, position, event)}
                  >
                    <span>{member.name}</span>
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

import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { FormationFrame, Project, StageObject } from "../types";
import {
  createDefaultObjectState,
  getSnapshotForFrame,
  sortFrames,
} from "../utils/interpolation";
import { getMemberDisplayColor } from "../utils/memberAppearance";
import { formatTime } from "../utils/time";

type SceneThumbnailRailProps = {
  project: Project;
  selectedFrameId: string | null;
  collapsed: boolean;
  remoteEditingByFrameId?: Record<string, string>;
  remoteViewingByFrameId?: Record<string, string[]>;
  onToggleCollapsed: () => void;
  onSelectFrame: (frame: FormationFrame) => void;
  onFrameContextMenu?: (
    frame: FormationFrame,
    clientX: number,
    clientY: number,
  ) => void;
};

const getFrameStageSize = (
  project: Project,
  frame: FormationFrame,
): { widthMeters: number; depthMeters: number } => {
  const useGlobal = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  return {
    widthMeters: useGlobal
      ? project.stage.widthMeters
      : frame.stageWidthMeters ?? project.stage.widthMeters,
    depthMeters: useGlobal
      ? project.stage.depthMeters
      : frame.stageDepthMeters ?? project.stage.depthMeters,
  };
};

const objectOpacity = (object: StageObject): number =>
  object.type === "curtain" ? 0.42 : 0.32;

const formatPresenceNames = (names: string[]): string => {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (uniqueNames.length <= 2) {
    return uniqueNames.join("、");
  }
  return `${uniqueNames.slice(0, 2).join("、")}ほか${uniqueNames.length - 2}人`;
};

export const SceneThumbnailRail = memo(function SceneThumbnailRail({
  project,
  selectedFrameId,
  collapsed,
  remoteEditingByFrameId = {},
  remoteViewingByFrameId = {},
  onToggleCollapsed,
  onSelectFrame,
  onFrameContextMenu,
}: SceneThumbnailRailProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const sortedFrames = useMemo(() => sortFrames(project.frames), [project.frames]);
  const isDenseProject = project.members.length >= 120;

  useEffect(() => {
    if (collapsed || !selectedFrameId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = listRef.current?.querySelector<HTMLElement>(
        `[data-thumbnail-frame-id="${selectedFrameId}"]`,
      );
      element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, selectedFrameId]);

  return (
    <aside
      className={
        collapsed
          ? "scene-thumbnail-rail is-collapsed"
          : "scene-thumbnail-rail"
      }
      aria-label="シーンサムネイル"
    >
      <button
        className="scene-thumbnail-rail__toggle"
        onClick={onToggleCollapsed}
        type="button"
        title={collapsed ? "シーンサムネイルを開く" : "シーンサムネイルを閉じる"}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        {!collapsed && <span>シーン</span>}
      </button>

      {!collapsed && (
        <div className="scene-thumbnail-list" ref={listRef}>
          {sortedFrames.length === 0 ? (
            <p className="empty-state compact">シーンがありません。</p>
          ) : (
            sortedFrames.map((frame, index) => {
              const snapshot = getSnapshotForFrame(project, frame.id);
              const stageSize = getFrameStageSize(project, frame);
              const width = Math.max(1, stageSize.widthMeters);
              const depth = Math.max(1, stageSize.depthMeters);
              const isSelected = frame.id === selectedFrameId;
              const remoteEditorName = remoteEditingByFrameId[frame.id];
              const remoteViewerNames = remoteViewingByFrameId[frame.id] ?? [];
              const remoteViewerLabel =
                remoteViewerNames.length > 0
                  ? `${formatPresenceNames(remoteViewerNames)}が閲覧中`
                  : null;
              const statusTitle = [
                remoteEditorName ? `${remoteEditorName}が編集中です` : null,
                remoteViewerLabel,
              ]
                .filter(Boolean)
                .join("\n");
              return (
                <button
                  className={
                    [
                      "scene-thumbnail-card",
                      isSelected ? "is-active" : "",
                      remoteViewerLabel ? "is-remote-viewing" : "",
                      remoteEditorName ? "is-remote-editing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                  data-thumbnail-frame-id={frame.id}
                  key={frame.id}
                  title={statusTitle || undefined}
                  onClick={() => onSelectFrame(frame)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onFrameContextMenu?.(
                      frame,
                      event.clientX,
                      event.clientY,
                    );
                  }}
                  type="button"
                >
                  <div className="scene-thumbnail-card__meta">
                    <strong>{index + 1}</strong>
                    <span>{formatTime(frame.timeSec)}</span>
                  </div>
                  <div className="scene-thumbnail-card__label">
                    {frame.label}
                  </div>
                  {remoteEditorName && (
                    <div className="scene-thumbnail-card__lock">
                      {remoteEditorName}が編集中
                    </div>
                  )}
                  {remoteViewerLabel && !remoteEditorName && (
                    <div className="scene-thumbnail-card__presence">
                      {remoteViewerLabel}
                    </div>
                  )}
                  <svg
                    className="scene-thumbnail-preview"
                    viewBox={`0 0 ${width} ${depth}`}
                    preserveAspectRatio="xMidYMid meet"
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={width}
                      height={depth}
                      rx="0.08"
                      fill="#ffffff"
                      stroke="#d8e2ec"
                      strokeWidth="0.04"
                    />
                    <line
                      x1={width / 2}
                      y1="0"
                      x2={width / 2}
                      y2={depth}
                      stroke="#0d8b78"
                      strokeOpacity="0.35"
                      strokeWidth="0.035"
                    />
                    {project.stageObjects.map((object) => {
                      const state =
                        snapshot.objectStates[object.id] ??
                        createDefaultObjectState(object);
                      if (state.visible === false) {
                        return null;
                      }
                      const objectWidth = Math.max(0.08, state.widthMeters);
                      const objectHeight = Math.max(0.08, state.heightMeters);
                      const x = state.x;
                      const y = state.y;
                      return (
                        <rect
                          key={object.id}
                          x={x}
                          y={y}
                          width={objectWidth}
                          height={objectHeight}
                          rx={object.shape === "circle" ? objectWidth / 2 : 0.06}
                          fill={object.color}
                          fillOpacity={objectOpacity(object)}
                          stroke={object.color}
                          strokeWidth="0.04"
                        />
                      );
                    })}
                    {project.members.map((member) => {
                      if (
                        member.visible === false ||
                        snapshot.memberVisibility[member.id] === false
                      ) {
                        return null;
                      }
                      const position = snapshot.positions[member.id];
                      if (!position) {
                        return null;
                      }
                      return (
                        <circle
                          key={member.id}
                          cx={position.x}
                          cy={position.y}
                          r={isDenseProject ? "0.075" : "0.11"}
                          fill={getMemberDisplayColor(member, {
                            groups: project.memberGroups ?? [],
                            snapshot,
                          })}
                          stroke="#ffffff"
                          strokeWidth={isDenseProject ? "0.025" : "0.04"}
                        />
                      );
                    })}
                  </svg>
                </button>
              );
            })
          )}
        </div>
      )}
    </aside>
  );
});

SceneThumbnailRail.displayName = "SceneThumbnailRail";

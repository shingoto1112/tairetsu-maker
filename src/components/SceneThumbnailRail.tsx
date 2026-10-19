import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { FormationFrame, Project, ViewerPerspective } from "../types";
import { sortFrames } from "../utils/interpolation";
import { SceneThumbnailPreview } from "./SceneThumbnailPreview";
import { useVisibleScenePreviews } from "../hooks/useVisibleScenePreviews";
import { formatTime } from "../utils/time";
import type { ReactNode } from 'react';

type SceneThumbnailRailProps = {
  presenceForScene?: (sceneId: string) => ReactNode;
  project: Project;
  viewerPerspective: ViewerPerspective;
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

const formatPresenceNames = (names: string[]): string => {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (uniqueNames.length <= 2) {
    return uniqueNames.join("、");
  }
  return `${uniqueNames.slice(0, 2).join("、")}ほか${uniqueNames.length - 2}人`;
};

export const SceneThumbnailRail = memo(function SceneThumbnailRail({
  project,
  viewerPerspective,
  selectedFrameId,
  collapsed,
  remoteEditingByFrameId = {},
  remoteViewingByFrameId = {},
  onToggleCollapsed,
  onSelectFrame,
  onFrameContextMenu,
  presenceForScene,
}: SceneThumbnailRailProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const sortedFrames = useMemo(() => sortFrames(project.frames), [project.frames]);
  const selectedIndex = sortedFrames.findIndex(frame => frame.id === selectedFrameId);
  const visibleFrames = useVisibleScenePreviews(listRef, sortedFrames, collapsed);

  useEffect(() => {
    if (collapsed || !selectedFrameId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = listRef.current?.querySelector<HTMLElement>(
        `[data-thumbnail-frame-id="${selectedFrameId}"]`,
      );
      scrollWithinContainer(element ?? null, { behavior: "smooth", block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, selectedFrameId, selectedIndex]);

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
                  {presenceForScene?.(frame.id)}
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
                  <SceneThumbnailPreview
                    project={project}
                    viewerPerspective={viewerPerspective}
                    frame={frame}
                    visible={isSelected || visibleFrames.has(frame.id)}
                  />
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

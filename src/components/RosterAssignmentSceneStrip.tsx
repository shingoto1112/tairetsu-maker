import { useEffect, useMemo, useRef } from "react";
import type { FormationFrame, Project } from "../types";
import { sortFrames } from "../utils/interpolation";
import { formatTime } from "../utils/time";
import { useVisibleScenePreviews } from "../hooks/useVisibleScenePreviews";
import { SceneThumbnailPreview } from "./SceneThumbnailPreview";
import "./rosterAssignmentPreview.css";

type Props = {
  project: Project;
  frames: FormationFrame[];
  selectedFrameId: string | null;
  onSelectFrame: (frameId: string) => void;
};

/** Horizontal scene picker for the roster assignment screen. Selection only; no editing menus. */
export const RosterAssignmentSceneStrip = ({ project, frames, selectedFrameId, onSelectFrame }: Props) => {
  const listRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortFrames(frames), [frames]);
  const visible = useVisibleScenePreviews(listRef, sorted, false);
  useEffect(() => {
    if (!selectedFrameId) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-thumbnail-frame-id="${selectedFrameId}"]`);
    card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedFrameId]);
  return <div className="roster-scene-strip" ref={listRef} role="group" aria-label="シーン">
    {sorted.map((frame, index) => <button type="button" key={frame.id} data-thumbnail-frame-id={frame.id}
      className="roster-scene-strip__card" aria-pressed={frame.id === selectedFrameId}
      aria-label={`${index + 1}. ${frame.label} ${formatTime(frame.timeSec)}`}
      onClick={() => onSelectFrame(frame.id)}>
      <SceneThumbnailPreview project={project} frame={frame} visible={visible.has(frame.id)} />
      <span className="roster-scene-strip__label"><b>{index + 1}</b> {frame.label}</span>
      <small>{formatTime(frame.timeSec)}</small>
    </button>)}
  </div>;
};

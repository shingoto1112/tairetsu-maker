import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Copy,
  LocateFixed,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { FormationFrame } from "../types";
import { formatTime } from "../utils/time";
import { TimeDial } from "./TimeDial";
import { SceneNotesField } from "./SceneNotesField";
import type { SharedNotesAdapter } from "../collaboration/notesAdapter";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";

type TimelineProps = {
  audioDuration?: number;
  canEditTime?: () => boolean;
  subscribeTimePermission?: (listener: () => void) => () => void;
  onUpdateFrameTime: (id: string, timeSec: number) => void;
  frames: FormationFrame[];
  selectedFrameId: string | null;
  currentTime: number;
  useGlobalStageSize: boolean;
  defaultStageWidth: number;
  defaultStageDepth: number;
  previousFrame: FormationFrame | null;
  selectedTargetName?: string | null;
  canEditProject?: boolean;
  canEditScene?: boolean;
  canAddFrame?: boolean;
  projectReadOnlyMessage?: string;
  addFrameReadOnlyMessage?: string;
  sceneReadOnlyMessage?: string;
  onSelectFrame: (id: string) => void;
  onAddFrame: () => void;
  onAddFrameAtCurrentTime: () => void;
  onPreviousFrame: () => void;
  onNextFrame: () => void;
  onSeekToFrame: (timeSec: number) => void;
  onUpdateFrame: (id: string, patch: Partial<FormationFrame>) => void;
  onDeleteFrame: (id: string) => void;
  onCopyFrame: () => void;
  onPasteFrame: () => void;
  onPasteFrameIntoCurrent: () => void;
  canPasteFrame: boolean;
  sceneOrderSaveStatus?: {
    label: string;
    status: "pending" | "saving" | "saved" | "error";
  } | null;
  onApplyPreviousSceneState: (
    includeVisible: boolean,
    selectedOnly?: boolean,
  ) => void;
  /** Shared notes of a scene while co-editing; the memo then edits text, not the whole value. */
  getSharedNotes?: (frameId: string) => SharedNotesAdapter | undefined;
};

const noSubscription = () => () => {};

export const Timeline = ({
  audioDuration,
  canEditTime,
  subscribeTimePermission = noSubscription,
  onUpdateFrameTime,
  frames,
  selectedFrameId,
  currentTime,
  useGlobalStageSize,
  defaultStageWidth,
  defaultStageDepth,
  previousFrame,
  selectedTargetName,
  canEditProject = true,
  canEditScene = true,
  canAddFrame = canEditProject,
  projectReadOnlyMessage = "初期クラウド編集では、シーン追加・削除・並び替え・名称変更は編集できません。",
  addFrameReadOnlyMessage = projectReadOnlyMessage,
  sceneReadOnlyMessage = "編集するには、このシーンの編集ロックを取得してください。",
  onSelectFrame,
  onAddFrame,
  onAddFrameAtCurrentTime,
  onPreviousFrame,
  onNextFrame,
  onSeekToFrame,
  onUpdateFrame,
  onDeleteFrame,
  onCopyFrame,
  onPasteFrame,
  onPasteFrameIntoCurrent,
  canPasteFrame,
  sceneOrderSaveStatus,
  onApplyPreviousSceneState,
  getSharedNotes,
}: TimelineProps) => {
  const [includePreviousObjectVisibility, setIncludePreviousObjectVisibility] =
    useState(false);
  const inlineDetailsRef = useRef<HTMLElement | null>(null);
  const [timeDial, setTimeDial] = useState<{ frameId: string; initialTimeSec: number; maxSeconds: number } | null>(null);
  const timeDialRef = useRef(timeDial); timeDialRef.current = timeDial;
  const revealTimeCommitRef = useRef(false);
  const timePermission = useSyncExternalStore(subscribeTimePermission, canEditTime ?? (() => canEditProject));
  const selectedFrame =
    frames.find((frame) => frame.id === selectedFrameId) ?? frames[0] ?? null;
  const selectedIndex = selectedFrame
    ? frames.findIndex((frame) => frame.id === selectedFrame.id)
    : -1;
  const projectDisabled = !canEditProject;
  const addFrameDisabled = !canAddFrame;
  const sceneDisabled = !canEditScene;

  const validTimeTarget = timeDial !== null && timePermission && canEditProject &&
    selectedFrameId === timeDial.frameId && frames.some(frame => frame.id === timeDial.frameId);
  useLayoutEffect(() => {
    if (timeDial && !validTimeTarget) setTimeDial(null);
  }, [timeDial, validTimeTarget]);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      // Do not move the list while someone is typing in the scene details (memo, label, time).
      if (timeDialRef.current) return;
      if (!revealTimeCommitRef.current && inlineDetailsRef.current?.contains(document.activeElement)) return;
      revealTimeCommitRef.current = false;
      scrollWithinContainer(inlineDetailsRef.current, {
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedFrameId, selectedFrame?.timeSec, selectedIndex, timeDial]);

  const renderSceneDetails = (frame: FormationFrame, index: number) => (
    <section
      ref={inlineDetailsRef}
      className="scene-detail-panel scene-inline-details"
    >
      <div className="panel-section__header">
        <div>
          <h2>このシーンの詳細</h2>
          <span>
            シーン{index + 1} / {formatTime(frame.timeSec)}
          </span>
        </div>
        <button
          className="mini-button"
          onClick={() => onSeekToFrame(frame.timeSec)}
          type="button"
        >
          <LocateFixed size={14} />
          この時刻へ
        </button>
      </div>
      <div className="settings-grid">
        <label>
          ラベル
          <input
            value={frame.label}
            disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            onChange={(event) =>
              onUpdateFrame(frame.id, { label: event.target.value })
            }
          />
        </label>
        <label>
          時刻
          <button
            type="button"
            className="mini-button scene-time-button"
            aria-label={`シーンの時刻を変更（現在 ${formatTime(frame.timeSec)}）`}
            disabled={projectDisabled || !timePermission}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            onClick={() => {
              const knownDuration = typeof audioDuration === "number" && Number.isFinite(audioDuration) && audioDuration > 0;
              setTimeDial({ frameId: frame.id, initialTimeSec: frame.timeSec,
                maxSeconds: Math.max(knownDuration ? audioDuration + 60 : 3600, frame.timeSec) });
            }}
          >{formatTime(frame.timeSec)}</button>
        </label>
      </div>

      {!useGlobalStageSize && (
        <>
          <div className="settings-grid">
            <label>
              このシーンの横
              <NumericInput
                min={1}
                step="0.5"
                value={frame.stageWidthMeters ?? defaultStageWidth}
                disabled={sceneDisabled}
                title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                onValueChange={(stageWidthMeters) =>
                  onUpdateFrame(frame.id, {
                    stageWidthMeters,
                  })
                }
              />
            </label>
            <label>
              このシーンの縦
              <NumericInput
                min={1}
                step="0.5"
                value={frame.stageDepthMeters ?? defaultStageDepth}
                disabled={sceneDisabled}
                title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                onValueChange={(stageDepthMeters) =>
                  onUpdateFrame(frame.id, {
                    stageDepthMeters,
                  })
                }
              />
            </label>
          </div>
          <p className="muted-text">
            現在: このシーンのみ 横{frame.stageWidthMeters ?? defaultStageWidth}m ×{" "}
            縦{frame.stageDepthMeters ?? defaultStageDepth}m
            {frame.stageWidthMeters === undefined ||
            frame.stageDepthMeters === undefined
              ? "（デフォルトサイズを使用中）"
              : ""}
          </p>
        </>
      )}

      <label className="scene-detail-notes">
        メモ
        <SceneNotesField
          frame={frame}
          sharedNotes={getSharedNotes?.(frame.id)}
          className="scene-notes-textarea compact"
          disabled={sceneDisabled}
          title={sceneDisabled ? sceneReadOnlyMessage : undefined}
          onUpdateFrame={onUpdateFrame}
          placeholder="このシーンの注意点、移動のきっかけ、道具の操作メモを書けます。"
        />
      </label>

      <section className="previous-scene-sync">
        <div className="previous-scene-sync__header">
          <h3>前シーン反映</h3>
          <span>
            直前:{" "}
            {previousFrame
              ? `${previousFrame.label || "無題"} / ${formatTime(previousFrame.timeSec)}`
              : "なし"}
          </span>
        </div>
        <p className="previous-scene-sync__description">
          メンバーの位置と道具の位置・大きさを、直前のシーンと同じにします。
        </p>
        <label className="checkbox-row compact">
          <input
            type="checkbox"
            checked={includePreviousObjectVisibility}
            disabled={sceneDisabled}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onChange={(event) =>
              setIncludePreviousObjectVisibility(event.target.checked)
            }
          />
          表示/非表示も反映
        </label>
        <div className="card-actions wrap">
          <button
            className="mini-button"
            onClick={() =>
              onApplyPreviousSceneState(includePreviousObjectVisibility)
            }
            disabled={sceneDisabled || !previousFrame}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            type="button"
          >
            <RotateCcw size={14} />
                    前シーンのメンバー・道具を反映
          </button>
          <button
            className="mini-button"
            onClick={() =>
              onApplyPreviousSceneState(includePreviousObjectVisibility, true)
            }
            disabled={sceneDisabled || !previousFrame || !selectedTargetName}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            type="button"
          >
            選択中だけ反映
          </button>
        </div>
        {selectedTargetName && (
          <p className="muted-text">選択中: {selectedTargetName}</p>
        )}
      </section>

      <div className="card-actions wrap">
        <button className="mini-button" onClick={onCopyFrame} type="button">
          <Copy size={14} />
          コピー
        </button>
        <button
          className="mini-button danger"
          onClick={onPasteFrameIntoCurrent}
          disabled={projectDisabled || !canPasteFrame}
          title={
            projectDisabled
              ? projectReadOnlyMessage
              : !canPasteFrame
                ? "先にコピーしたシーンが必要です。"
                : undefined
          }
          type="button"
        >
          現在シーンへ上書き
        </button>
        <button
          className="mini-button danger"
          onClick={() => onDeleteFrame(frame.id)}
          disabled={projectDisabled || frames.length <= 1}
          aria-label="このシーンを削除"
          title="このシーンを削除"
          type="button"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );

  return (
    <footer className="timeline">
      {validTimeTarget && timeDial && <TimeDial label={(() => { const index = frames.findIndex((item) => item.id === timeDial.frameId); return `シーン${index + 1}「${frames[index]?.label || "無題"}」`; })()} value={timeDial.initialTimeSec} maxSeconds={timeDial.maxSeconds}
        onCancel={() => setTimeDial(null)}
        onCommit={(seconds, { changed }) => {
          // Recheck the live target and permission; unchanged confirmation preserves remote values.
          if (canEditProject && (canEditTime?.() ?? timePermission) && selectedFrameId === timeDial.frameId &&
              frames.some(frame => frame.id === timeDial.frameId)) {
            revealTimeCommitRef.current = true;
            if (changed) onUpdateFrameTime(timeDial.frameId, seconds);
          }
          setTimeDial(null);
        }} />}
      <PanelStickyHeader
        title="シーン一覧"
        meta={
          selectedFrame
            ? `現在: シーン${selectedIndex + 1} / ${formatTime(
                selectedFrame.timeSec,
              )} / 再生 ${formatTime(currentTime)}`
            : `現在時刻 ${formatTime(currentTime)}`
        }
        actions={
          <div className="scene-nav">
            <button className="mini-button" onClick={onPreviousFrame} type="button">
              <ArrowLeft size={15} />
              前へ
            </button>
            <button className="mini-button" onClick={onNextFrame} type="button">
              <ArrowRight size={15} />
              次へ
            </button>
            <button
              className="mini-button primary"
              onClick={onAddFrame}
              disabled={addFrameDisabled}
              title={addFrameDisabled ? addFrameReadOnlyMessage : undefined}
              type="button"
            >
              <Plus size={15} />
              シーン
            </button>
            <button
              className="mini-button"
              onClick={onAddFrameAtCurrentTime}
              disabled={addFrameDisabled}
              title={addFrameDisabled ? addFrameReadOnlyMessage : undefined}
              type="button"
            >
              <Plus size={15} />
              現在時刻で追加
            </button>
            <button className="mini-button" onClick={onCopyFrame} type="button">
              コピー
            </button>
            <button
              className="mini-button"
              onClick={onPasteFrame}
              disabled={projectDisabled || !canPasteFrame}
              title={
                projectDisabled
                  ? projectReadOnlyMessage
                  : !canPasteFrame
                    ? "先にコピーしたシーンが必要です。"
                    : undefined
              }
              type="button"
            >
              新規として貼り付け
            </button>
          </div>
        }
      />
      {sceneOrderSaveStatus && (
        <div
          className={`timeline-save-status is-${sceneOrderSaveStatus.status}`}
          role="status"
          aria-live="polite"
        >
          <span className="timeline-save-status__dot" aria-hidden="true" />
          <strong>
            {sceneOrderSaveStatus.status === "pending"
              ? "保存待ち"
              : sceneOrderSaveStatus.status === "saving"
                ? "保存中"
                : sceneOrderSaveStatus.status === "saved"
                  ? "保存済み"
                  : "保存失敗"}
          </strong>
          <span>{sceneOrderSaveStatus.label}</span>
        </div>
      )}
      {projectDisabled && (
        <p className="notice warning">{projectReadOnlyMessage}</p>
      )}
      {sceneDisabled && <p className="notice warning">{sceneReadOnlyMessage}</p>}

      <div className="timeline__rail">
        {frames.length === 0 && (
          <p className="empty-state">シーンがありません。＋シーンから追加してください。</p>
        )}
        {frames.map((frame, index) => {
          const isSelected = frame.id === selectedFrame?.id;
          return (
            <div className="timeline-item" key={frame.id}>
              <article
                className={[
                  "timeline-card compact",
                  isSelected ? "is-selected" : "",
                ].join(" ")}
                onClick={() => onSelectFrame(frame.id)}
              >
                <div className="timeline-card__top">
                  <div>
                    <div className="scene-number">シーン {index + 1}</div>
                    <strong>{frame.label || "無題のシーン"}</strong>
                  </div>
                  {frame.notes?.trim() && (
                    <span className="scene-note-badge">
                      <StickyNote size={13} />
                      メモ
                    </span>
                  )}
                </div>
                <div className="timeline-card__time">
                  <Clock size={14} />
                  {formatTime(frame.timeSec)}
                </div>
                {frame.section && <span className="scene-section">{frame.section}</span>}
              </article>
              {isSelected && renderSceneDetails(frame, index)}
            </div>
          );
        })}
      </div>
    </footer>
  );
};

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
import { useEffect, useRef, useState } from "react";
import { FormationFrame } from "../types";
import { formatTime } from "../utils/time";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";

type TimelineProps = {
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
  canSortFrames?: boolean;
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
  onReorderFrame: (draggedId: string, targetId: string) => void;
  onSortFramesByTime: () => void;
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
};

export const Timeline = ({
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
  canSortFrames = canEditProject,
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
  onReorderFrame,
  onSortFramesByTime,
  onCopyFrame,
  onPasteFrame,
  onPasteFrameIntoCurrent,
  canPasteFrame,
  sceneOrderSaveStatus,
  onApplyPreviousSceneState,
}: TimelineProps) => {
  const [draggingFrameId, setDraggingFrameId] = useState<string | null>(null);
  const [dragOverFrameId, setDragOverFrameId] = useState<string | null>(null);
  const [includePreviousObjectVisibility, setIncludePreviousObjectVisibility] =
    useState(false);
  const inlineDetailsRef = useRef<HTMLElement | null>(null);
  const selectedFrame =
    frames.find((frame) => frame.id === selectedFrameId) ?? frames[0] ?? null;
  const selectedIndex = selectedFrame
    ? frames.findIndex((frame) => frame.id === selectedFrame.id)
    : -1;
  const projectDisabled = !canEditProject;
  const addFrameDisabled = !canAddFrame;
  const sortFramesDisabled = !canSortFrames;
  const sceneDisabled = !canEditScene;

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      inlineDetailsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedFrameId]);

  const renderSceneDetails = (frame: FormationFrame, index: number) => (
    <section
      ref={inlineDetailsRef}
      className="scene-detail-panel scene-inline-details"
    >
      <div className="panel-section__header">
        <div>
          <h2>このシーンの詳細</h2>
          <span>
            Scene {index + 1} / {formatTime(frame.timeSec)}
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
          セクション
          <input
            value={frame.section ?? ""}
            disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            onChange={(event) =>
              onUpdateFrame(frame.id, { section: event.target.value })
            }
            placeholder="Intro / Aメロ / サビ"
          />
        </label>
        <label>
          時刻（秒）
          <NumericInput
            min={0}
            step="0.1"
            value={frame.timeSec}
            disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            onValueChange={(timeSec) =>
              onUpdateFrame(frame.id, {
                timeSec,
              })
            }
          />
        </label>
      </div>

      {useGlobalStageSize ? (
        <p className="notice muted">
          ステージサイズは全シーン共通です: 横{defaultStageWidth}m × 縦{defaultStageDepth}m
        </p>
      ) : (
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
        <textarea
          className="scene-notes-textarea compact"
          value={frame.notes ?? ""}
          disabled={sceneDisabled}
          title={sceneDisabled ? sceneReadOnlyMessage : undefined}
          onChange={(event) =>
            onUpdateFrame(frame.id, { notes: event.target.value })
          }
          placeholder="このシーンの注意点、道具の操作メモ、隊列の確認メモを書けます。"
        />
      </label>

      <section className="previous-scene-sync">
        <div className="previous-scene-sync__header">
          <div>
            <h3>前シーン反映</h3>
            <p>
                    現在シーンのメンバー位置と道具の位置・大きさを、直前シーンの状態で上書きします。
            </p>
          </div>
          <span>
            直前:{" "}
            {previousFrame
              ? `${previousFrame.label || "無題"} / ${formatTime(previousFrame.timeSec)}`
              : "なし"}
          </span>
        </div>
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
          このシーンをコピー
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
          title={projectDisabled ? projectReadOnlyMessage : undefined}
          type="button"
        >
          <Trash2 size={14} />
          このシーンを削除
        </button>
      </div>
    </section>
  );

  return (
    <footer className="timeline">
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
            <button
              className="mini-button"
              onClick={onSortFramesByTime}
              disabled={sortFramesDisabled || frames.length <= 1}
              title={sortFramesDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              <Clock size={15} />
              時刻順
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
                  draggingFrameId === frame.id ? "is-dragging" : "",
                  dragOverFrameId === frame.id && draggingFrameId !== frame.id
                    ? "is-drop-target"
                    : "",
                ].join(" ")}
                draggable={!projectDisabled}
                onClick={() => onSelectFrame(frame.id)}
                onDragStart={(event) => {
                  if (projectDisabled) {
                    event.preventDefault();
                    return;
                  }
                  setDraggingFrameId(frame.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", frame.id);
                }}
                onDragOver={(event) => {
                  if (projectDisabled) {
                    return;
                  }
                  event.preventDefault();
                  setDragOverFrameId(frame.id);
                }}
                onDragLeave={() => setDragOverFrameId(null)}
                onDrop={(event) => {
                  if (projectDisabled) {
                    return;
                  }
                  event.preventDefault();
                  const draggedId =
                    draggingFrameId || event.dataTransfer.getData("text/plain");
                  setDraggingFrameId(null);
                  setDragOverFrameId(null);
                  if (draggedId) {
                    onReorderFrame(draggedId, frame.id);
                  }
                }}
                onDragEnd={() => {
                  setDraggingFrameId(null);
                  setDragOverFrameId(null);
                }}
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
                  {formatTime(frame.timeSec)} / {frame.timeSec.toFixed(1)}秒
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

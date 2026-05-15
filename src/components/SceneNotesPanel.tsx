import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { FormationFrame } from "../types";
import { formatTime } from "../utils/time";
import { PanelStickyHeader } from "./PanelStickyHeader";

type SceneNotesPanelProps = {
  frame?: FormationFrame;
  sceneNumber: number;
  canEditScene?: boolean;
  commitOnBlur?: boolean;
  sceneReadOnlyMessage?: string;
  onUpdateFrame: (id: string, patch: Partial<FormationFrame>) => void;
};

export const SceneNotesPanel = ({
  frame,
  sceneNumber,
  canEditScene = true,
  commitOnBlur = false,
  sceneReadOnlyMessage = "編集するには、このシーンの編集ロックを取得してください。",
  onUpdateFrame,
}: SceneNotesPanelProps) => {
  const sceneDisabled = !canEditScene;
  const [notesDraft, setNotesDraft] = useState(frame?.notes ?? "");

  useEffect(() => {
    setNotesDraft(frame?.notes ?? "");
  }, [frame?.id, frame?.notes]);

  if (!frame) {
    return (
      <section className="panel-section notes-panel">
        <PanelStickyHeader
          title="シーンメモ"
          meta="シーン未選択"
          actions={<StickyNote size={18} />}
        />
        <p className="muted-text">メモを書くシーンを選択してください。</p>
      </section>
    );
  }

  return (
    <section className="panel-section notes-panel">
      <PanelStickyHeader
        title="シーンメモ"
        meta={`Scene ${sceneNumber} / ${frame.label || "未設定"} / ${formatTime(
          frame.timeSec,
        )}`}
        actions={<StickyNote size={18} />}
      />
      {sceneDisabled && <p className="notice warning">{sceneReadOnlyMessage}</p>}
      <div className="notes-scene-summary">
        <strong>Scene {sceneNumber}</strong>
        <span>ラベル: {frame.label || "未設定"}</span>
        <span>時刻: {formatTime(frame.timeSec)}</span>
        <span>セクション: {frame.section || "未設定"}</span>
      </div>
      <details className="settings-disclosure notes-disclosure" open>
        <summary>メモ欄</summary>
        <textarea
          className="scene-notes-textarea"
          value={commitOnBlur ? notesDraft : frame.notes ?? ""}
          disabled={sceneDisabled}
          title={sceneDisabled ? sceneReadOnlyMessage : undefined}
          onBlur={() => {
            if (commitOnBlur && notesDraft !== (frame.notes ?? "")) {
              onUpdateFrame(frame.id, { notes: notesDraft });
            }
          }}
          onChange={(event) => {
            const nextNotes = event.target.value;
            if (commitOnBlur) {
              setNotesDraft(nextNotes);
              return;
            }
            onUpdateFrame(frame.id, { notes: nextNotes });
          }}
          placeholder="このシーンの注意点、移動のきっかけ、幕や道具の操作メモを書けます。"
          aria-label="シーンメモ"
        />
      </details>
    </section>
  );
};

import { StickyNote } from "lucide-react";
import { FormationFrame } from "../types";
import { formatTime } from "../utils/time";
import { PanelStickyHeader } from "./PanelStickyHeader";

type SceneNotesPanelProps = {
  frame?: FormationFrame;
  sceneNumber: number;
  onUpdateFrame: (id: string, patch: Partial<FormationFrame>) => void;
};

export const SceneNotesPanel = ({
  frame,
  sceneNumber,
  onUpdateFrame,
}: SceneNotesPanelProps) => {
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
          value={frame.notes ?? ""}
          onChange={(event) =>
            onUpdateFrame(frame.id, { notes: event.target.value })
          }
          placeholder="このシーンの注意点、移動のきっかけ、幕や道具の操作メモを書けます。"
          aria-label="シーンメモ"
        />
      </details>
    </section>
  );
};

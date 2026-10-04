import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SharedNotesAdapter, NotesCapture, NotesSelection } from "../collaboration/notesAdapter";
import { StickyNote } from "lucide-react";
import { FormationFrame } from "../types";
import { formatTime } from "../utils/time";
import { PanelStickyHeader } from "./PanelStickyHeader";

type SceneNotesPanelProps = {
  frame?: FormationFrame;
  sceneNumber: number;
  canEditScene?: boolean;
  commitOnBlur?: boolean;
  sharedNotes?: SharedNotesAdapter;
  sceneReadOnlyMessage?: string;
  onUpdateFrame: (id: string, patch: Partial<FormationFrame>) => void;
};

export const SceneNotesPanel = ({
  frame,
  sceneNumber,
  canEditScene = true,
  commitOnBlur = false,
  sharedNotes,
  sceneReadOnlyMessage = "編集するには、このシーンの編集ロックを取得してください。",
  onUpdateFrame,
}: SceneNotesPanelProps) => {
  const sceneDisabled = !canEditScene;
  const [notesDraft, setNotesDraft] = useState(frame?.notes ?? "");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const applyingInput = useRef(false);
  const compositionCommitted = useRef<string | null>(null);
  const capture = useRef<NotesCapture | null>(null);
  const selection = useRef<NotesSelection | null>(null);
  const restoreSelection = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!composing.current) setNotesDraft(sharedNotes?.value ?? frame?.notes ?? "");
  }, [frame?.id, frame?.notes, sharedNotes]);
  useEffect(() => {
    composing.current = false; capture.current = null; selection.current = null;
    if (!sharedNotes) return;
    setNotesDraft(sharedNotes.value);
    return sharedNotes.subscribe(() => {
      if (composing.current || applyingInput.current) return;
      if (selection.current && document.activeElement === textarea.current) restoreSelection.current = sharedNotes.resolve(selection.current);
      setNotesDraft(sharedNotes.value);
    });
  }, [sharedNotes]);
  useLayoutEffect(() => {
    const value = restoreSelection.current; restoreSelection.current = null;
    if (value && textarea.current) textarea.current.setSelectionRange(value.start, value.end);
  }, [notesDraft]);

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
          ref={textarea}
          className="scene-notes-textarea"
          value={sharedNotes || commitOnBlur ? notesDraft : frame.notes ?? ""}
          disabled={sceneDisabled}
          title={sceneDisabled ? sceneReadOnlyMessage : undefined}
          onBlur={() => {
            if (sharedNotes) return;
            if (commitOnBlur && notesDraft !== (frame.notes ?? "")) {
              onUpdateFrame(frame.id, { notes: notesDraft });
            }
          }}
          onChange={(event) => {
            const nextNotes = event.target.value;
            if (sharedNotes) {
              if (nextNotes === compositionCommitted.current) { compositionCommitted.current = null; setNotesDraft(sharedNotes.value); return; }
              compositionCommitted.current = null;
              setNotesDraft(nextNotes);
              if (!composing.current) {
                applyingInput.current = true;
                try { sharedNotes.input(capture.current ?? sharedNotes.capture(), nextNotes); }
                finally { applyingInput.current = false; }
                capture.current = null; setNotesDraft(sharedNotes.value);
                selection.current = sharedNotes.selection(sharedNotes.caret, sharedNotes.caret);
                restoreSelection.current = { start: sharedNotes.caret, end: sharedNotes.caret };
              }
              return;
            }
            if (commitOnBlur) {
              setNotesDraft(nextNotes);
              return;
            }
            onUpdateFrame(frame.id, { notes: nextNotes });
          }}
          onBeforeInput={() => { if (sharedNotes && !composing.current) capture.current = sharedNotes.capture(); }}
          onSelect={event => { if (sharedNotes && !composing.current) selection.current = sharedNotes.selection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd); }}
          onCompositionStart={() => { if (sharedNotes) { composing.current = true; capture.current = sharedNotes.capture(); } }}
          onCompositionEnd={event => {
            if (!sharedNotes || !composing.current) return;
            composing.current = false;
            compositionCommitted.current = event.currentTarget.value;
            applyingInput.current = true;
            try { sharedNotes.input(capture.current ?? sharedNotes.capture(), event.currentTarget.value); }
            finally { applyingInput.current = false; }
            selection.current = sharedNotes.selection(sharedNotes.caret, sharedNotes.caret);
            restoreSelection.current = { start: sharedNotes.caret, end: sharedNotes.caret };
            capture.current = null; setNotesDraft(sharedNotes.value);
          }}
          placeholder="このシーンの注意点、移動のきっかけ、幕や道具の操作メモを書けます。"
          aria-label="シーンメモ"
        />
      </details>
    </section>
  );
};

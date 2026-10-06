import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NotesCapture, NotesSelection, SharedNotesAdapter } from "../collaboration/notesAdapter";
import type { FormationFrame } from "../types";

type SceneNotesFieldProps = {
  frame: FormationFrame;
  /** Shared scene notes while co-editing (one cached adapter per scene). */
  sharedNotes?: SharedNotesAdapter;
  disabled?: boolean;
  title?: string;
  commitOnBlur?: boolean;
  className?: string;
  placeholder?: string;
  onUpdateFrame: (id: string, patch: Partial<FormationFrame>) => void;
};

/**
 * Scene memo textarea (moved here from the former メモ tab). While co-editing it
 * writes through SharedNotesAdapter: nothing is sent during IME composition, one
 * anchored commit happens at compositionend, remote edits keep the caret, and the
 * duplicate input after compositionend is ignored. If the scene changes while
 * composing (e.g. playback moves on), the text typed so far is committed to the
 * scene it was typed in instead of being dropped.
 */
export const SceneNotesField = ({
  frame,
  sharedNotes,
  disabled = false,
  title,
  commitOnBlur = false,
  className = "scene-notes-textarea",
  placeholder = "このシーンの注意点、移動のきっかけ、幕や道具の操作メモを書けます。",
  onUpdateFrame,
}: SceneNotesFieldProps) => {
  const [notesDraft, setNotesDraft] = useState(sharedNotes?.value ?? frame.notes ?? "");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const applyingInput = useRef(false);
  const compositionCommitted = useRef<string | null>(null);
  const capture = useRef<NotesCapture | null>(null);
  const selection = useRef<NotesSelection | null>(null);
  const restoreSelection = useRef<{ start: number; end: number } | null>(null);
  // Latest DOM text, readable in effect cleanup after the ref is detached.
  const domValue = useRef(notesDraft);

  useEffect(() => {
    if (!composing.current) setNotesDraft(sharedNotes?.value ?? frame.notes ?? "");
  }, [frame.id, frame.notes, sharedNotes]);
  useEffect(() => {
    composing.current = false; capture.current = null; selection.current = null;
    compositionCommitted.current = null; restoreSelection.current = null;
    if (!sharedNotes) return undefined;
    setNotesDraft(sharedNotes.value);
    const release = sharedNotes.subscribe(() => {
      if (composing.current || applyingInput.current) return;
      if (selection.current && document.activeElement === textarea.current) restoreSelection.current = sharedNotes.resolve(selection.current);
      setNotesDraft(sharedNotes.value);
    });
    return () => {
      release();
      // Scene changed or the field closed mid-composition: keep what was typed.
      if (composing.current && domValue.current !== sharedNotes.value) {
        applyingInput.current = true;
        try { sharedNotes.input(capture.current ?? sharedNotes.capture(), domValue.current); }
        finally { applyingInput.current = false; }
      }
      composing.current = false; capture.current = null;
    };
  }, [sharedNotes]);
  useLayoutEffect(() => {
    const value = restoreSelection.current; restoreSelection.current = null;
    if (value && textarea.current) textarea.current.setSelectionRange(value.start, value.end);
  }, [notesDraft]);

  const shownValue = sharedNotes || commitOnBlur ? notesDraft : frame.notes ?? "";
  domValue.current = shownValue;

  return <textarea
    ref={textarea}
    className={className}
    value={shownValue}
    disabled={disabled}
    title={title}
    onBlur={() => {
      if (sharedNotes) return;
      if (commitOnBlur && notesDraft !== (frame.notes ?? "")) {
        onUpdateFrame(frame.id, { notes: notesDraft });
      }
    }}
    onChange={(event) => {
      const nextNotes = event.target.value;
      domValue.current = nextNotes;
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
    placeholder={placeholder}
    aria-label="シーンメモ"
  />;
};

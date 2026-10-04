// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { SceneNotesPanel } from "./SceneNotesPanel";
import { createSampleProject } from "../sampleProject";
import { createSharedDocument, joinSharedDocument, getModel, REMOTE_ORIGIN } from "../collaboration/model";
import { CollaborationCommands } from "../collaboration/commands";
import { SharedNotesAdapter } from "../collaboration/notesAdapter";
import { projectSharedDocument } from "../collaboration/projection";

afterEach(cleanup);
it("shared textarea keeps the composing DOM draft across remote updates, applies one anchored commit, and ignores the final duplicate input", () => {
  const p = createSampleProject(); p.id = "notes-ui"; p.frames[0].notes = "abc";
  const doc = createSharedDocument(p), other = joinSharedDocument(Y.encodeStateAsUpdate(doc)), commands = new CollaborationCommands(doc);
  const notes = new SharedNotesAdapter(doc, commands, p.frames[0].id), updateFrame = vi.fn();
  try {
    const ui = render(<SceneNotesPanel frame={p.frames[0]} sceneNumber={1} sharedNotes={notes} onUpdateFrame={updateFrame} />);
    const textarea = ui.getByRole("textbox", { name: "シーンメモ" }) as HTMLTextAreaElement;
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "a日本語c" } });
    expect(textarea.value).toBe("a日本語c"); expect(notes.value).toBe("abc");
    act(() => {
      const text = getModel(other).scenes.get(p.frames[0].id)!.get("notes") as unknown as Y.Text;
      other.transact(() => text.insert(1, "REMOTE"), REMOTE_ORIGIN);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), REMOTE_ORIGIN);
    });
    expect(textarea.value).toBe("a日本語c");
    fireEvent.compositionEnd(textarea);
    expect(textarea.value).toBe("aREMOTE日本語c"); expect(notes.value).toBe(textarea.value);
    fireEvent.change(textarea, { target: { value: "a日本語c" } });
    expect(textarea.value).toBe("aREMOTE日本語c"); expect(updateFrame).not.toHaveBeenCalled();
    act(() => commands.undo()); expect(textarea.value).toBe("aREMOTEbc");
    expect(projectSharedDocument(doc, p).frames[0].notes).toBe("aREMOTEbc");
  } finally { commands.destroy(); doc.destroy(); other.destroy(); }
});
it("remote insertion preserves the textarea caret using relative selection anchors", () => {
  const p = createSampleProject(); p.id = "notes-caret"; p.frames[0].notes = "abc";
  const doc = createSharedDocument(p), commands = new CollaborationCommands(doc), notes = new SharedNotesAdapter(doc, commands, p.frames[0].id);
  try {
    const ui = render(<SceneNotesPanel frame={p.frames[0]} sceneNumber={1} sharedNotes={notes} onUpdateFrame={vi.fn()} />);
    const textarea = ui.getByRole("textbox", { name: "シーンメモ" }) as HTMLTextAreaElement;
    textarea.focus(); textarea.setSelectionRange(2, 2); fireEvent.select(textarea);
    act(() => doc.transact(() => (getModel(doc).scenes.get(p.frames[0].id)!.get("notes") as unknown as Y.Text).insert(0, "R"), REMOTE_ORIGIN));
    expect(textarea.value).toBe("Rabc"); expect(textarea.selectionStart).toBe(3); expect(textarea.selectionEnd).toBe(3);
  } finally { commands.destroy(); doc.destroy(); }
});

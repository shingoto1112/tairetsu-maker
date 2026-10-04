import * as Y from "yjs";
import { CollaborationCommands } from "./commands";
import { textSplice } from "./recipeCommands";
import { getModel } from "./model";
type Span = { index: number; length: number; client: number; clock: number };
export type NotesCapture = { value: string; spans: Span[]; end: Y.RelativePosition; type: Y.ID | null; tname: string | null };
export type NotesSelection = { start: Y.RelativePosition; end: Y.RelativePosition };
/** Composition buffers DOM input only. Y.Text keeps receiving remote edits;
 * compositionend applies an anchored splice to the original character IDs. */
export class SharedNotesAdapter {
  private text: Y.Text;
  caret = 0;
  constructor(private doc: Y.Doc, private commands: CollaborationCommands, readonly sceneId: string) {
    this.text = getModel(doc).scenes.get(sceneId)!.get("notes") as unknown as Y.Text;
  }
  get value(): string { return this.text.toString(); }
  capture(): NotesCapture {
    const end = Y.createRelativePositionFromTypeIndex(this.text, this.text.length), spans: Span[] = [];
    let index = 0;
    // Linear capture over Item spans, rather than one full list scan per char.
    for (const item of Y.getTypeChildren(this.text)) if (!item.deleted && item.content instanceof Y.ContentString) {
      spans.push({ index, length: item.length, client: item.id.client, clock: item.id.clock }); index += item.length;
    }
    return { value: this.value, spans, end, type: end.type, tname: end.tname };
  }
  private anchor(capture: NotesCapture, index: number): Y.RelativePosition {
    const span = capture.spans.find(span => index >= span.index && index < span.index + span.length);
    return span ? new Y.RelativePosition(capture.type, capture.tname, Y.createID(span.client, span.clock + index - span.index)) : capture.end;
  }
  selection(start: number, end: number): NotesSelection {
    return { start: Y.createRelativePositionFromTypeIndex(this.text, start), end: Y.createRelativePositionFromTypeIndex(this.text, end) };
  }
  resolve(selection: NotesSelection): { start: number; end: number } {
    return { start: Y.createAbsolutePositionFromRelativePosition(selection.start, this.doc)?.index ?? 0,
      end: Y.createAbsolutePositionFromRelativePosition(selection.end, this.doc)?.index ?? 0 };
  }
  subscribe(listener: () => void): () => void { this.text.observe(listener); return () => this.text.unobserve(listener); }
  input(capture: NotesCapture, value: string): number {
    if (value.length > 65536) throw new Error("シーンメモは65,536文字までです。");
    const splice = textSplice(capture.value, value);
    if (!splice.remove && !splice.insert) return 0;
    const insertAt = this.anchor(capture, splice.index);
    // Match original character ID intervals against live Item spans. A large
    // paste/delete must not scan the whole Y.Text once per UTF-16 character.
    const removed = new Map<number, { start: number; end: number }[]>();
    for (const span of capture.spans) {
      const start = Math.max(span.index, splice.index), end = Math.min(span.index + span.length, splice.index + splice.remove);
      if (start >= end) continue;
      const intervals = removed.get(span.client) ?? [];
      intervals.push({ start: span.clock + start - span.index, end: span.clock + end - span.index }); removed.set(span.client, intervals);
    }
    for (const intervals of removed.values()) intervals.sort((a, b) => a.start - b.start);
    const ranges: { index: number; length: number }[] = [];
    let visible = 0;
    for (const item of Y.getTypeChildren(this.text)) if (!item.deleted && item.content instanceof Y.ContentString) {
      const intervals = removed.get(item.id.client) ?? [], start = item.id.clock, end = start + item.length;
      let lo = 0, hi = intervals.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (intervals[mid].end <= start) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < intervals.length && intervals[i].start < end; i++) {
        const overlap = Math.max(start, intervals[i].start), length = Math.min(end, intervals[i].end) - overlap;
        if (length <= 0) continue;
        const index = visible + overlap - start, last = ranges[ranges.length - 1];
        if (last && last.index + last.length === index) last.length += length;
        else ranges.push({ index, length });
      }
      visible += item.length;
    }
    return this.commands.executePrepared([{ target: { entityType: "scenes", entityId: this.sceneId, field: "notes" },
      read: () => this.value, write: () => {
        for (const range of ranges.reverse()) this.text.delete(range.index, range.length);
        const position = Y.createAbsolutePositionFromRelativePosition(insertAt, this.doc)?.index ?? this.text.length;
        if (splice.insert) this.text.insert(position, splice.insert);
        this.caret = position + splice.insert.length;
        const scene = getModel(this.doc).scenes.get(this.sceneId) as unknown as Y.Map<unknown>;
        if (!scene.get("has.notes")) scene.set("has.notes", true);
      } }]);
  }
}

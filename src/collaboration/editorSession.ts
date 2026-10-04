import * as Y from "yjs";
import type { Project, SceneElementEditTarget } from "../types";
import type { SaveCoordinator } from "../storage/saveCoordinator";
import type { CollaborationUpdate } from "../repositories/types";
import { CollaborationCommands, type HistoryResult } from "./commands";
import { hydrateCollaboration, encodeUpdate } from "./persistence";
import { projectSharedDocument } from "./projection";
import { REMOTE_ORIGIN } from "./model";
import { clone } from "./projectModel";
import { same, listField } from "./projectModel";
import { ENTITY_ROOTS, getModel } from "./model";
import { sameSong, type SongDescriptor } from "../repositories/audioBindings";
import { SharedNotesAdapter } from "./notesAdapter";
import { planRecipe, type PlannedWrite } from "./recipeCommands";

/** No transport/auth/UI creation here. Owns one persistent editing Y.Doc and its
 * UndoManager; durable merges apply into that identity, never recreate from JSON. */
export class SharedProjectEditor {
  readonly commands: CollaborationCommands;
  private local: Project;
  private syncing = false;
  private disposed = false;
  private pending: CollaborationUpdate[] = [];
  private seen = new WeakSet<object>();
  private published = new WeakSet<Project>();
  private readonly sharedDocumentId: string | null;
  acceptsProjection(project: Project): boolean { return this.published.has(project); }
  private noteAdapters = new Map<string, SharedNotesAdapter>();
  private audioBindingState = "";
  notes(sceneId: string): SharedNotesAdapter {
    let adapter = this.noteAdapters.get(sceneId);
    if (!adapter) { adapter = new SharedNotesAdapter(this.doc, this.commands, sceneId); this.noteAdapters.set(sceneId, adapter); }
    return adapter;
  }
  private batch: { targets: SceneElementEditTarget[]; sceneId?: string; writes: Map<string, PlannedWrite>; draft: Project } | null = null;
  private constructor(readonly doc: Y.Doc, private coordinator: SaveCoordinator, project: Project,
    private publish: (project: Project) => void, private failed: (error: unknown) => void) {
    this.local = project; this.commands = new CollaborationCommands(doc);
    this.audioBindingState = JSON.stringify(coordinator.audioBindingsProjection);
    this.sharedDocumentId = coordinator.collaborationProjection?.sharedDocumentId ?? null;
    doc.on("update", this.updated); this.remember(project);
  }
  static async create(coordinator: SaveCoordinator, project: Project, publish: (project: Project) => void, failed: (error: unknown) => void) {
    await coordinator.prepareCollaborationEditing();
    const data = coordinator.collaborationProjection;
    if (!data || data.documentSchema !== 2) throw new Error("全項目の編集には共同編集 schema 2 が必要です。");
    return new SharedProjectEditor(hydrateCollaboration(data), coordinator, project, publish, failed);
  }
  get project(): Project {
    const projected = projectSharedDocument(this.doc, this.local, this.sharedDocumentId);
    if (!this.batch) return projected;
    const own = this.batch;
    // A synchronous compound entry (e.g. applying plans to several members)
    // must build subsequent recipes on its preceding draft. Pointer batches
    // use the narrower geometry overlay below for remote reflection.
    if (!own.sceneId) return own.draft;
    // Only dragged geometry is protected; remote names/visibility/other elements
    // still update. Tombstoned entities remain deleted after pointer-up.
    return { ...projected, frames: projected.frames.map(frame => {
      if (frame.id !== own.sceneId) return frame;
      const draft = own.draft.frames.find(f => f.id === frame.id); if (!draft) return frame;
      const next = { ...frame, positions: { ...frame.positions }, objectStates: { ...frame.objectStates } };
      for (const target of own.targets) {
        if (target.type === "member-position" && draft.positions[target.id] && projected.members.some(m => m.id === target.id)) next.positions[target.id] = draft.positions[target.id];
        if (target.type === "object-state" && draft.objectStates[target.id] && projected.stageObjects.some(o => o.id === target.id)) {
          const state = draft.objectStates[target.id], remote = next.objectStates[target.id];
          next.objectStates[target.id] = { ...remote, x: state.x, y: state.y, widthMeters: state.widthMeters, heightMeters: state.heightMeters, rotation: state.rotation };
        }
      }
      return next;
    }) };
  }
  edit(recipe: (previous: Project) => Project, intentionalImport = false): void {
    if (this.disposed) return;
    const previous = this.project, next = recipe(previous);
    if (next === previous) return;
    if (!intentionalImport) this.rejectStale(previous, next);
    // Compile now, before any asynchronous save or remote update.
    const writes = planRecipe(this.doc, previous, next, this.sharedDocumentId);
    this.local = { ...next, updatedAt: new Date().toISOString() };
    if (this.batch) {
      writes.forEach(w => this.batch!.writes.set(JSON.stringify(w.target), w));
      this.batch.draft = next; this.emit(); return;
    }
    this.commands.executePrepared(writes);
    if (!writes.length) this.coordinator.editCollaborationLocal(next);
    this.emit();
  }
  /** Whole captured Project replacement is deliberately unavailable. Import is
   * an explicit entry with its own intended content, compiled against live state. */
  replace(): never { throw new Error("共有中は古い Project 全体で置き換えられません。"); }
  importProject(input: Project): void {
    this.edit(previous => ({ ...clone(input), id: previous.id, version: previous.version,
      createdAt: previous.createdAt, lastOpenedAt: previous.lastOpenedAt, viewerPerspective: previous.viewerPerspective, focusMemberId: previous.focusMemberId }), true);
  }
  setLocal(project: Project): void {
    this.local = project; this.coordinator.editCollaborationLocal(project); this.emit();
  }
  begin(sceneId?: string, targets: SceneElementEditTarget[] = []): void {
    if (this.batch) return;
    this.batch = { sceneId, targets, writes: new Map(), draft: this.project };
  }
  end(): void {
    const batch = this.batch; if (!batch) return;
    this.batch = null;
    // executePrepared is internal to the entry compiler; one pointer-up txn.
    this.commands.executePrepared([...batch.writes.values()]);
    if (!batch.writes.size) this.coordinator.editCollaborationLocal(this.local);
    this.emit();
  }
  undo(): HistoryResult { this.end(); const result = this.commands.undo(); this.emit(); return result; }
  redo(): HistoryResult { this.end(); const result = this.commands.redo(); this.emit(); return result; }
  stagePending(): boolean {
    if (!this.pending.length) return true;
    try {
      this.syncing = true; this.coordinator.editCollaborationNow(this.pending, this.local); this.pending = []; return true;
    } catch (error) { this.failed(error); return false; }
    finally { this.syncing = false; }
  }
  receiveDurable(): void {
    if (this.disposed || this.syncing) return;
    const data = this.coordinator.collaborationProjection;
    if (!data) return;
    const durable = hydrateCollaboration(data);
    let changed = false;
    const bindings = data.audioBindings ?? [], bindingState = JSON.stringify(bindings);
    if (bindingState !== this.audioBindingState) {
      this.audioBindingState = bindingState;
      const song = getModel(durable).settings.get("song") as SongDescriptor | null | undefined;
      const binding = bindings.find(b => sameSong(b.song, song));
      if (binding && !same(this.local.audio, binding.audio)) { this.local = { ...this.local, audio: binding.audio }; changed = true; }
    }
    const received = () => { changed = true; };
    this.doc.on("update", received);
    this.syncing = true;
    try { Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(durable), REMOTE_ORIGIN); }
    finally { this.syncing = false; this.doc.off("update", received); durable.destroy(); }
    // ACK/save-status changes do not redraw Project or Canvas.
    if (changed) this.emit();
  }
  destroy(): void { this.disposed = true; this.doc.off("update", this.updated); this.commands.destroy(); this.doc.destroy(); }
  private emit(): void { const project = this.project; this.remember(project); this.published.add(project); this.publish(project); }
  private remember(project: Project): void {
    this.seen.add(project); this.seen.add(project.stage);
    for (const root of ENTITY_ROOTS) {
      const list = project[listField(root)];
      if (!Array.isArray(list)) continue;
      this.seen.add(list);
      for (const item of list as object[]) {
        this.seen.add(item);
        Object.values(item).forEach(value => { if (value && typeof value === "object") this.seen.add(value); });
      }
    }
  }
  private rejectStale(previous: Project, next: Project): void {
    const reject = () => { throw new Error("共有中は古い Project の全置換を使用できません。現在の編集入口で変更してください。"); };
    if (this.seen.has(next) && !same(previous, next)) reject();
    for (const root of ENTITY_ROOTS) {
      const field = listField(root), a = previous[field], b = next[field];
      if (a === b || !Array.isArray(b)) continue;
      if (this.seen.has(b) && !same(a, b)) reject();
      if (!Array.isArray(a)) continue;
      const live = new Map((a as { id?: string }[]).map(item => [item.id, item]));
      for (const item of b as { id?: string }[]) {
        const current = live.get(item.id); if (!current || current === item) continue;
        if (this.seen.has(item) && !same(current, item)) reject();
        for (const [key, value] of Object.entries(item)) if (value && typeof value === "object" && this.seen.has(value) &&
          !same((current as Record<string, unknown>)[key], value)) reject();
      }
    }
  }
  private updated = (bytes: Uint8Array, origin: unknown) => {
    if (this.disposed || this.syncing) return;
    if (origin === REMOTE_ORIGIN) { this.emit(); return; }
    this.local = { ...this.local, updatedAt: new Date().toISOString() };
    this.pending.push({ updateId: crypto.randomUUID(), bytes: encodeUpdate(bytes), source: "local" });
    this.stagePending();
    this.emit();
  };
}

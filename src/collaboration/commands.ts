import * as Y from "yjs";
import type { Position, Project } from "../types";
import { assertDocument, assertPosition, getSupportedModel, readPosition, ENTITY_ROOTS } from "./model";
import { planRecipe, planRestore, type PlannedWrite, type EditTarget, type OrderReference } from "./recipeCommands";
import { same, deleted, orderKey, order, moveSlot } from "./projectModel";
import type { EntityRoot } from "./model";

export type PositionTarget = { sceneId: string; memberId: string };
export type MemberMove = PositionTarget & { position: Position };
export type HistoryTarget = Partial<PositionTarget & EditTarget>;
export type HistoryResult = {
  status: "empty" | "applied" | "partial" | "blocked";
  consumedOperations: number;
  attempted: HistoryTarget[];
  changed: HistoryTarget[];
  skipped: HistoryTarget[];
};
const TARGETS = Symbol("position targets");
const READS = Symbol("target readers");
const FALLBACKS = Symbol("order undo references");
type OrderFallback = OrderReference & { value: unknown };
const key = (target: PositionTarget) => JSON.stringify([target.sceneId, target.memberId]);
const equal = (a: Position | undefined, b: Position | undefined) => a?.x === b?.x && a?.y === b?.y;

/** One instance per local editing session. Remote/init/null origins are not tracked. */
export class CollaborationCommands {
  readonly localOrigin = Symbol("collaboration local session");
  private readonly undoManager: Y.UndoManager;
  private pendingTargets: HistoryTarget[] = [];
  private pendingReads: (() => unknown)[] = [];
  private pendingFallbacks: OrderFallback[] = [];
  private orderFallbacks: OrderFallback[] = [];

  constructor(private readonly doc: Y.Doc) {
    const model = assertDocument(doc);
    this.undoManager = new Y.UndoManager(Object.values(model), {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: 0,
      ignoreRemoteMapChanges: false,
      deleteFilter: item => {
        const parent = item.parent;
        // Order slots are immutable history. Undo only changes the active pointer.
        if (parent instanceof Y.Array && parent._item?.parentSub === "slots" &&
          parent._item.parent instanceof Y.Map && parent._item.parent._item?.parent === model.orders) return false;
        if (parent instanceof Y.Map && item.parentSub && parent._map.get(item.parentSub) === item) {
          const fallback = this.orderFallbacks.find(ref => ref.map === parent && ref.key === item.parentSub);
          // Yjs may be unable to redo an older map item overwritten concurrently.
          // This is part of the local Undo transaction, not projection repair.
          if (fallback && fallback.value !== undefined) parent.set(fallback.key, fallback.value);
        }
        return true;
      },
    });
    this.undoManager.on("stack-item-added", ({ stackItem, origin }) => {
      if (origin === this.localOrigin) {
        stackItem.meta.set(TARGETS, this.pendingTargets);
        stackItem.meta.set(READS, this.pendingReads);
        stackItem.meta.set(FALLBACKS, this.pendingFallbacks);
      }
    });
  }

  /** Call on commit (pointer up), not on every drag frame. All moves form one operation. */
  moveMembers(moves: readonly MemberMove[]): number {
    const model = getSupportedModel(this.doc);
    const targets = new Set<string>();
    const changes: MemberMove[] = [];
    for (const move of moves) {
      if (!model.scenes.has(move.sceneId) || !model.members.has(move.memberId) || deleted(this.doc, "members", move.memberId) || deleted(this.doc, "scenes", move.sceneId)) {
        throw new Error("Unknown move target");
      }
      assertPosition(move.position);
      if (targets.has(key(move))) throw new Error("Duplicate move target");
      targets.add(key(move));
      if (!equal(readPosition(this.doc, move.sceneId, move.memberId), move.position)) {
        changes.push({ sceneId: move.sceneId, memberId: move.memberId,
          position: { x: move.position.x, y: move.position.y } });
      }
    }
    if (!changes.length) return 0;
    this.pendingTargets = changes.map(({ sceneId, memberId }) => ({ sceneId, memberId }));
    this.pendingReads = changes.map(move => () => deleted(this.doc, "members", move.memberId) || deleted(this.doc, "scenes", move.sceneId) ? undefined : readPosition(this.doc, move.sceneId, move.memberId));
    try {
      this.doc.transact(() => {
        for (const move of changes) {
          model.scenes.get(move.sceneId)!.get("positions")!.set(move.memberId, move.position);
        }
      }, this.localOrigin);
    } finally {
      this.pendingTargets = [];
      this.pendingReads = [];
    }
    return changes.length;
  }

  applyRecipe(before: Project, after: Project, sharedDocumentId?: string | null): number {
    if (getSupportedModel(this.doc).metadata.get("schemaVersion") !== 2) throw new Error("Full editing requires schema 2");
    return this.execute(planRecipe(this.doc, before, after, sharedDocumentId));
  }
  restoreEntity(root: EntityRoot, id: string): number { return this.execute(planRestore(this.doc, root, id)); }
  executePrepared(writes: PlannedWrite[]): number { return this.execute(writes); }
  moveEntity(root: EntityRoot, id: string, beforeId?: string): number {
    const model = getSupportedModel(this.doc), key = orderKey(root);
    if (!model[root].has(id) || deleted(this.doc, root, id) || beforeId && !model[root].has(beforeId)) return 0;
    return this.execute([{ target: { entityType: root, entityId: id, field: "order" },
      orderReference: { map: order(this.doc, key)!.get("active") as Y.Map<unknown>, key: id },
      read: () => (order(this.doc, key)?.get("active") as Y.Map<string> | undefined)?.get(id),
      write: () => moveSlot(this.doc, key, id, beforeId) }]);
  }
  private execute(writes: PlannedWrite[]): number {
    if (!writes.length) return 0;
    this.pendingTargets = writes.map(w => ({ ...w.target }));
    this.pendingReads = writes.map(w => () => {
      const { entityType, entityId, field } = w.target;
      if (field !== "existence" && ENTITY_ROOTS.includes(entityType as EntityRoot)) {
        if (deleted(this.doc, entityType as EntityRoot, entityId)) return undefined;
        if (entityType === "scenes") {
          for (const prefix of ["positions.", "memberVisibility.", "memberAppearanceOverrides."])
            if (field.startsWith(prefix) && deleted(this.doc, "members", field.slice(prefix.length))) return undefined;
          if (field.startsWith("groupVisibility.") && deleted(this.doc, "memberGroups", field.slice("groupVisibility.".length))) return undefined;
          if (field.startsWith("objectStates.")) {
            const objectId = field.slice("objectStates.".length).replace(/\.(geometry|visible|zIndex)$/, "");
            if (deleted(this.doc, "stageObjects", objectId)) return undefined;
          }
        }
      }
      return w.read();
    });
    this.pendingFallbacks = writes.filter(w => w.orderReference).map(w => ({ ...w.orderReference!, value: w.read() }));
    try { this.doc.transact(() => writes.forEach(w => w.write()), this.localOrigin); }
    finally { this.pendingTargets = []; this.pendingReads = []; this.pendingFallbacks = []; }
    return writes.length;
  }

  get canUndo(): boolean { return this.undoManager.canUndo(); }
  get canRedo(): boolean { return this.undoManager.canRedo(); }
  undo(): HistoryResult { return this.reverse("undo"); }
  redo(): HistoryResult { return this.reverse("redo"); }
  destroy(): void { this.undoManager.destroy(); }

  private reverse(direction: "undo" | "redo"): HistoryResult {
    // Yjs can consume several completely superseded items before finding one to undo.
    // Report all consumed items, rather than claiming only the top item was attempted.
    const stack = direction === "undo" ? this.undoManager.undoStack : this.undoManager.redoStack;
    const opposite = direction === "undo" ? this.undoManager.redoStack : this.undoManager.undoStack;
    const items = [...stack];
    const candidates = new Map<string, { target: HistoryTarget; read: () => unknown }>();
    for (const item of items) {
      ((item.meta.get(TARGETS) ?? []) as HistoryTarget[]).forEach((target, i) => candidates.set(JSON.stringify(target), { target, read: item.meta.get(READS)[i] }));
    }
    const before = new Map([...candidates].map(([id, candidate]) => [id, candidate.read()]));
    const oppositeLength = opposite.length;
    this.orderFallbacks = [...items].reverse().flatMap(item => (item.meta.get(FALLBACKS) ?? []) as OrderFallback[]);
    const inverseFallbacks = this.orderFallbacks.map(ref => ({ ...ref, value: ref.map.get(ref.key) }));
    try { this.undoManager[direction](); }
    finally { this.orderFallbacks = []; }
    const consumed = items.slice(stack.length).reverse();
    const attempted = new Map<string, HistoryTarget>();
    for (const item of consumed) {
      for (const target of (item.meta.get(TARGETS) ?? []) as HistoryTarget[]) attempted.set(JSON.stringify(target), target);
    }
    const changed: HistoryTarget[] = [];
    const skipped: HistoryTarget[] = [];
    for (const [id, target] of attempted) {
      (same(before.get(id), candidates.get(id)!.read()) ? skipped : changed).push(target);
    }
    if (opposite.length > oppositeLength) {
      // Caller-owned result arrays must not be able to corrupt future Redo metadata.
      opposite[opposite.length - 1].meta.set(TARGETS, changed.map(target => ({ ...target })));
      opposite[opposite.length - 1].meta.set(READS, changed.map(target => candidates.get(JSON.stringify(target))!.read));
      opposite[opposite.length - 1].meta.set(FALLBACKS, inverseFallbacks);
    }
    return {
      status: !consumed.length ? "empty" : !changed.length ? "blocked" : skipped.length ? "partial" : "applied",
      consumedOperations: consumed.length, attempted: [...attempted.values()], changed, skipped,
    };
  }
}

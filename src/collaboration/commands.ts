import * as Y from "yjs";
import type { Position } from "../types";
import { assertDocument, assertPosition, getSupportedModel, readPosition } from "./model";

export type PositionTarget = { sceneId: string; memberId: string };
export type MemberMove = PositionTarget & { position: Position };
export type HistoryResult = {
  status: "empty" | "applied" | "partial" | "blocked";
  consumedOperations: number;
  attempted: PositionTarget[];
  changed: PositionTarget[];
  skipped: PositionTarget[];
};
const TARGETS = Symbol("position targets");
const key = (target: PositionTarget) => JSON.stringify([target.sceneId, target.memberId]);
const equal = (a: Position | undefined, b: Position | undefined) => a?.x === b?.x && a?.y === b?.y;

/** One instance per local editing session. Remote/init/null origins are not tracked. */
export class CollaborationCommands {
  readonly localOrigin = Symbol("collaboration local session");
  private readonly undoManager: Y.UndoManager;
  private pendingTargets: PositionTarget[] = [];

  constructor(private readonly doc: Y.Doc) {
    const model = assertDocument(doc);
    this.undoManager = new Y.UndoManager(model.scenes, {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: 0,
      ignoreRemoteMapChanges: false,
    });
    this.undoManager.on("stack-item-added", ({ stackItem, origin }) => {
      if (origin === this.localOrigin) stackItem.meta.set(TARGETS, this.pendingTargets);
    });
  }

  /** Call on commit (pointer up), not on every drag frame. All moves form one operation. */
  moveMembers(moves: readonly MemberMove[]): number {
    const model = getSupportedModel(this.doc);
    const targets = new Set<string>();
    const changes: MemberMove[] = [];
    for (const move of moves) {
      if (!model.scenes.has(move.sceneId) || !model.members.has(move.memberId)) {
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
    try {
      this.doc.transact(() => {
        for (const move of changes) {
          model.scenes.get(move.sceneId)!.get("positions")!.set(move.memberId, move.position);
        }
      }, this.localOrigin);
    } finally {
      this.pendingTargets = [];
    }
    return changes.length;
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
    const candidates = new Map<string, PositionTarget>();
    for (const item of items) {
      for (const target of (item.meta.get(TARGETS) ?? []) as PositionTarget[]) candidates.set(key(target), target);
    }
    const before = new Map([...candidates].map(([id, target]) =>
      [id, readPosition(this.doc, target.sceneId, target.memberId)]));
    const oppositeLength = opposite.length;
    this.undoManager[direction]();
    const consumed = items.slice(stack.length).reverse();
    const attempted = new Map<string, PositionTarget>();
    for (const item of consumed) {
      for (const target of (item.meta.get(TARGETS) ?? []) as PositionTarget[]) attempted.set(key(target), target);
    }
    const changed: PositionTarget[] = [];
    const skipped: PositionTarget[] = [];
    for (const [id, target] of attempted) {
      (equal(before.get(id), readPosition(this.doc, target.sceneId, target.memberId)) ? skipped : changed).push(target);
    }
    if (opposite.length > oppositeLength) {
      // Caller-owned result arrays must not be able to corrupt future Redo metadata.
      opposite[opposite.length - 1].meta.set(TARGETS, changed.map(target => ({ ...target })));
    }
    return {
      status: !consumed.length ? "empty" : !changed.length ? "blocked" : skipped.length ? "partial" : "applied",
      consumedOperations: consumed.length, attempted: [...attempted.values()], changed, skipped,
    };
  }
}

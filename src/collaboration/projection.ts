import type * as Y from "yjs";
import type { Project } from "../types";
import { assertDocument } from "./model";

/** Partial projection for round 1: every field except positions comes from base.
 * Reject mismatched bases rather than silently dropping entities or stale coordinates. */
export function projectSharedDocument(doc: Y.Doc, base: Project): Project {
  const model = assertDocument(doc);
  if (model.metadata.get("projectId") !== base.id ||
      model.members.size !== base.members.length || model.scenes.size !== base.frames.length ||
      new Set(base.members.map(member => member.id)).size !== base.members.length ||
      new Set(base.frames.map(frame => frame.id)).size !== base.frames.length ||
      base.members.some(member => !model.members.has(member.id)) ||
      base.frames.some(frame => !model.scenes.has(frame.id))) {
    throw new Error("Project base does not match collaboration document");
  }
  return {
    ...base,
    frames: base.frames.map(frame => ({
      ...frame,
      positions: Object.fromEntries([...model.scenes.get(frame.id)!.get("positions")!]
        .map(([id, value]) => [id, { x: value.x, y: value.y }])),
    })),
  };
}

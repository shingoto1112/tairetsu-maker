import * as Y from "yjs";
import type { Project } from "../types";
import { planRecipe } from "./recipeCommands";
import { SHARED_DOCUMENT_LIMITS } from "../config/collaborationLimits";

/** Measure one transaction on an isolated clone with the live writer identity.
 * No writes, history, publication or outbox entries on the live Doc. */
export function recipeUpdateBytes(doc: Y.Doc, before: Project, after: Project, sharedDocumentId?: string | null): number {
  const preview = new Y.Doc();
  try {
    Y.applyUpdate(preview, Y.encodeStateAsUpdate(doc));
    preview.clientID = doc.clientID;
    let bytes = 0;
    preview.on("update", (update: Uint8Array) => { bytes += update.byteLength; });
    const writes = planRecipe(preview, before, after, sharedDocumentId);
    preview.transact(() => writes.forEach(write => write.write()));
    return bytes;
  } finally { preview.destroy(); }
}

export function assertRecipeUpdateSize(doc: Y.Doc, before: Project, after: Project, sharedDocumentId?: string | null,
  limit: number = SHARED_DOCUMENT_LIMITS.updateBytes): void {
  if (recipeUpdateBytes(doc, before, after, sharedDocumentId) > limit)
    throw new Error("共同編集の1回の更新上限（256KiB）を超えるため、確定できません。シーン数などを減らしてからお試しください。");
}

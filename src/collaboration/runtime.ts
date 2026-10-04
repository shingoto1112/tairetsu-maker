// Internal static dependencies live behind index.ts's dynamic import boundary.
export { createSharedDocument, joinSharedDocument, readPosition } from "./model";
export { projectSharedDocument } from "./projection";
export { CollaborationCommands } from "./commands";
export type { MemberMove, PositionTarget, HistoryResult } from "./commands";
export { encodeStateAsUpdate, encodeStateVector, applyUpdate } from "yjs";
export { REMOTE_ORIGIN } from "./model";
export { createCollaborationData, hydrateCollaboration, encodeUpdate, decodeUpdate, compactCollaboration } from "./persistence";
export { CollaborationProvider } from "./provider";
export { createSupabaseTransport } from "./supabaseTransport";
export { SharedProjectEditor } from "./editorSession";
export type { ProviderState, ProviderError } from "./provider";

// Load dynamically at the future platform-selection boundary. No App/barrel import.
import { registerPlugin } from "@capacitor/core";
import { serializeProject, validateProjectStructure } from "../project/codec";
import type { Project } from "../types";
import { assertStorageId } from "./ids";
import {
  assertRevision, isRevision, RepositoryError, REPOSITORY_ERROR_MESSAGES,
  type CommitReceipt, type CommitRequest, type ListQuery, type Page, type ProjectRecord,
  type ProjectRepository, type ProjectSummary, type RemoveRequest, type RenameRequest,
  type RepositoryErrorCode, type RepositoryHealth,
} from "./types";

type JsonCall = (input: { json: string }) => Promise<{ json: string }>;
export type NativeRepositoryPlugin = Record<
  "initialize" | "listSummaries" | "readProject" | "commitProject" | "touchOpened" |
  "renameProject" | "removeProject" | "createRecoveryBackup", JsonCall>;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const validSummary = (s: unknown): s is ProjectSummary => object(s) &&
  typeof s.id === "string" && typeof s.title === "string" && ["stage", "parade"].includes(s.mode as string) &&
  typeof s.createdAt === "string" && typeof s.updatedAt === "string" &&
  (s.lastOpenedAt === undefined || typeof s.lastOpenedAt === "string") &&
  Number.isInteger(s.memberCount) && (s.memberCount as number) >= 0 &&
  Number.isInteger(s.sceneCount) && (s.sceneCount as number) >= 0 &&
  isRevision(s.repositoryRevision) && s.syncStatus === "local" &&
  (s.audioId === undefined || typeof s.audioId === "string");
const summary = (value: unknown): ProjectSummary => {
  if (!validSummary(value)) throw new RepositoryError("CORRUPT");
  try { assertStorageId(value.id); if (value.audioId !== undefined) assertStorageId(value.audioId); }
  catch { throw new RepositoryError("CORRUPT"); }
  return value;
};
const receipt = (v: unknown, operationId: string, id: string): CommitReceipt => {
  if (!object(v) || v.id !== id || v.operationId !== operationId || !isRevision(v.repositoryRevision) || !isRevision(v.localRevision)) {
    throw new RepositoryError("CORRUPT", operationId);
  }
  const s = summary(v.summary);
  if (s.id !== v.id || s.repositoryRevision !== v.repositoryRevision) throw new RepositoryError("CORRUPT", operationId);
  return v as CommitReceipt;
};
export const classifyNativeRepositoryError = (e: unknown, operationId?: string): RepositoryError => {
  if (e instanceof RepositoryError) return new RepositoryError(e.code, operationId ?? e.operationId);
  const code = object(e) && typeof e.code === "string" && Object.prototype.hasOwnProperty.call(REPOSITORY_ERROR_MESSAGES, e.code)
    ? e.code as RepositoryErrorCode : "IO_ERROR";
  return new RepositoryError(code, operationId);
};

export class NativeSqliteProjectRepository implements ProjectRepository {
  constructor(private readonly plugin: NativeRepositoryPlugin = registerPlugin<NativeRepositoryPlugin>("ProjectRepository")) {}

  private async invoke(method: keyof NativeRepositoryPlugin, input: unknown = {}, operationId?: string): Promise<unknown> {
    // Serialize before the first await: subsequent editor mutation cannot alter this snapshot.
    let json: string;
    try { json = JSON.stringify(input); } catch { throw new RepositoryError("INVALID_ARGUMENT", operationId); }
    let response: { json: string };
    try { response = await this.plugin[method]({ json }); }
    catch (e) { throw classifyNativeRepositoryError(e, operationId); }
    try {
      if (!object(response) || typeof response.json !== "string") throw new Error();
      return JSON.parse(response.json) as unknown;
    } catch { throw new RepositoryError("CORRUPT", operationId); }
  }
  async initialize(): Promise<RepositoryHealth> {
    const v = await this.invoke("initialize");
    if (!object(v) || v.status !== "ready" || v.schemaVersion !== 1 || !Array.isArray(v.errors) || v.errors.length) throw new RepositoryError("CORRUPT");
    return v as RepositoryHealth;
  }
  async list(query: ListQuery): Promise<Page<ProjectSummary>> {
    const { limit, mode, cursor } = query;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (mode !== undefined && mode !== "stage" && mode !== "parade") ||
        (cursor !== undefined && typeof cursor !== "string")) throw new RepositoryError("INVALID_ARGUMENT");
    const v = await this.invoke("listSummaries", { limit, mode, cursor });
    if (!object(v) || !Array.isArray(v.items) || v.items.length > limit ||
        (v.nextCursor !== null && typeof v.nextCursor !== "string")) throw new RepositoryError("CORRUPT");
    return { items: v.items.map(summary), nextCursor: v.nextCursor as string | null };
  }
  async get(id: string): Promise<ProjectRecord | null> {
    assertStorageId(id);
    const v = await this.invoke("readProject", { id });
    if (v === null) return null;
    if (!object(v) || typeof v.json !== "string" || !isRevision(v.repositoryRevision) || !isRevision(v.localRevision) || v.sync !== null) throw new RepositoryError("CORRUPT");
    let project: Project;
    try {
      const checked = validateProjectStructure(JSON.parse(v.json));
      if (!checked.ok) throw checked.error;
      const encoded = serializeProject(checked.value);
      if (!encoded.ok || checked.value.id !== id) throw new Error();
      // Repository bodies are already normalized. Do not generate IDs/defaults at read time.
      project = checked.value;
    } catch { throw new RepositoryError("CORRUPT"); }
    return { project, repositoryRevision: v.repositoryRevision, localRevision: v.localRevision, sync: null };
  }
  async commit(input: CommitRequest): Promise<CommitReceipt> {
    const encoded = serializeProject(input.project);
    if (!encoded.ok) throw encoded.error;
    const id = assertStorageId(input.project.id), op = assertStorageId(input.operationId);
    assertRevision(input.localRevision);
    if (input.expectedRepositoryRevision !== null) assertRevision(input.expectedRepositoryRevision);
    const v = await this.invoke("commitProject", { id, json: encoded.value, localRevision: input.localRevision,
      expectedRepositoryRevision: input.expectedRepositoryRevision, operationId: op }, op);
    return receipt(v, op, id);
  }
  async touchOpened(id: string, at: string): Promise<ProjectSummary> {
    assertStorageId(id);
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new RepositoryError("INVALID_ARGUMENT");
    const s = summary(await this.invoke("touchOpened", { id, openedAt: at }));
    if (s.id !== id || s.lastOpenedAt !== at) throw new RepositoryError("CORRUPT");
    return s;
  }
  async rename(input: RenameRequest): Promise<CommitReceipt> {
    const id = assertStorageId(input.id), op = assertStorageId(input.operationId);
    assertRevision(input.localRevision); assertRevision(input.expectedRepositoryRevision);
    if (typeof input.title !== "string" || !input.title.trim() || !Number.isFinite(Date.parse(input.updatedAt))) throw new RepositoryError("INVALID_ARGUMENT", op);
    return receipt(await this.invoke("renameProject", input, op), op, id);
  }
  async remove(input: RemoveRequest): Promise<void> {
    assertStorageId(input.id); const op = assertStorageId(input.operationId); assertRevision(input.expectedRepositoryRevision);
    if (await this.invoke("removeProject", input, op) !== null) throw new RepositoryError("CORRUPT", op);
  }
  async createRecoveryBackup(): Promise<{ created: true }> {
    const v = await this.invoke("createRecoveryBackup");
    if (!object(v) || v.created !== true) throw new RepositoryError("CORRUPT");
    return { created: true };
  }
}

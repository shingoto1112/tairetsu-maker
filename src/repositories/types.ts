import type { FormationMode, Project } from "../types";

/** Canonical unsigned decimal: "0" or [1-9][0-9]*. Never convert to JS Number.
 * Project.version, storage schema version and these revisions are independent.
 */
export type Revision = string;

export const isRevision = (value: unknown): value is Revision =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.exec(value)?.[0] === value;

export const assertRevision = (value: unknown): Revision => {
  if (!isRevision(value)) throw new RepositoryError("INVALID_ARGUMENT");
  return value;
};

export const compareRevisions = (a: Revision, b: Revision): -1 | 0 | 1 => {
  assertRevision(a);
  assertRevision(b);
  if (a === b) return 0;
  return a.length === b.length ? (a < b ? -1 : 1) : (a.length < b.length ? -1 : 1);
};

export const incrementRevision = (value: Revision): Revision => {
  assertRevision(value);
  const digits = value.split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] !== "9") {
      digits[i] = String(Number(digits[i]) + 1);
      return digits.join("");
    }
    digits[i] = "0";
  }
  return `1${digits.join("")}`;
};

/** Types only in this phase; a dedicated atomic sync API comes later. */
export type PersonalSyncState = {
  accountId: string;
  cloudProjectId: string;
  baseServerRevision: Revision;
  syncedLocalRevision: Revision;
  pendingOperationId?: string;
  status: "synced" | "pending" | "conflict" | "auth-required" | "error";
};

export type ProjectSummary = {
  id: string;
  title: string;
  mode: FormationMode;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  memberCount: number;
  sceneCount: number;
  audioId?: string;
  repositoryRevision: Revision;
  syncStatus: "local" | "pending" | "synced" | "conflict" | "error";
};

export type ProjectRecord = {
  project: Project;
  repositoryRevision: Revision;
  localRevision: Revision;
  sync: PersonalSyncState | null;
  /** Independent of personal sync. Missing/null means an independent project. */
  collaboration?: CollaborationData | null;
};

/** JSON bridge contract: canonical base64 Yjs V1 state updates, not Y.Snapshot. */
export type CollaborationUpdate = { updateId: string; bytes: string; source: "local" | "remote" };
export type CollaborationOutbox = { updateId: string; bytes: string; status: "pending" | "sent" };
export type CollaborationData = {
  schemaVersion: 1;
  sharedDocumentId: string | null;
  documentSchema: 1 | 2;
  generation: Revision;
  base: string;
  journal: CollaborationUpdate[];
  outbox: CollaborationOutbox[];
  serverCursor: Revision;
  /** Immutable sender identity for this attachment. Missing old records are held. */
  transportBinding?: { accountId: string; membershipGeneration: string };
};

export type CommitRequest = {
  project: Project;
  /** Shared records must explicitly supply their complete attachment on every commit. */
  collaboration?: CollaborationData | null;
  localRevision: Revision;
  /** null means create only. A mismatch must leave ALL stored data unchanged. */
  expectedRepositoryRevision: Revision | null;
  /** Unique per logical operation; exact retry returns its original receipt. */
  operationId: string;
};

export type CommitReceipt = {
  id: string;
  operationId: string;
  repositoryRevision: Revision;
  /** The submitted snapshot's revision, never the editor's newer revision. */
  localRevision: Revision;
  summary: ProjectSummary;
};

export type RenameRequest = {
  id: string;
  title: string;
  updatedAt: string;
  localRevision: Revision;
  expectedRepositoryRevision: Revision;
  operationId: string;
};

export type RemoveRequest = {
  id: string;
  expectedRepositoryRevision: Revision;
  operationId: string;
};

/** Default order: (lastOpenedAt ?? updatedAt ?? createdAt) DESC, id ASC.
 * Compare parsed epoch milliseconds (invalid dates rank as 0), then IDs by
 * Unicode scalar order, without locale collation. A cursor is opaque, bound to
 * the filter and last sort key. Pages are live, not a snapshot across writes.
 */
export type ListQuery = {
  limit: number; // integer 1..100
  cursor?: string;
  mode?: FormationMode;
};
export type Page<T> = { items: T[]; nextCursor: string | null };

export type RepositoryHealth = {
  status: "ready" | "degraded";
  schemaVersion: number;
  errors: RepositoryErrorCode[];
};

/** Implementations reject with RepositoryError, never swallow unreadable data.
 * Mutations atomically persist body, summary and revision; resolve only after
 * IDB transaction completion / SQLite COMMIT. Inputs/outputs are detached.
 * New records start at repositoryRevision "1". Content edits (including rename)
 * require localRevision > stored localRevision. CAS precedes all writes.
 * touchOpened changes body + summary + repositoryRevision, not localRevision
 * or updatedAt. remove of a missing ID is NOT_FOUND; exact retries succeed.
 * An operationId reused for different input is CONFLICT. Receipt retention and
 * response-loss lookup will be specified with durable adapter/recovery APIs.
 */
export interface ProjectRepository {
  initialize(): Promise<RepositoryHealth>;
  list(query: ListQuery): Promise<Page<ProjectSummary>>;
  /** null ONLY means absent; corrupt/inaccessible data rejects. */
  get(id: string): Promise<ProjectRecord | null>;
  commit(input: CommitRequest): Promise<CommitReceipt>;
  touchOpened(id: string, at: string): Promise<ProjectSummary>;
  rename(input: RenameRequest): Promise<CommitReceipt>;
  remove(input: RemoveRequest): Promise<void>;
}

export const REPOSITORY_ERROR_MESSAGES = {
  NO_SPACE: "空き容量が不足して保存できません。編集内容は画面に残っています。",
  QUOTA_EXCEEDED: "空き容量が不足して保存できません。編集内容は画面に残っています。",
  ACCESS_DENIED: "保存領域にアクセスできません。端末のロックを解除して再試行してください。",
  DEVICE_LOCKED: "保存領域にアクセスできません。端末のロックを解除して再試行してください。",
  CORRUPT: "保存データを読み込めません。復元可能な前の保存を確認します。",
  UNSUPPORTED_SCHEMA: "このデータは新しい版のアプリで保存されています。",
  CONFLICT: "別の画面で更新されています。両方の内容を残して確認します。",
  BUSY: "保存できませんでした。再試行できます。",
  IO_ERROR: "保存できませんでした。再試行できます。",
  NOT_FOUND: "隊列表が見つかりません。",
  INVALID_ID: "隊列表または音源のIDが不正です。",
  INVALID_ARGUMENT: "保存処理に必要な情報が不正です。",
} as const;
export type RepositoryErrorCode = keyof typeof REPOSITORY_ERROR_MESSAGES;

export class RepositoryError extends Error {
  readonly name = "RepositoryError";
  readonly retryable: boolean;
  constructor(
    readonly code: RepositoryErrorCode,
    readonly operationId?: string,
  ) {
    super(REPOSITORY_ERROR_MESSAGES[code]);
    this.retryable = code === "BUSY" || code === "IO_ERROR" || code === "DEVICE_LOCKED";
  }
}

export type RepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RepositoryError };

import type { ProjectRepository, ProjectRecord, ProjectSummary } from "../repositories/types";
import { incrementRevision, RepositoryError } from "../repositories/types";
import type { StorageBootstrapResult } from "./migrationCoordinator";
import { Capacitor } from "@capacitor/core";
import { getAppRuntime } from "../platform/runtime";

let persistenceAttempted = false;
export const prepareAppRepository = async (onProgress: (progress: { completed: number; total: number }) => void) => {
  // The dev-only ?runtime=capacitor-ios preview runs in a browser without the native
  // plugin; it keeps the iPad UI but stores in IndexedDB. Real devices always use SQLite.
  const native = getAppRuntime() === "capacitor-ios" && Capacitor.isNativePlatform();
  if (!native && !persistenceAttempted) {
    persistenceAttempted = true;
    try { console.info("Project storage persistence:", await navigator.storage?.persist?.() ?? "unsupported"); }
    catch { console.info("Project storage persistence: unavailable"); }
  }
  const repository = native
    ? new (await import("../repositories/nativeSqliteRepository")).NativeSqliteProjectRepository()
    : new (await import("../repositories/indexedDbRepository")).IndexedDbProjectRepository();
  const readers = native ? { native: await (await import("./legacyReaders")).createCapacitorLegacyReader(), includeDrafts: false } : { includeDrafts: false };
  const result: StorageBootstrapResult = await (await import("./bootstrap")).runStorageBootstrap({ repository, readers, onProgress });
  return { repository, result };
};

/** Existing UI displays all cards. Read summaries only; cursor pages are live.
 * Deduplicate IDs when another window moves a card between pages. */
export const listAllSummaries = async (repository: ProjectRepository): Promise<ProjectSummary[]> => {
  const items = new Map<string, ProjectSummary>();
  let cursor: string | undefined;
  do {
    const page = await repository.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    page.items.forEach(s => items.set(s.id, s)); cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return [...items.values()];
};

export const getRequiredProject = async (repository: ProjectRepository, id: string): Promise<ProjectRecord> => {
  const record = await repository.get(id);
  if (!record) throw new RepositoryError("NOT_FOUND");
  return record;
};

export const readOpenedProject = async (repository: ProjectRepository, id: string): Promise<ProjectRecord> => {
  const record = await getRequiredProject(repository, id);
  const at = new Date().toISOString();
  const summary = await repository.touchOpened(id, at);
  // touchOpened has no CAS argument. Never attach a newer CAS revision to an
  // old body if another window committed between get and touchOpened.
  if (summary.repositoryRevision !== incrementRevision(record.repositoryRevision)) return getRequiredProject(repository, id);
  return { ...record, project: { ...record.project, lastOpenedAt: at }, repositoryRevision: summary.repositoryRevision };
};

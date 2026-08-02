import type { Project } from "../types";
import { isIPadNativeApp } from "./runtime";

const DRAFT_DIRECTORY = "personal-cloud-drafts";
const draftWriteQueues = new Map<string, Promise<void>>();

export type PersonalCloudDraft = {
  baseUpdatedAt: string | null;
  cloudProjectId: string;
  project: Project;
  savedAt: string;
};

const getDraftPaths = (cloudProjectId: string) => {
  const basePath = `${DRAFT_DIRECTORY}/${encodeURIComponent(cloudProjectId)}`;
  return {
    backup: `${basePath}.backup.json`,
    primary: `${basePath}.json`,
    temporary: `${basePath}.pending.json`,
  };
};

const parseDraft = (
  value: string,
  cloudProjectId: string,
): PersonalCloudDraft | null => {
  try {
    const draft = JSON.parse(value) as Partial<PersonalCloudDraft>;
    if (
      draft.cloudProjectId !== cloudProjectId ||
      !draft.project ||
      typeof draft.project !== "object" ||
      typeof draft.savedAt !== "string" ||
      !(
        draft.baseUpdatedAt === null ||
        typeof draft.baseUpdatedAt === "string"
      )
    ) {
      return null;
    }
    return draft as PersonalCloudDraft;
  } catch {
    return null;
  }
};

const getSavedAtTime = (draft: PersonalCloudDraft): number => {
  const time = Date.parse(draft.savedAt);
  return Number.isFinite(time) ? time : 0;
};

const readNativeText = async (path: string): Promise<string | null> => {
  const { Directory, Encoding, Filesystem } =
    await import("@capacitor/filesystem");
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      path,
    });
    return typeof result.data === "string" ? result.data : null;
  } catch {
    return null;
  }
};

const readLatestDraft = async (
  cloudProjectId: string,
): Promise<PersonalCloudDraft | null> => {
  const paths = getDraftPaths(cloudProjectId);
  const candidates: Array<string | null> = [];
  for (const path of [paths.primary, paths.temporary, paths.backup]) {
    candidates.push(await readNativeText(path));
  }
  return candidates
    .map((value) => (value ? parseDraft(value, cloudProjectId) : null))
    .filter((draft): draft is PersonalCloudDraft => draft !== null)
    .reduce<PersonalCloudDraft | null>((latest, candidate) => {
      if (!latest || getSavedAtTime(candidate) > getSavedAtTime(latest)) {
        return candidate;
      }
      return latest;
    }, null);
};

const enqueueDraftOperation = (
  cloudProjectId: string,
  operation: () => Promise<void>,
): Promise<void> => {
  const previous = draftWriteQueues.get(cloudProjectId) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tracked = current.catch(() => undefined);
  draftWriteQueues.set(cloudProjectId, tracked);
  void tracked.finally(() => {
    if (draftWriteQueues.get(cloudProjectId) === tracked) {
      draftWriteQueues.delete(cloudProjectId);
    }
  });
  return current;
};

const ensureDraftDirectory = async (): Promise<void> => {
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  try {
    await Filesystem.mkdir({
      directory: Directory.Data,
      path: DRAFT_DIRECTORY,
      recursive: true,
    });
  } catch {
    // Existing directories are valid.
  }
};

export const readPersonalCloudDraft = async (
  cloudProjectId: string,
): Promise<PersonalCloudDraft | null> => {
  if (!isIPadNativeApp()) {
    return null;
  }
  return readLatestDraft(cloudProjectId);
};

export const writePersonalCloudDraft = async (
  draft: PersonalCloudDraft,
): Promise<void> => {
  if (!isIPadNativeApp()) {
    return;
  }
  await enqueueDraftOperation(draft.cloudProjectId, async () => {
    await ensureDraftDirectory();
    const latest = await readLatestDraft(draft.cloudProjectId);
    if (latest && getSavedAtTime(latest) > getSavedAtTime(draft)) {
      return;
    }
    const { Directory, Encoding, Filesystem } = await import(
      "@capacitor/filesystem"
    );
    const paths = getDraftPaths(draft.cloudProjectId);
    const serialized = JSON.stringify(draft);
    await Filesystem.writeFile({
      data: serialized,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      path: paths.temporary,
      recursive: true,
    });
    const existing = await readNativeText(paths.primary);
    if (existing && parseDraft(existing, draft.cloudProjectId)) {
      await Filesystem.writeFile({
        data: existing,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        path: paths.backup,
        recursive: true,
      });
    }
    try {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: paths.primary,
      });
    } catch {
      // A first save has no primary file yet.
    }
    try {
      await Filesystem.rename({
        directory: Directory.Data,
        from: paths.temporary,
        to: paths.primary,
      });
    } catch {
      await Filesystem.writeFile({
        data: serialized,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        path: paths.primary,
        recursive: true,
      });
      try {
        await Filesystem.deleteFile({
          directory: Directory.Data,
          path: paths.temporary,
        });
      } catch {
        // The primary write is sufficient if temporary cleanup fails.
      }
    }
  });
};

export const deletePersonalCloudDraft = async (
  cloudProjectId: string,
): Promise<void> => {
  if (!isIPadNativeApp()) {
    return;
  }
  await enqueueDraftOperation(cloudProjectId, async () => {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    const paths = getDraftPaths(cloudProjectId);
    await Promise.allSettled(
      [paths.primary, paths.temporary, paths.backup].map((path) =>
        Filesystem.deleteFile({
          directory: Directory.Data,
          path,
        }),
      ),
    );
  });
};

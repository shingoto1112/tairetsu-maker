import type { Project } from "../types";
import { isIPadNativeApp } from "./runtime";

const DRAFT_DIRECTORY = "personal-cloud-drafts";

export type PersonalCloudDraft = {
  baseUpdatedAt: string | null;
  cloudProjectId: string;
  project: Project;
  savedAt: string;
};

const getDraftPath = (cloudProjectId: string): string =>
  `${DRAFT_DIRECTORY}/${encodeURIComponent(cloudProjectId)}.json`;

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
  try {
    const { Directory, Encoding, Filesystem } = await import(
      "@capacitor/filesystem"
    );
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      path: getDraftPath(cloudProjectId),
    });
    if (typeof result.data !== "string") {
      return null;
    }
    const draft = JSON.parse(result.data) as PersonalCloudDraft;
    return draft.cloudProjectId === cloudProjectId && draft.project
      ? draft
      : null;
  } catch {
    return null;
  }
};

export const writePersonalCloudDraft = async (
  draft: PersonalCloudDraft,
): Promise<void> => {
  if (!isIPadNativeApp()) {
    return;
  }
  await ensureDraftDirectory();
  const { Directory, Encoding, Filesystem } = await import(
    "@capacitor/filesystem"
  );
  await Filesystem.writeFile({
    data: JSON.stringify(draft),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    path: getDraftPath(draft.cloudProjectId),
    recursive: true,
  });
};

export const deletePersonalCloudDraft = async (
  cloudProjectId: string,
): Promise<void> => {
  if (!isIPadNativeApp()) {
    return;
  }
  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path: getDraftPath(cloudProjectId),
    });
  } catch {
    // A missing draft is already the desired state.
  }
};

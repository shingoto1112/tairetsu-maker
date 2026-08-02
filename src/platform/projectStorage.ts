import type { Project } from "../types";
import { getAppRuntime } from "./runtime";

const PROJECTS_DIRECTORY = "projects";
const PROJECTS_PATH = `${PROJECTS_DIRECTORY}/projects.json`;
const PROJECTS_BACKUP_PATH = `${PROJECTS_DIRECTORY}/projects.backup.json`;
const PROJECTS_TEMP_PATH = `${PROJECTS_DIRECTORY}/projects.pending.json`;
let projectMirrorWriteQueue: Promise<void> = Promise.resolve();

export type NativeProjectsMirror = {
  projects: Project[];
  savedAt: string | null;
};

type NativeProjectsEnvelope = {
  format: "tairetsu-projects-v1";
  projects: Project[];
  savedAt: string;
};

const parseProjectsMirror = (value: string): NativeProjectsMirror | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return {
        projects: parsed.filter((item): item is Project =>
          Boolean(item && typeof item === "object"),
        ),
        savedAt: null,
      };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "projects" in parsed &&
      Array.isArray(parsed.projects)
    ) {
      return {
        projects: parsed.projects.filter((item): item is Project =>
          Boolean(item && typeof item === "object"),
        ),
        savedAt:
          "savedAt" in parsed && typeof parsed.savedAt === "string"
            ? parsed.savedAt
            : null,
      };
    }
    return null;
  } catch {
    return null;
  }
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

const getSavedAtTime = (mirror: NativeProjectsMirror): number => {
  const time = mirror.savedAt ? Date.parse(mirror.savedAt) : 0;
  return Number.isFinite(time) ? time : 0;
};

export const loadNativeProjectsMirror =
  async (): Promise<NativeProjectsMirror | null> => {
    if (getAppRuntime() !== "capacitor-ios") {
      return null;
    }
    const candidates = await Promise.all(
      [PROJECTS_PATH, PROJECTS_TEMP_PATH, PROJECTS_BACKUP_PATH].map(
        readNativeText,
      ),
    );
    const mirrors = candidates
      .map((value) => (value ? parseProjectsMirror(value) : null))
      .filter((value): value is NativeProjectsMirror => value !== null);
    return mirrors.reduce<NativeProjectsMirror | null>((latest, candidate) => {
      if (!latest || getSavedAtTime(candidate) > getSavedAtTime(latest)) {
        return candidate;
      }
      return latest;
    }, null);
  };

const writeNativeProjectsMirror = async (
  projects: Project[],
  savedAt: string,
): Promise<void> => {
  const { Directory, Encoding, Filesystem } =
    await import("@capacitor/filesystem");
  const envelope: NativeProjectsEnvelope = {
    format: "tairetsu-projects-v1",
    projects,
    savedAt,
  };
  const serialized = JSON.stringify(envelope);
  await Filesystem.writeFile({
    data: serialized,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    path: PROJECTS_TEMP_PATH,
    recursive: true,
  });
  const existing = await readNativeText(PROJECTS_PATH);
  if (existing) {
    await Filesystem.writeFile({
      data: existing,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      path: PROJECTS_BACKUP_PATH,
      recursive: true,
    });
  }
  try {
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path: PROJECTS_PATH,
    });
  } catch {
    // A first save has no primary file yet.
  }
  try {
    await Filesystem.rename({
      directory: Directory.Data,
      from: PROJECTS_TEMP_PATH,
      to: PROJECTS_PATH,
    });
  } catch {
    await Filesystem.writeFile({
      data: serialized,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      path: PROJECTS_PATH,
      recursive: true,
    });
    try {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: PROJECTS_TEMP_PATH,
      });
    } catch {
      // A completed primary write is sufficient even if cache cleanup fails.
    }
  }
};

export const saveNativeProjectsMirror = (
  projects: Project[],
  savedAt = new Date().toISOString(),
): Promise<void> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return Promise.resolve();
  }
  const write = projectMirrorWriteQueue.then(
    () => writeNativeProjectsMirror(projects, savedAt),
    () => writeNativeProjectsMirror(projects, savedAt),
  );
  projectMirrorWriteQueue = write.catch(() => undefined);
  return write;
};

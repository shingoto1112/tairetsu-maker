import { Project } from "../types";
import {
  getAppRuntime,
  loadNativeProjectsMirror,
  saveNativeProjectsMirror,
} from "../platform";

const STORAGE_KEY = "stageflow.project.v1";
const PROJECTS_STORAGE_KEY = "stageflow.projects.v1";
const PROJECTS_STORAGE_UPDATED_AT_KEY = "stageflow.projects.updatedAt.v1";

const createProjectId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const ensureProjectIdentity = (project: Project): Project => ({
  ...project,
  id: project.id ?? createProjectId(),
  createdAt: project.createdAt ?? project.updatedAt ?? new Date().toISOString(),
});

const parseProjects = (raw: string | null): Project[] => {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is Project =>
    Boolean(item && typeof item === "object"),
  );
};

const parseProjectsSnapshot = (raw: string): Project[] | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Project =>
          Boolean(item && typeof item === "object"),
        )
      : null;
  } catch {
    return null;
  }
};

const parseSavedAt = (raw: string | null): string | null => {
  if (!raw) {
    return null;
  }
  const time = Date.parse(raw);
  return Number.isFinite(time) ? raw : null;
};

const getSavedAtTime = (savedAt: string | null): number => {
  const time = savedAt ? Date.parse(savedAt) : 0;
  return Number.isFinite(time) ? time : 0;
};

const getSortTime = (project: Project): number => {
  const raw = project.lastOpenedAt ?? project.updatedAt ?? project.createdAt;
  const time = raw ? Date.parse(raw) : 0;
  return Number.isFinite(time) ? time : 0;
};

export const sortStoredProjects = (projects: Project[]): Project[] =>
  [...projects].sort((a, b) => getSortTime(b) - getSortTime(a));

export const loadProjectFromStorage = (): Project | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
};

export const loadProjectsFromStorage = (): Project[] => {
  try {
    const rawProjects = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    const projects = parseProjects(rawProjects);
    if (rawProjects !== null) {
      return sortStoredProjects(projects.map(ensureProjectIdentity));
    }
    const legacyProject = loadProjectFromStorage();
    return legacyProject ? [ensureProjectIdentity(legacyProject)] : [];
  } catch {
    const legacyProject = loadProjectFromStorage();
    return legacyProject ? [ensureProjectIdentity(legacyProject)] : [];
  }
};

export const saveProjectsToStorage = (projects: Project[]): void => {
  const uniqueProjects = new Map<string, Project>();
  projects.forEach((project) => {
    const withIdentity = ensureProjectIdentity(project);
    uniqueProjects.set(withIdentity.id as string, withIdentity);
  });
  const sortedProjects = sortStoredProjects([...uniqueProjects.values()]);
  const savedAt = new Date().toISOString();
  window.localStorage.setItem(
    PROJECTS_STORAGE_KEY,
    JSON.stringify(sortedProjects),
  );
  window.localStorage.setItem(PROJECTS_STORAGE_UPDATED_AT_KEY, savedAt);
  if (getAppRuntime() === "capacitor-ios") {
    void saveNativeProjectsMirror(sortedProjects, savedAt).catch((error) => {
      console.warn("iPadのローカル保存ミラーを更新できませんでした。", error);
    });
  }
};

export const hydrateProjectsFromNativeStorage = async (): Promise<
  Project[] | null
> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return null;
  }
  const nativeMirror = await loadNativeProjectsMirror();
  let browserRaw: string | null;
  let browserSavedAt: string | null;
  try {
    browserRaw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    browserSavedAt = parseSavedAt(
      window.localStorage.getItem(PROJECTS_STORAGE_UPDATED_AT_KEY),
    );
  } catch {
    // An unreadable library is not an intentionally empty library.
    console.warn("iPadのブラウザ保存領域を読み込めないため、端末バックアップを使用します。");
    return nativeMirror
      ? sortStoredProjects(nativeMirror.projects.map(ensureProjectIdentity))
      : null;
  }
  let browserProjects: Project[] | null = null;
  if (browserRaw !== null) {
    const parsedProjects = parseProjectsSnapshot(browserRaw);
    if (parsedProjects) {
      browserProjects = sortStoredProjects(
        parsedProjects.map(ensureProjectIdentity),
      );
    }
  } else {
    const legacyProject = loadProjectFromStorage();
    browserProjects = legacyProject
      ? [ensureProjectIdentity(legacyProject)]
      : null;
  }
  const nativeIsNewer =
    nativeMirror &&
    browserProjects &&
    nativeMirror.savedAt &&
    browserSavedAt &&
    getSavedAtTime(nativeMirror.savedAt) > getSavedAtTime(browserSavedAt);
  const useNative = nativeMirror && (!browserProjects || nativeIsNewer);
  const projects = useNative
    ? sortStoredProjects(nativeMirror.projects.map(ensureProjectIdentity))
    : browserProjects ?? [];
  const savedAt = (useNative ? nativeMirror.savedAt : browserSavedAt)
    ?? new Date().toISOString();
  // Repair failures must not hide data that was successfully recovered.
  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    window.localStorage.setItem(PROJECTS_STORAGE_UPDATED_AT_KEY, savedAt);
  } catch {
    console.warn("復元した隊列表をブラウザ保存領域へ書き戻せませんでした。");
  }
  try {
    await saveNativeProjectsMirror(projects, savedAt);
  } catch {
    console.warn("復元した隊列表の端末バックアップを更新できませんでした。");
  }
  return projects;
};

export const saveProjectToStorage = (project: Project): void => {
  const withIdentity = ensureProjectIdentity(project);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(withIdentity));
  const projects = loadProjectsFromStorage();
  const existingIndex = projects.findIndex(
    (item) => item.id === withIdentity.id,
  );
  const nextProjects =
    existingIndex >= 0
      ? projects.map((item) =>
          item.id === withIdentity.id ? withIdentity : item,
        )
      : [withIdentity, ...projects];
  saveProjectsToStorage(nextProjects);
};

export const clearProjectFromStorage = (): void => {
  window.localStorage.removeItem(STORAGE_KEY);
};

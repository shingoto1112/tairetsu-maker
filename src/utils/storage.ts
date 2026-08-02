import { Project } from "../types";
import {
  getAppRuntime,
  loadNativeProjectsMirror,
  saveNativeProjectsMirror,
} from "../platform";

const STORAGE_KEY = "stageflow.project.v1";
const PROJECTS_STORAGE_KEY = "stageflow.projects.v1";

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
  return parsed.filter((item): item is Project => Boolean(item && typeof item === "object"));
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
  window.localStorage.setItem(
    PROJECTS_STORAGE_KEY,
    JSON.stringify(sortedProjects),
  );
  if (getAppRuntime() === "capacitor-ios") {
    void saveNativeProjectsMirror(sortedProjects).catch((error) => {
      console.warn("iPadのローカル保存ミラーを更新できませんでした。", error);
    });
  }
};

export const hydrateProjectsFromNativeStorage = async (): Promise<Project[] | null> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return null;
  }
  const nativeProjects = await loadNativeProjectsMirror();
  if (nativeProjects) {
    const projects = sortStoredProjects(nativeProjects.map(ensureProjectIdentity));
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    return projects;
  }
  const browserProjects = loadProjectsFromStorage();
  await saveNativeProjectsMirror(browserProjects);
  return browserProjects;
};

export const saveProjectToStorage = (project: Project): void => {
  const withIdentity = ensureProjectIdentity(project);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(withIdentity));
  const projects = loadProjectsFromStorage();
  const existingIndex = projects.findIndex((item) => item.id === withIdentity.id);
  const nextProjects =
    existingIndex >= 0
      ? projects.map((item) => (item.id === withIdentity.id ? withIdentity : item))
      : [withIdentity, ...projects];
  saveProjectsToStorage(nextProjects);
};

export const clearProjectFromStorage = (): void => {
  window.localStorage.removeItem(STORAGE_KEY);
};

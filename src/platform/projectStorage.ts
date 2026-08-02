import type { Project } from "../types";
import { getAppRuntime } from "./runtime";

const PROJECTS_DIRECTORY = "projects";
const PROJECTS_PATH = `${PROJECTS_DIRECTORY}/projects.json`;
const PROJECTS_BACKUP_PATH = `${PROJECTS_DIRECTORY}/projects.backup.json`;

const parseProjectArray = (value: string): Project[] | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Project => Boolean(item && typeof item === "object"),
        )
      : null;
  } catch {
    return null;
  }
};

const readNativeText = async (path: string): Promise<string | null> => {
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
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

export const loadNativeProjectsMirror = async (): Promise<Project[] | null> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return null;
  }
  const primary = await readNativeText(PROJECTS_PATH);
  const primaryProjects = primary ? parseProjectArray(primary) : null;
  if (primaryProjects) {
    return primaryProjects;
  }
  const backup = await readNativeText(PROJECTS_BACKUP_PATH);
  return backup ? parseProjectArray(backup) : null;
};

export const saveNativeProjectsMirror = async (projects: Project[]): Promise<void> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return;
  }
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
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
  await Filesystem.writeFile({
    data: JSON.stringify(projects),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    path: PROJECTS_PATH,
    recursive: true,
  });
};

import JSZip from "jszip";
import type { Project } from "../types";

const TAIRETSU_APP_NAME = "隊列メーカー";
const TAIRETSU_FILE_TYPE = "tairetsu-project";
const TAIRETSU_FORMAT_VERSION = 1;

type TairetsuManifest = {
  app: string;
  exportedAt: number;
  fileType: string;
  formatVersion: number;
  includesAudio: boolean;
};

const ZIP_SIGNATURE = "PK";

export type TairetsuImportResult = {
  audioBlob: Blob | null;
  audioFileName: string | null;
  project: Project;
};

type TairetsuZipPayload = {
  audioBlob: Blob | null;
  audioFileName: string | null;
  manifest: TairetsuManifest;
  project: Project;
};

const safeJsonParse = <T>(text: string, errorMessage: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(errorMessage);
  }
};

export const sanitizeTairetsuFileName = (name: string): string => {
  const safeName = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
  return safeName || "隊列表";
};

export const createTairetsuFileName = (project: Project): string =>
  `${sanitizeTairetsuFileName(project.title || "隊列表")}.tairetsu`;

const getZipBaseName = (path: string): string => {
  const parts = path.split("/");
  return parts[parts.length - 1] || "audio";
};

const getAudioExtension = (project: Project): string => {
  const source = `${project.audio?.name ?? ""} ${project.audio?.type ?? ""}`.toLowerCase();
  if (source.includes("wav")) {
    return "wav";
  }
  if (source.includes("m4a") || source.includes("mp4")) {
    return "m4a";
  }
  if (source.includes("aac")) {
    return "aac";
  }
  if (source.includes("ogg")) {
    return "ogg";
  }
  return "mp3";
};

const isProjectLike = (value: unknown): value is Project => {
  const maybe = value as Project;
  return (
    Boolean(maybe) &&
    typeof maybe === "object" &&
    typeof maybe.title === "string" &&
    Boolean(maybe.stage) &&
    Array.isArray(maybe.members) &&
    Array.isArray(maybe.stageObjects) &&
    Array.isArray(maybe.frames)
  );
};

const normalizeZipPath = (path: string): string => path.replace(/\\/g, "/");

const getParentPath = (path: string): string => {
  const normalized = normalizeZipPath(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
};

const findProjectFilePair = (
  zip: JSZip,
): { basePath: string; manifestFile: JSZip.JSZipObject; projectFile: JSZip.JSZipObject } | null => {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const manifestCandidates = files.filter((entry) =>
    normalizeZipPath(entry.name).endsWith("manifest.json"),
  );

  for (const manifestFile of manifestCandidates) {
    const basePath = getParentPath(manifestFile.name);
    const projectFile =
      zip.file(`${basePath}project.json`) ??
      files.find(
        (entry) =>
          getParentPath(entry.name) === basePath &&
          normalizeZipPath(entry.name).endsWith("project.json"),
      ) ??
      null;
    if (projectFile) {
      return { basePath, manifestFile, projectFile };
    }
  }

  return null;
};

const readPayloadFromZip = async (
  zip: JSZip,
  sourceName: string,
): Promise<TairetsuZipPayload | null> => {
  const entries = Object.keys(zip.files);
  console.info("[tairetsu import] zip entries", entries);

  const pair = findProjectFilePair(zip);
  if (!pair) {
    return null;
  }

  const manifest = safeJsonParse<TairetsuManifest>(
    await pair.manifestFile.async("string"),
    "共有ファイルの情報を読み込めませんでした。",
  );
  console.info("[tairetsu import] manifest", manifest, { sourceName });
  if (manifest.fileType !== TAIRETSU_FILE_TYPE) {
    throw new Error("このファイルは隊列メーカーの共有ファイルではありません。");
  }
  if (manifest.formatVersion !== TAIRETSU_FORMAT_VERSION) {
    throw new Error("この共有ファイルの形式には対応していません。");
  }

  const project = safeJsonParse<unknown>(
    await pair.projectFile.async("string"),
    "隊列表データが壊れている可能性があります。",
  );
  if (!isProjectLike(project)) {
    throw new Error("隊列表データが壊れている可能性があります。");
  }

  const audioZipFile = manifest.includesAudio
    ? Object.values(zip.files).find((entry) => {
        if (entry.dir) {
          return false;
        }
        const entryPath = normalizeZipPath(entry.name);
        return (
          entryPath.startsWith(`${pair.basePath}audio/`) ||
          (pair.basePath === "" && entryPath.startsWith("audio/"))
        );
      })
    : null;
  const audioBlob = audioZipFile ? await audioZipFile.async("blob") : null;

  return {
    audioBlob,
    audioFileName: audioZipFile ? getZipBaseName(audioZipFile.name) : null,
    manifest,
    project,
  };
};

const findNestedArchive = (zip: JSZip): JSZip.JSZipObject | null =>
  Object.values(zip.files).find((entry) => {
    if (entry.dir) {
      return false;
    }
    const name = normalizeZipPath(entry.name).toLowerCase();
    return name.endsWith(".tairetsu") || name.endsWith(".zip");
  }) ?? null;

export const createTairetsuArchive = async (
  project: Project,
  options: {
    audioBlob?: Blob | null;
  } = {},
): Promise<Blob> => {
  const zip = new JSZip();
  const includesAudio = Boolean(options.audioBlob && project.audio);
  const manifest: TairetsuManifest = {
    app: TAIRETSU_APP_NAME,
    fileType: TAIRETSU_FILE_TYPE,
    formatVersion: TAIRETSU_FORMAT_VERSION,
    exportedAt: Date.now(),
    includesAudio,
  };
  const exportedProject: Project = includesAudio
    ? project
    : {
        ...project,
        audio: null,
      };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("project.json", JSON.stringify(exportedProject, null, 2));

  if (includesAudio && options.audioBlob && project.audio) {
    zip.file(`audio/audio.${getAudioExtension(project)}`, options.audioBlob);
  }

  return zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: {
      level: 6,
    },
    type: "blob",
  });
};

export const readTairetsuArchive = async (
  file: File,
): Promise<TairetsuImportResult> => {
  console.info("[tairetsu import] selected file", {
    name: file.name,
    size: file.size,
    type: file.type || "(empty)",
  });
  const buffer = await file.arrayBuffer();
  const signature = String.fromCharCode(
    ...new Uint8Array(buffer.slice(0, 2)),
  );
  if (signature !== ZIP_SIGNATURE) {
    console.warn("[tairetsu import] file does not start with PK; trying JSZip anyway", {
      signature,
    });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("ZIPファイルとして展開できませんでした。");
  }

  let payload = await readPayloadFromZip(zip, file.name);
  if (!payload) {
    const nestedArchive = findNestedArchive(zip);
    if (nestedArchive) {
      console.info("[tairetsu import] trying nested archive", nestedArchive.name);
      try {
        const nestedBuffer = await nestedArchive.async("arraybuffer");
        const nestedZip = await JSZip.loadAsync(nestedBuffer);
        payload = await readPayloadFromZip(nestedZip, nestedArchive.name);
      } catch (error) {
        console.warn("[tairetsu import] nested archive failed", error);
      }
    }
  }

  if (!payload) {
    throw new Error("manifest.json または project.json が見つかりません。");
  }

  return {
    audioBlob: payload.audioBlob,
    audioFileName: payload.audioFileName,
    project: payload.project,
  };
};

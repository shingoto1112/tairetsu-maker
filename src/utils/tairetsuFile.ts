import { validAnnotationLines, validProjectLineCount } from "../project/annotationLines";
import type JSZipType from "jszip";
import {
  MAX_AUDIO_FILE_BYTES,
  MAX_PROJECT_JSON_BYTES,
  MAX_TAIRETSU_FILE_BYTES,
  MAX_ZIP_ENTRY_COUNT,
  MAX_ZIP_UNCOMPRESSED_BYTES,
} from "../config/fileLimits";
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

type JSZip = JSZipType;
type JSZipObject = JSZipType.JSZipObject;
type JSZipConstructor = {
  new (): JSZip;
  loadAsync(data: ArrayBuffer): Promise<JSZip>;
};

let jsZipPromise: Promise<JSZipConstructor> | null = null;

const loadJsZip = () =>
  (jsZipPromise ??= import("jszip").then((module) => {
    const imported = module as unknown as {
      default?: JSZipConstructor;
    } & JSZipConstructor;
    return imported.default ?? imported;
  }));

type ZipEntryWithSize = JSZipObject & {
  _data?: {
    compressedSize?: number;
    uncompressedSize?: number;
  };
};

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

const assertSafeZip = (zip: JSZip): void => {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length > MAX_ZIP_ENTRY_COUNT) {
    throw new Error(`共有ファイル内のファイル数は${MAX_ZIP_ENTRY_COUNT}件以下にしてください。`);
  }
  const totalUncompressedBytes = files.reduce((total, entry) => {
    const size = (entry as ZipEntryWithSize)._data?.uncompressedSize;
    return total + (typeof size === "number" && Number.isFinite(size) ? size : 0);
  }, 0);
  if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error("共有ファイルの展開後サイズが大きすぎます。音源を外して再度お試しください。");
  }
};

const readZipText = async (
  entry: JSZipObject,
  maxBytes: number,
  errorMessage: string,
): Promise<string> => {
  const knownSize = (entry as ZipEntryWithSize)._data?.uncompressedSize;
  if (typeof knownSize === "number" && knownSize > maxBytes) {
    throw new Error(errorMessage);
  }
  const text = await entry.async("string");
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(errorMessage);
  }
  return text;
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
  `${sanitizeTairetsuFileName(project.title || "隊列表")}.zip`;

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
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as Partial<Project>;
  const hasRecognizableProjectShape =
    "title" in maybe ||
    "stage" in maybe ||
    "members" in maybe ||
    "stageObjects" in maybe ||
    "frames" in maybe;
  return (
    hasRecognizableProjectShape &&
    (maybe.title === undefined || typeof maybe.title === "string") &&
    (maybe.stage === undefined || typeof maybe.stage === "object") &&
    (maybe.members === undefined || Array.isArray(maybe.members)) &&
    (maybe.stageObjects === undefined || Array.isArray(maybe.stageObjects)) &&
    (maybe.frames === undefined || Array.isArray(maybe.frames))
  );
};

const normalizeZipPath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/^\/+/, "");

const getParentPath = (path: string): string => {
  const normalized = normalizeZipPath(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
};

const findProjectFilePair = (
  zip: JSZip,
): { basePath: string; manifestFile: JSZipObject; projectFile: JSZipObject } | null => {
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

const readProjectFromJsonBuffer = (buffer: ArrayBuffer): Project => {
  if (buffer.byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error("JSONファイルが大きすぎます。24MB以下のファイルを選択してください。");
  }
  const text = new TextDecoder().decode(buffer);
  const parsed = safeJsonParse<unknown>(
    text,
    "JSONファイルとして読み込めませんでした。",
  );
  const checkLines = (project: Project) => { if (!validProjectLineCount(project.frames) || project.frames.some(f => !validAnnotationLines(f.annotationLines))) throw new Error("線のデータが不正か、本数の上限を超えています。"); return project; };
  if (isProjectLike(parsed)) {
    return checkLines(parsed);
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "project" in parsed &&
    isProjectLike((parsed as { project?: unknown }).project)
  ) {
    return checkLines((parsed as { project: Project }).project);
  }
  throw new Error("隊列表のJSONデータが見つかりませんでした。");
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
    await readZipText(
      pair.manifestFile,
      1024 * 1024,
      "共有ファイルの情報が大きすぎます。",
    ),
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
    await readZipText(
      pair.projectFile,
      MAX_PROJECT_JSON_BYTES,
      "隊列表データが大きすぎます。24MB以下にしてください。",
    ),
    "隊列表データが壊れている可能性があります。",
  );
  if (!isProjectLike(project) || !validProjectLineCount(project.frames) || project.frames.some(f => !validAnnotationLines(f.annotationLines))) {
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
  if (audioBlob && audioBlob.size > MAX_AUDIO_FILE_BYTES) {
    throw new Error("共有ファイル内の音源は200MB以下にしてください。");
  }

  return {
    audioBlob,
    audioFileName: audioZipFile ? getZipBaseName(audioZipFile.name) : null,
    manifest,
    project,
  };
};

const findNestedArchive = (zip: JSZip): JSZipObject | null => {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const namedArchive = files.find((entry) => {
    if (entry.dir) {
      return false;
    }
    const name = normalizeZipPath(entry.name).toLowerCase();
    return name.endsWith(".tairetsu") || name.endsWith(".zip");
  });

  // LINEや一部の共有先では、拡張子が落ちた単一ファイル入りZIPに変わることがある。
  // その場合も中身をZIPとして展開して、manifest/projectの有無で最終判定する。
  return namedArchive ?? (files.length === 1 ? files[0] : null);
};

export const createTairetsuArchive = async (
  project: Project,
  options: {
    audioBlob?: Blob | null;
  } = {},
): Promise<Blob> => {
  const JSZip = await loadJsZip();
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
    zip.file(
      `audio/audio.${getAudioExtension(project)}`,
      await options.audioBlob.arrayBuffer(),
    );
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
  if (file.size <= 0) {
    throw new Error("選択したファイルが空です。");
  }
  if (file.size > MAX_TAIRETSU_FILE_BYTES) {
    throw new Error("隊列表ファイルは256MB以下にしてください。");
  }
  const buffer = await file.arrayBuffer();
  const signature = String.fromCharCode(
    ...new Uint8Array(buffer.slice(0, 2)),
  );
  const lowerName = file.name.toLowerCase();
  if (
    lowerName.endsWith(".json") ||
    file.type.toLowerCase().includes("json")
  ) {
    return {
      audioBlob: null,
      audioFileName: null,
      project: readProjectFromJsonBuffer(buffer),
    };
  }

  if (signature !== ZIP_SIGNATURE) {
    console.warn("[tairetsu import] file does not start with PK; trying JSZip anyway", {
      signature,
    });
  }

  let zip: JSZip;
  try {
    const JSZip = await loadJsZip();
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("ZIPファイルとして展開できませんでした。");
  }
  assertSafeZip(zip);

  let payload = await readPayloadFromZip(zip, file.name);
  if (!payload) {
    const nestedArchive = findNestedArchive(zip);
    if (nestedArchive) {
      console.info("[tairetsu import] trying nested archive", nestedArchive.name);
      try {
        const JSZip = await loadJsZip();
        const nestedBuffer = await nestedArchive.async("arraybuffer");
        if (nestedBuffer.byteLength > MAX_TAIRETSU_FILE_BYTES) {
          throw new Error("内包された隊列表ファイルが大きすぎます。");
        }
        const nestedZip = await JSZip.loadAsync(nestedBuffer);
        assertSafeZip(nestedZip);
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

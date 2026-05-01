import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { Project } from "../types";

const HASH_KEY = "project=";

export const projectToShareHash = (project: Project): string => {
  // ProjectデータだけをURL hashへ入れる。音源ファイルは含めない。
  const packed = compressToEncodedURIComponent(JSON.stringify(project));
  return `#${HASH_KEY}${packed}`;
};

export const createShareUrl = (project: Project): string => {
  const baseUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${baseUrl}${projectToShareHash(project)}`;
};

const expandSharePayload = (compressed: string): string | null => {
  const candidates = new Set<string>([
    compressed,
    compressed.replace(/\s/g, "+"),
  ]);
  try {
    const decoded = decodeURIComponent(compressed);
    candidates.add(decoded);
    candidates.add(decoded.replace(/\s/g, "+"));
  } catch {
    // URLの途中欠けなどでdecodeできない場合も、元文字列で展開を試す。
  }

  for (const candidate of candidates) {
    const json = decompressFromEncodedURIComponent(candidate);
    if (json) {
      return json;
    }
  }
  return null;
};

export const readProjectFromHash = (): Project | null => {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!hash.startsWith(HASH_KEY)) {
    return null;
  }

  const compressed = hash.slice(HASH_KEY.length);
  const json = expandSharePayload(compressed);
  if (!json) {
    throw new Error("共有リンクのデータを展開できませんでした。");
  }
  try {
    return JSON.parse(json) as Project;
  } catch {
    throw new Error("共有リンクの隊列表データが壊れている可能性があります。");
  }
};

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
  const url = new URL(window.location.href);
  url.hash = projectToShareHash(project).slice(1);
  return url.toString();
};

export const readProjectFromHash = (): Project | null => {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!hash.startsWith(HASH_KEY)) {
    return null;
  }

  const compressed = hash.slice(HASH_KEY.length);
  const json = decompressFromEncodedURIComponent(compressed);
  if (!json) {
    throw new Error("共有リンクのデータを展開できませんでした。");
  }
  return JSON.parse(json) as Project;
};

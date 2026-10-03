import { AudioMeta } from "../types";
import type { AudioSelection } from "../platform/audioStorage";
import { MAX_AUDIO_FILE_BYTES } from "../config/fileLimits";
import { runIdbTransaction } from "./idbTransaction";
import {
  deleteNativeAudioBlob,
  canUseNativeAudioStorage,
  resolveNativeAudioURL,
  loadNativeAudioBlob,
  saveNativeAudioBlob,
  validateNativeAudioMeta,
} from "../platform";

const DB_NAME = "tairetsu-maker-audio";
const DB_VERSION = 1;
const STORE_NAME = "audio-files";

type AudioRecord = {
  id: string;
  blob: Blob;
};

const createAudioId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const openAudioDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDBを利用できません。"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error("音源の保存領域を開けません。再試行してください。"));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けません。"));
  });

const withAudioStore = async <Result>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> => {
  const db = await openAudioDb();
  try {
    return await runIdbTransaction<Result>(db, STORE_NAME, mode, (transaction, result) => {
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => result(request.result);
    });
  } finally { db.close(); }
};

const readAudioDuration = (file: File): Promise<number | undefined> =>
  new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = url;
  });

export const saveAudioFileToIndexedDb = async (file: AudioSelection): Promise<AudioMeta> => {
  if (!(file instanceof File)) {
    if (!canUseNativeAudioStorage()) throw new Error("ネイティブ音源保存を利用できません。");
    return validateNativeAudioMeta(file); // Native picker already committed the file.
  }
  return saveAudioBlobToIndexedDb(file, {
    name: file.name,
    type: file.type || "audio/mpeg",
  });
};

export const saveAudioBlobToIndexedDb = async (
  blob: Blob,
  meta: {
    duration?: number;
    name: string;
    type?: string;
  },
): Promise<AudioMeta> => {
  if (blob.size <= 0) {
    throw new Error("音源ファイルが空です。");
  }
  if (blob.size > MAX_AUDIO_FILE_BYTES) {
    throw new Error("音源ファイルは200MB以下にしてください。");
  }
  const id = createAudioId();
  const type = meta.type || blob.type || "audio/mpeg";
  const file =
    blob instanceof File
      ? blob
      : new File([blob], meta.name, {
          type,
        });
  if (canUseNativeAudioStorage()) {
    return saveNativeAudioBlob(id, file, file.type || type, meta.name, meta.duration);
  } else {
    await withAudioStore("readwrite", (store) =>
      store.put({ id, blob: file } satisfies AudioRecord),
    );
  }
  return {
    id,
    name: meta.name || file.name,
    type: file.type || type,
    size: file.size,
    duration: meta.duration ?? (await readAudioDuration(file)),
  };
};

export const loadAudioBlobFromIndexedDb = async (
  audioId: string,
  meta?: AudioMeta,
): Promise<Blob | null> => {
  if (canUseNativeAudioStorage()) {
    return loadNativeAudioBlob(audioId, meta);
  }
  const record = await withAudioStore<AudioRecord | undefined>("readonly", (store) =>
    store.get(audioId),
  );
  if (record === undefined) return null;
  if (record?.id !== audioId || !(record.blob instanceof Blob)) {
    throw new Error("保存済み音源データを読み込めません。");
  }
  return record.blob;
};

export const deleteAudioBlobFromIndexedDb = async (audioId: string): Promise<void> => {
  if (canUseNativeAudioStorage()) {
    await deleteNativeAudioBlob(audioId);
    return;
  }
  try {
    await withAudioStore("readwrite", (store) => store.delete(audioId));
  } catch {
    // 音源Blobの掃除に失敗しても、隊列表データの削除は止めない。
  }
};

export const resolveAudioPlaybackURL = async (meta: AudioMeta): Promise<string | null> => {
  if (canUseNativeAudioStorage()) return resolveNativeAudioURL(meta.id, meta);
  const blob = await loadAudioBlobFromIndexedDb(meta.id);
  return blob ? URL.createObjectURL(blob) : null;
};

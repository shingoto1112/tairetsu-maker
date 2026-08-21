import { AudioMeta } from "../types";
import { MAX_AUDIO_FILE_BYTES } from "../config/fileLimits";
import {
  deleteNativeAudioBlob,
  getAppRuntime,
  loadNativeAudioBlob,
  saveNativeAudioBlob,
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けません。"));
  });

const withAudioStore = async <Result>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> => {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("音源データ処理に失敗しました。"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("音源データ処理に失敗しました。"));
    };
  });
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

export const saveAudioFileToIndexedDb = async (file: File): Promise<AudioMeta> => {
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
  if (getAppRuntime() === "capacitor-ios") {
    await saveNativeAudioBlob(id, file, file.type || type);
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
): Promise<Blob | null> => {
  if (getAppRuntime() === "capacitor-ios") {
    return loadNativeAudioBlob(audioId);
  }
  try {
    const record = await withAudioStore<AudioRecord | undefined>("readonly", (store) =>
      store.get(audioId),
    );
    return record?.blob ?? null;
  } catch {
    return null;
  }
};

export const deleteAudioBlobFromIndexedDb = async (audioId: string): Promise<void> => {
  if (getAppRuntime() === "capacitor-ios") {
    await deleteNativeAudioBlob(audioId);
    return;
  }
  try {
    await withAudioStore("readwrite", (store) => store.delete(audioId));
  } catch {
    // 音源Blobの掃除に失敗しても、隊列表データの削除は止めない。
  }
};

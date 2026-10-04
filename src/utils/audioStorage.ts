import { AudioMeta } from "../types";
import type { AudioSelection } from "../platform/audioStorage";
import { MAX_AUDIO_FILE_BYTES } from "../config/fileLimits";
import { runIdbTransaction } from "./idbTransaction";
import { withStorageWrite } from "../storage/maintenanceLock";
import type { GCResult } from "../storage/maintenanceTypes";
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
  pending?: boolean;
  meta?: AudioMeta;
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
    const audioMeta: AudioMeta = { id, name: meta.name || file.name, type: file.type || type, size: file.size,
      duration: meta.duration ?? (await readAudioDuration(file)) };
    await withStorageWrite(() => withAudioStore("readwrite", (store) =>
      store.put({ id, blob: file, pending: true, meta: audioMeta } satisfies AudioRecord),
    ));
    return audioMeta;
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

/** Metadata only; no Blob read into JS memory or native paths returned. Old
 * records are supplemented by Repository references at the shared-session edge. */
export const listDeviceAudio = async (): Promise<AudioMeta[]> => {
  if (canUseNativeAudioStorage()) {
    const { nativeAudio, validateNativeAudioMeta } = await import("../platform/audioStorage");
    return (await nativeAudio.listAudioMetadata()).audio.map(validateNativeAudioMeta);
  }
  const db = await openAudioDb();
  try {
    return await runIdbTransaction<AudioMeta[]>(db, STORE_NAME, "readonly", (tx, result) => {
      const metas: AudioMeta[] = [], request = tx.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { result(metas); return; }
        const record = cursor.value as AudioRecord;
        if (record?.meta && record.meta.id === record.id && record.blob instanceof Blob && record.blob.size === record.meta.size) metas.push(record.meta);
        cursor.continue();
      };
    });
  } finally { db.close(); }
};

/** Called only while the origin-wide exclusive maintenance lock is held. A new
 * audio publication remains pending across crashes until a durable reference is seen. */
export const collectWebAudio = async (references: ReadonlySet<string>) => {
  const db = await openAudioDb();
  try {
    return await runIdbTransaction<GCResult>(db, STORE_NAME, "readwrite", (tx, result) => {
      let count = 0, bytes = 0;
      const read = tx.objectStore(STORE_NAME).openCursor();
      read.onsuccess = () => {
        const cursor = read.result;
        if (!cursor) { result({ count, bytes, skipped: false }); return; }
        const record = cursor.value as AudioRecord;
        // Unknown/corrupt records are retained, never interpreted as disposable.
        if (record?.id === cursor.key && record.blob instanceof Blob &&
            (record.pending === undefined || typeof record.pending === "boolean")) {
          if (references.has(record.id)) {
            if (record.pending) cursor.update({ ...record, pending: false });
          } else if (!record.pending) { count++; bytes += record.blob.size; cursor.delete(); }
        }
        cursor.continue();
      };
    });
  } finally { db.close(); }
};

/** A receipt proves the byte publication is no longer an unfinished import.
 * Failure to clear this marker only retains extra audio; it cannot invalidate commit. */
export const confirmWebAudioReference = async (id: string): Promise<void> => {
  await withStorageWrite(async () => {
    const db = await openAudioDb();
    try { await runIdbTransaction<void>(db, STORE_NAME, "readwrite", (tx, result) => {
      const store = tx.objectStore(STORE_NAME), read = store.get(id);
      read.onsuccess = () => {
        const record = read.result as AudioRecord | undefined;
        if (record?.id === id && record.blob instanceof Blob && record.pending === true) store.put({ ...record, pending: false });
        result(undefined);
      };
    }); } finally { db.close(); }
  });
};

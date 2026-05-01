import { AudioMeta } from "../types";

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
  const id = createAudioId();
  await withAudioStore("readwrite", (store) =>
    store.put({ id, blob: file } satisfies AudioRecord),
  );
  return {
    id,
    name: file.name,
    type: file.type || "audio/mpeg",
    size: file.size,
    duration: await readAudioDuration(file),
  };
};

export const loadAudioBlobFromIndexedDb = async (
  audioId: string,
): Promise<Blob | null> => {
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
  try {
    await withAudioStore("readwrite", (store) => store.delete(audioId));
  } catch {
    // 音源Blobの掃除に失敗しても、隊列表データの削除は止めない。
  }
};

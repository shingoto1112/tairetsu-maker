import { Capacitor, registerPlugin } from "@capacitor/core";
import type { AudioMeta } from "../types";
import { MAX_AUDIO_FILE_BYTES } from "../config/fileLimits";
import { base64ToBlob, blobToBase64 } from "./base64";
import { getAppRuntime } from "./runtime";

export type AudioSelection = File | AudioMeta;
type Resolution = { uri?: string; size?: number; type?: string; legacy?: boolean };
type NativeAudioPlugin = {
  listAudioMetadata(): Promise<{ audio: AudioMeta[] }>;
  pickAudioFile(): Promise<{ cancelled?: boolean; audio?: AudioMeta }>;
  resolveAudioURL(options: { id: string; meta?: AudioMeta }): Promise<Resolution>;
  beginAudioUpload(options: { meta: AudioMeta }): Promise<{ token: string }>;
  appendAudioUpload(options: { token: string; offset: number; data: string }): Promise<void>;
  finishAudioUpload(options: { token: string }): Promise<{ audio: AudioMeta }>;
  abortAudioUpload(options: { token: string }): Promise<void>;
};
// One registration shared by picker, playback and ZIP paths.
export const nativeAudio = registerPlugin<NativeAudioPlugin>("AudioDocumentPicker");
export const canUseNativeAudioStorage = (): boolean =>
  getAppRuntime() === "capacitor-ios" && Capacitor.isNativePlatform();

export const validateNativeAudioMeta = (value: unknown): AudioMeta => {
  const meta = value as Partial<AudioMeta> | undefined;
  if (!meta || typeof meta.id !== "string" || !meta.id || meta.id.length > 512 ||
      typeof meta.name !== "string" || !meta.name || typeof meta.type !== "string" || !meta.type ||
      typeof meta.size !== "number" || !Number.isSafeInteger(meta.size) || meta.size <= 0 || meta.size > MAX_AUDIO_FILE_BYTES ||
      (meta.duration !== undefined && (typeof meta.duration !== "number" || !Number.isFinite(meta.duration) || meta.duration < 0))) {
    throw new Error("音源ファイルの保存結果が不正です。");
  }
  // Never retain accidental native path fields in Project/cloud metadata.
  return { id: meta.id, name: meta.name, type: meta.type, size: meta.size, ...(meta.duration === undefined ? {} : { duration: meta.duration }) };
};

export const saveNativeAudioBlob = async (id: string, blob: Blob, type: string, name = "audio", duration?: number): Promise<AudioMeta> => {
  if (!canUseNativeAudioStorage()) throw new Error("ネイティブ音源保存を利用できません。");
  const meta = validateNativeAudioMeta({ id, name, type, size: blob.size, duration });
  const { token } = await nativeAudio.beginAudioUpload({ meta });
  try {
    // Bridge transports strings: bound base64 allocations, never encode the entire file.
    const chunkSize = 192 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      await nativeAudio.appendAudioUpload({ token, offset, data: await blobToBase64(blob.slice(offset, offset + chunkSize)) });
    }
    return validateNativeAudioMeta((await nativeAudio.finishAudioUpload({ token })).audio);
  } finally {
    await nativeAudio.abortAudioUpload({ token }).catch(() => undefined);
  }
};

const safeLegacyID = (id: string): boolean => /^[A-Za-z0-9_-]{1,256}$/.test(id);
const loadLegacyBlob = async (id: string, meta?: AudioMeta): Promise<Blob | null> => {
  if (!safeLegacyID(id)) return null;
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
  const [data, metadata] = await Promise.all([
    Filesystem.readFile({ directory: Directory.Data, path: `audio/${id}.data` }),
    Filesystem.readFile({ directory: Directory.Data, path: `audio/${id}.json`, encoding: Encoding.UTF8 }),
  ]);
  const type = typeof metadata.data === "string" ? (JSON.parse(metadata.data) as { type?: string }).type : undefined;
  let blob = typeof data.data === "string" ? base64ToBlob(data.data, type || meta?.type || "audio/mpeg") : data.data;
  // readFile without encoding base64-encodes disk bytes; historic text needs another decode.
  if (meta && blob.size !== meta.size) blob = base64ToBlob(await blob.text(), type || meta.type);
  if (meta && blob.size !== meta.size) throw new Error("旧音源のサイズが一致しません。");
  return blob;
};

export const resolveNativeAudioURL = async (id: string, meta?: AudioMeta): Promise<string | null> => {
  if (!canUseNativeAudioStorage()) return null;
  const resolved = await nativeAudio.resolveAudioURL({ id, meta });
  if (resolved.uri) {
    if (!resolved.uri.startsWith("file://")) throw new Error("音源URLが不正です。");
    return Capacitor.convertFileSrc(resolved.uri);
  }
  // Only migration failures use the old memory-heavy path; originals are retained.
  if (resolved.legacy) {
    const blob = await loadLegacyBlob(id, meta);
    return blob ? URL.createObjectURL(blob) : null;
  }
  return null;
};

export const loadNativeAudioBlob = async (id: string, meta?: AudioMeta): Promise<Blob | null> => {
  if (!canUseNativeAudioStorage()) return null;
  const resolved = await nativeAudio.resolveAudioURL({ id, meta });
  if (resolved.legacy) return loadLegacyBlob(id, meta);
  if (!resolved.uri) return null;
  // ZIP export only: Range avoids status-0 media responses. No playback fetch.
  const response = await fetch(Capacitor.convertFileSrc(resolved.uri), { headers: { Range: "bytes=0-" } });
  if (!response.ok && response.status !== 0) throw new Error("音源の書き出しに失敗しました。");
  const blob = await response.blob();
  if (blob.size !== resolved.size) throw new Error("音源を最後まで読み込めませんでした。");
  return blob.slice(0, blob.size, resolved.type || meta?.type || blob.type);
};

// Collection of shared references is deferred to step 10.
export const deleteNativeAudioBlob = async (_id: string): Promise<void> => {};

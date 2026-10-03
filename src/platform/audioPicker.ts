import type { AudioMeta } from "../types";
import { canUseNativeAudioStorage, nativeAudio, validateNativeAudioMeta } from "./audioStorage";
import { MAX_AUDIO_FILE_BYTES } from "../config/fileLimits";


export const AUDIO_FILE_ACCEPT = ".mp3,.m4a,.wav,.aac,.aif,.aiff,.caf";
export { MAX_AUDIO_FILE_BYTES };

const AUDIO_FILE_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "caf",
  "m4a",
  "mp3",
  "wav",
]);

const getFileExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
};

export const validateAudioFile = (file: File): string | null => {
  if (!AUDIO_FILE_EXTENSIONS.has(getFileExtension(file.name))) {
    return "MP3、M4A、WAV、AAC、AIFF、CAF形式の音源を選択してください。";
  }
  if (file.size <= 0) {
    return "選択した音源ファイルが空です。別のファイルを選択してください。";
  }
  if (file.size > MAX_AUDIO_FILE_BYTES) {
    return "音源ファイルは200MB以下にしてください。";
  }
  return null;
};

export const canUseNativeAudioPicker = canUseNativeAudioStorage;
export const pickNativeAudioFile = async (): Promise<AudioMeta | null> => {
  if (!canUseNativeAudioPicker()) throw new Error("iPad用の音源選択はネイティブアプリでのみ利用できます。");
  const result = await nativeAudio.pickAudioFile();
  if (result.cancelled) return null;
  const meta = validateNativeAudioMeta(result.audio);
  if (!AUDIO_FILE_EXTENSIONS.has(getFileExtension(meta.name))) {
    throw new Error("MP3、M4A、WAV、AAC、AIFF、CAF形式の音源を選択してください。");
  }
  return meta;
};

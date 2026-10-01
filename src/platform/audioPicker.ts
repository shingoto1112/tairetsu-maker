import { Capacitor, registerPlugin } from "@capacitor/core";
import { MAX_AUDIO_FILE_BYTES } from "../config/fileLimits";
import { getAppRuntime } from "./runtime";

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

type NativeAudioPickerResult = {
  cancelled?: boolean;
  mimeType?: string;
  name?: string;
  size?: number;
  uri?: string;
};

type NativeAudioPickerPlugin = {
  pickAudioFile: () => Promise<NativeAudioPickerResult>;
  removeTemporaryFile: (options: { uri: string }) => Promise<void>;
};

const nativeAudioPicker = registerPlugin<NativeAudioPickerPlugin>(
  "AudioDocumentPicker",
);

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

export const canUseNativeAudioPicker = (): boolean =>
  getAppRuntime() === "capacitor-ios" && Capacitor.isNativePlatform();

export const pickNativeAudioFile = async (): Promise<File | null> => {
  if (!canUseNativeAudioPicker()) {
    throw new Error("iPad用の音源選択はネイティブアプリでのみ利用できます。");
  }

  const result = await nativeAudioPicker.pickAudioFile();
  if (result.cancelled) {
    return null;
  }
  if (!result.uri) {
    throw new Error("音源ファイルを読み込めませんでした。もう一度お試しください。");
  }

  try {
    if (!result.name) {
      throw new Error("音源ファイルを読み込めませんでした。もう一度お試しください。");
    }
    // Reject known-invalid documents before allocating the complete audio blob.
    if (!AUDIO_FILE_EXTENSIONS.has(getFileExtension(result.name))) {
      throw new Error("MP3、M4A、WAV、AAC、AIFF、CAF形式の音源を選択してください。");
    }
    if (typeof result.size === "number") {
      if (!Number.isFinite(result.size) || result.size <= 0) {
        throw new Error("選択した音源ファイルが空か、サイズを取得できませんでした。");
      }
      if (result.size > MAX_AUDIO_FILE_BYTES) {
        throw new Error("音源ファイルは200MB以下にしてください。");
      }
    }
    const response = await fetch(Capacitor.convertFileSrc(result.uri));
    if (!response.ok) {
      throw new Error(`音源ファイルの読み込みに失敗しました (${response.status})。`);
    }
    const blob = await response.blob();
    const file = new File([blob], result.name, {
      type: result.mimeType || blob.type || "audio/mpeg",
    });
    const validationError = validateAudioFile(file);
    if (validationError) {
      throw new Error(validationError);
    }
    return file;
  } finally {
    await nativeAudioPicker
      .removeTemporaryFile({ uri: result.uri })
      .catch(() => undefined);
  }
};

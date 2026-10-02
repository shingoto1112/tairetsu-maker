import { isNativeExportRuntime, isNativeExportShareAvailable, shareBlobsWithNativeSheet } from "../platform/files";
import { saveGeneratedBlob } from "./fileSave";
import { downloadBlob } from "./exportImage";

export const isAppleTouchDevice = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const canShareExportFiles = (files: File[]): boolean => {
  if (isNativeExportRuntime()) return isNativeExportShareAvailable();
  try { return !!navigator.share && !!navigator.canShare?.({ files }); }
  catch { return false; }
};

/** Files and modules are ready before the tap; invoke navigator.share before any await. */
export const shareExportFiles = (files: File[], title: string): Promise<"shared" | "cancelled" | "unsupported"> => {
  if (isNativeExportRuntime()) return shareBlobsWithNativeSheet({ files: files.map((file) => ({ blob: file, fileName: file.name })), title });
  if (!canShareExportFiles(files)) return Promise.resolve("unsupported");
  return navigator.share({ files, title }).then(() => "shared" as const).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled" as const;
    throw error;
  });
};

export const saveExportFile = (file: File) => {
  if (isNativeExportRuntime()) return shareExportFiles([file], file.name);
  if (isAppleTouchDevice()) { downloadBlob(file, file.name); return Promise.resolve("downloaded" as const); }
  return saveGeneratedBlob({
  fallbackFileName: file.name, generateBlob: () => Promise.resolve(file),
  pickerTypes: [{ description: "書き出しファイル", accept: { [file.type]: [`.${file.name.split(".").pop()}`] } }],
});
};

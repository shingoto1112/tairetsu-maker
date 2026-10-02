import { getAppFeatureFlags } from "../platform/runtime";
import { shareBlobsWithNativeSheet } from "../platform/files";
import { saveGeneratedBlob } from "./fileSave";

export const canShareExportFiles = (files: File[]): boolean => {
  if (getAppFeatureFlags().nativeFileShare) return true;
  try { return !!navigator.share && !!navigator.canShare?.({ files }); }
  catch { return false; }
};

/** Files and modules are ready before the tap; invoke navigator.share before any await. */
export const shareExportFiles = (files: File[], title: string): Promise<"shared" | "cancelled" | "unsupported"> => {
  if (getAppFeatureFlags().nativeFileShare) return shareBlobsWithNativeSheet({ files: files.map((file) => ({ blob: file, fileName: file.name })), title });
  if (!canShareExportFiles(files)) return Promise.resolve("unsupported");
  return navigator.share({ files, title }).then(() => "shared" as const).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled" as const;
    throw error;
  });
};

export const saveExportFile = (file: File) => saveGeneratedBlob({
  fallbackFileName: file.name, generateBlob: () => Promise.resolve(file),
  pickerTypes: [{ description: file.type === "application/pdf" ? "PDFファイル" : "PNG画像", accept: { [file.type]: [file.type === "application/pdf" ? ".pdf" : ".png"] } }],
});

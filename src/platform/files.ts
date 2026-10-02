import { Capacitor, registerPlugin } from "@capacitor/core";
import { blobToBase64 } from "./base64";

export type NativeShareStatus = "cancelled" | "shared";

type ExportSharePlugin = {
  shareFiles(options: { files: { path: string; mimeType: string; fileName: string }[]; title: string }): Promise<{ status: NativeShareStatus }>;
};
const ExportShare = registerPlugin<ExportSharePlugin>("ExportShare");
export const isNativeExportRuntime = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
export const isNativeExportShareAvailable = (): boolean => isNativeExportRuntime() && Capacitor.isPluginAvailable("ExportShare");
let sharePending = false;

const sanitizeNativeFileName = (fileName: string): string => {
  const sanitized = fileName
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
  return sanitized || `tairetsu-${Date.now()}`;
};

const isCancelledShareError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return false;
};

export const shareBlobsWithNativeSheet = async ({
  files,
  title,
}: {
  files: readonly { blob: Blob; fileName: string }[];
  title?: string;
}): Promise<NativeShareStatus> => {
  if (!isNativeExportRuntime()) {
    throw new Error("ネイティブ共有はiPadアプリでのみ利用できます。");
  }
  if (!isNativeExportShareAvailable()) throw new Error("画像・書類の共有機能が見つかりません。アプリを更新してから再試行してください。");
  if (!files.length) throw new Error("共有するファイルがありません。");
  if (sharePending) throw new Error("別の共有・保存が進行中です。");
  sharePending = true;
  const paths: string[] = [];
  const items: { path: string; mimeType: string; fileName: string }[] = [];
  const timestamp = Date.now();
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    cleanup = async () => {
      for (const path of paths) {
        try { await Filesystem.deleteFile({ directory: Directory.Cache, path }); }
        catch { /* Also clean up cancellation and partially written files, best effort. */ }
      }
    };
    for (const [index, file] of files.entries()) {
      const path = `exports/${timestamp}-${index ? `${index}-` : ""}${sanitizeNativeFileName(file.fileName)}`;
      const data = await blobToBase64(file.blob);
      paths.push(path); // Also attempt cleanup if writeFile rejects after partially writing.
      const result = await Filesystem.writeFile({ data, directory: Directory.Cache, path, recursive: true });
      items.push({ path: result.uri, mimeType: file.blob.type || "application/octet-stream", fileName: sanitizeNativeFileName(file.fileName) });
    }
    const result = await ExportShare.shareFiles({
      files: items,
      title: title ?? sanitizeNativeFileName(files[0].fileName),
    });
    if (result.status !== "shared" && result.status !== "cancelled") throw new Error("共有結果を確認できませんでした。");
    return result.status;
  } catch (error) {
    if (isCancelledShareError(error)) {
      return "cancelled";
    }
    throw error;
  } finally {
    try { await cleanup?.(); } finally { sharePending = false; }
  }
};

export const shareBlobWithNativeSheet = (file: { blob: Blob; fileName: string; title?: string }): Promise<NativeShareStatus> =>
  shareBlobsWithNativeSheet({ files: [file], title: file.title });

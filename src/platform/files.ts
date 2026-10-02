import { getAppFeatureFlags } from "./runtime";
import { blobToBase64 } from "./base64";

export type NativeShareStatus = "cancelled" | "shared";

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
  if (!(error instanceof Error)) {
    return false;
  }
  return /cancel|canceled|cancelled/i.test(error.message);
};

export const shareBlobsWithNativeSheet = async ({
  files,
  title,
}: {
  files: readonly { blob: Blob; fileName: string }[];
  title?: string;
}): Promise<NativeShareStatus> => {
  if (!getAppFeatureFlags().nativeFileShare) {
    throw new Error("ネイティブ共有はiPadアプリでのみ利用できます。");
  }
  if (!files.length) throw new Error("共有するファイルがありません。");

  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const paths: string[] = [];
  const uris: string[] = [];
  const timestamp = Date.now();
  try {
    for (const [index, file] of files.entries()) {
      const path = `exports/${timestamp}-${index ? `${index}-` : ""}${sanitizeNativeFileName(file.fileName)}`;
      const data = await blobToBase64(file.blob);
      paths.push(path); // Also attempt cleanup if writeFile rejects after partially writing.
      const result = await Filesystem.writeFile({ data, directory: Directory.Cache, path, recursive: true });
      uris.push(result.uri);
    }
    await Share.share({
      dialogTitle: "保存または共有",
      files: uris,
      title: title ?? sanitizeNativeFileName(files[0].fileName),
    });
    return "shared";
  } catch (error) {
    if (isCancelledShareError(error)) {
      return "cancelled";
    }
    throw error;
  } finally {
    for (const path of paths) {
      try { await Filesystem.deleteFile({ directory: Directory.Cache, path }); }
      catch { /* Cache cleanup is best effort, including cancellation and partial failure. */ }
    }
  }
};

export const shareBlobWithNativeSheet = (file: { blob: Blob; fileName: string; title?: string }): Promise<NativeShareStatus> =>
  shareBlobsWithNativeSheet({ files: [file], title: file.title });

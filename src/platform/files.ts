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

export const shareBlobWithNativeSheet = async ({
  blob,
  fileName,
  title,
}: {
  blob: Blob;
  fileName: string;
  title?: string;
}): Promise<NativeShareStatus> => {
  if (!getAppFeatureFlags().nativeFileShare) {
    throw new Error("ネイティブ共有はiPadアプリでのみ利用できます。");
  }

  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const safeFileName = sanitizeNativeFileName(fileName);
  const path = `exports/${Date.now()}-${safeFileName}`;
  const data = await blobToBase64(blob);
  const result = await Filesystem.writeFile({
    data,
    directory: Directory.Cache,
    path,
    recursive: true,
  });

  try {
    await Share.share({
      dialogTitle: "保存または共有",
      files: [result.uri],
      title: title ?? safeFileName,
    });
    return "shared";
  } catch (error) {
    if (isCancelledShareError(error)) {
      return "cancelled";
    }
    throw error;
  } finally {
    try {
      await Filesystem.deleteFile({
        directory: Directory.Cache,
        path,
      });
    } catch {
      // Cache cleanup is best effort and must not turn a successful share into an error.
    }
  }
};

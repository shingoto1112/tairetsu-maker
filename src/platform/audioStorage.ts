import { base64ToBlob, blobToBase64 } from "./base64";
import { getAppRuntime } from "./runtime";

const audioDataPath = (id: string): string => `audio/${id}.data`;
const audioMetaPath = (id: string): string => `audio/${id}.json`;

type NativeAudioMetadata = {
  type: string;
};

export const saveNativeAudioBlob = async (
  id: string,
  blob: Blob,
  type: string,
): Promise<void> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return;
  }
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
  await Filesystem.writeFile({
    data: await blobToBase64(blob),
    directory: Directory.Data,
    path: audioDataPath(id),
    recursive: true,
  });
  await Filesystem.writeFile({
    data: JSON.stringify({ type } satisfies NativeAudioMetadata),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    path: audioMetaPath(id),
    recursive: true,
  });
};

export const loadNativeAudioBlob = async (id: string): Promise<Blob | null> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return null;
  }
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
  try {
    const [dataResult, metaResult] = await Promise.all([
      Filesystem.readFile({
        directory: Directory.Data,
        path: audioDataPath(id),
      }),
      Filesystem.readFile({
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        path: audioMetaPath(id),
      }),
    ]);
    const metadata =
      typeof metaResult.data === "string"
        ? (JSON.parse(metaResult.data) as NativeAudioMetadata)
        : { type: "audio/mpeg" };
    return typeof dataResult.data === "string"
      ? base64ToBlob(dataResult.data, metadata.type || "audio/mpeg")
      : dataResult.data;
  } catch {
    return null;
  }
};

export const deleteNativeAudioBlob = async (id: string): Promise<void> => {
  if (getAppRuntime() !== "capacitor-ios") {
    return;
  }
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  await Promise.allSettled([
    Filesystem.deleteFile({
      directory: Directory.Data,
      path: audioDataPath(id),
    }),
    Filesystem.deleteFile({
      directory: Directory.Data,
      path: audioMetaPath(id),
    }),
  ]);
};

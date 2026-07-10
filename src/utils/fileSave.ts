import { downloadBlob } from "./exportImage";

type FilePickerAcceptType = {
  accept: Record<string, string[]>;
  description: string;
};

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
};

type FileSystemWritable = {
  close: () => Promise<void>;
  write: (data: Blob) => Promise<void>;
};

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritable>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike>;
};

type NavigatorWithUserActivation = Navigator & {
  userActivation?: {
    isActive: boolean;
  };
};

export type UserFileSaveStatus = "saved" | "downloaded" | "cancelled";

export const saveGeneratedBlob = async ({
  fallbackFileName,
  generateBlob,
  pickerTypes,
}: {
  fallbackFileName: string;
  generateBlob: () => Promise<Blob>;
  pickerTypes: FilePickerAcceptType[];
}): Promise<UserFileSaveStatus> => {
  const savePicker = (window as WindowWithSavePicker).showSaveFilePicker;
  const blob = await generateBlob();

  if (blob.size <= 0) {
    throw new Error("保存するファイルの作成に失敗しました。");
  }

  const userActivation = (navigator as NavigatorWithUserActivation).userActivation;
  if (savePicker && userActivation?.isActive !== false) {
    try {
      const handle = await savePicker({
        suggestedName: fallbackFileName,
        types: pickerTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError")
      ) {
        downloadBlob(blob, fallbackFileName);
        return "downloaded";
      }
      throw error;
    }
  }

  downloadBlob(blob, fallbackFileName);
  return "downloaded";
};

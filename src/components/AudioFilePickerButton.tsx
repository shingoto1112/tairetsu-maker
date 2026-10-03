import type { AudioSelection } from "../platform/audioStorage";
import { useState, type ChangeEvent, type ReactNode } from "react";
import {
  AUDIO_FILE_ACCEPT,
  canUseNativeAudioPicker,
  pickNativeAudioFile,
  validateAudioFile,
} from "../platform/audioPicker";

type AudioFilePickerButtonProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onError: (message: string) => void;
  onFileSelected: (file: AudioSelection) => void | Promise<void>;
};

export const AudioFilePickerButton = ({
  children,
  className,
  disabled = false,
  onError,
  onFileSelected,
}: AudioFilePickerButtonProps) => {
  const [isPicking, setIsPicking] = useState(false);
  const isDisabled = disabled || isPicking;

  const selectFile = async (file: File) => {
    const validationError = validateAudioFile(file);
    if (validationError) {
      onError(validationError);
      return;
    }
    try {
      setIsPicking(true);
      await onFileSelected(file);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "音源ファイルを読み込めませんでした。",
      );
    } finally {
      setIsPicking(false);
    }
  };

  const handleWebFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await selectFile(file);
  };

  const handleNativeFile = async () => {
    try {
      setIsPicking(true);
      const file = await pickNativeAudioFile();
      if (file) {
        await onFileSelected(file);
      }
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "音源ファイルを読み込めませんでした。",
      );
    } finally {
      setIsPicking(false);
    }
  };

  if (canUseNativeAudioPicker()) {
    return (
      <button
        className={className}
        disabled={isDisabled}
        onClick={() => void handleNativeFile()}
        type="button"
      >
        {isPicking ? "音源を読み込み中..." : children}
      </button>
    );
  }

  return (
    <label className={className} aria-disabled={isDisabled || undefined}>
      <input
        accept={AUDIO_FILE_ACCEPT}
        disabled={isDisabled}
        onChange={(event) => void handleWebFile(event)}
        type="file"
      />
      {isPicking ? "音源を読み込み中..." : children}
    </label>
  );
};

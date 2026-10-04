// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AudioFilePickerButton } from "./AudioFilePickerButton";
vi.mock("../platform/audioPicker", () => ({ AUDIO_FILE_ACCEPT: ".wav", canUseNativeAudioPicker: () => false, pickNativeAudioFile: vi.fn(), validateAudioFile: () => null }));
afterEach(cleanup);
it("keeps the descriptor/document callback captured when the web file picker was opened", async () => {
  const original = vi.fn(), changed = vi.fn(), failed = vi.fn();
  const view = render(<AudioFilePickerButton onFileSelected={original} onError={failed}>選ぶ</AudioFilePickerButton>);
  const input = view.container.querySelector("input")!;
  fireEvent.click(input);
  view.rerender(<AudioFilePickerButton onFileSelected={changed} onError={failed}>選ぶ</AudioFilePickerButton>);
  fireEvent.change(input, { target: { files: [new File(["test"], "song.wav", { type: "audio/wav" })] } });
  await waitFor(() => expect(original).toHaveBeenCalledTimes(1)); expect(changed).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(["next"], "next.wav", { type: "audio/wav" })] } });
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1)); expect(failed).not.toHaveBeenCalled();
});

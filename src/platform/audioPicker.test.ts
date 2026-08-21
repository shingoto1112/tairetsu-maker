/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  AUDIO_FILE_ACCEPT,
  MAX_AUDIO_FILE_BYTES,
  validateAudioFile,
} from "./audioPicker";

describe("audio picker validation", () => {
  it("only advertises document audio extensions without broad media capture", () => {
    expect(AUDIO_FILE_ACCEPT).not.toContain("audio/*");
    expect(AUDIO_FILE_ACCEPT).not.toContain("video");
    expect(AUDIO_FILE_ACCEPT).toContain(".mp3");
    expect(AUDIO_FILE_ACCEPT).toContain(".m4a");
  });

  it("accepts supported audio files", () => {
    const file = new File(["audio"], "sample.M4A", { type: "audio/mp4" });
    expect(validateAudioFile(file)).toBeNull();
  });

  it("rejects unsupported and oversized files", () => {
    expect(validateAudioFile(new File(["video"], "sample.mov"))).toContain(
      "音源を選択",
    );
    const oversized = new File(["audio"], "large.mp3");
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: MAX_AUDIO_FILE_BYTES + 1,
    });
    expect(validateAudioFile(oversized)).toContain("200MB以下");
  });
});

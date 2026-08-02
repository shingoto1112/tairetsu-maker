import { describe, expect, it } from "vitest";
import { getAppFeatureFlags } from "./runtime";

describe("getAppFeatureFlags", () => {
  it("keeps collaboration enabled for the existing web app", () => {
    expect(getAppFeatureFlags("web")).toEqual({
      collaboration: true,
      nativeFileShare: false,
      personalCloud: true,
    });
  });

  it("keeps collaboration enabled for the existing Tauri app", () => {
    expect(getAppFeatureFlags("tauri")).toEqual({
      collaboration: true,
      nativeFileShare: false,
      personalCloud: true,
    });
  });

  it("uses personal cloud and native sharing in the initial iPad app", () => {
    expect(getAppFeatureFlags("capacitor-ios")).toEqual({
      collaboration: false,
      nativeFileShare: true,
      personalCloud: true,
    });
  });
});

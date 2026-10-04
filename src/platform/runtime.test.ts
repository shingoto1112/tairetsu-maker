import { describe, expect, it } from "vitest";
import { getAppFeatureFlags } from "./runtime";

describe("getAppFeatureFlags", () => {
  it("separates V2 from both legacy modes on every runtime", () => {
    for (const runtime of ["web", "tauri", "capacitor-ios"] as const) {
      expect(getAppFeatureFlags(runtime, true)).toMatchObject({ collaborationV2: true, collaboration: false, personalCloud: false });
    }
  });
  it("keeps collaboration enabled for the existing web app", () => {
    expect(getAppFeatureFlags("web")).toEqual({
      collaboration: true,
      collaborationV2: false,
      nativeFileShare: false,
      personalCloud: true,
    });
  });

  it("keeps collaboration enabled for the existing Tauri app", () => {
    expect(getAppFeatureFlags("tauri")).toEqual({
      collaboration: true,
      collaborationV2: false,
      nativeFileShare: false,
      personalCloud: true,
    });
  });

  it("uses personal cloud and native sharing in the initial iPad app", () => {
    expect(getAppFeatureFlags("capacitor-ios")).toEqual({
      collaboration: false,
      collaborationV2: false,
      nativeFileShare: true,
      personalCloud: true,
    });
  });
});

import { describe, expect, it } from "vitest";
import { getAppFeatureFlags } from "./runtime";

describe("V2 switch", () => {
  for (const runtime of ["web", "tauri", "capacitor-ios"] as const) {
    it(`${runtime}: OFF is local only, ON enables V2`, () => {
      for (const enabled of [false, true]) expect(getAppFeatureFlags(runtime, enabled)).toEqual({
        collaborationV2: enabled, nativeFileShare: runtime === "capacitor-ios",
      });
    });
  }
});

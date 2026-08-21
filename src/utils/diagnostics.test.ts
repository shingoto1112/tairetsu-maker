/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { createAppDiagnostic, formatAppDiagnostic } from "./diagnostics";

describe("privacy-safe app diagnostics", () => {
  it("does not include error messages or project data", () => {
    const diagnostic = createAppDiagnostic(
      "runtime",
      new Error("owner@example.com / 秘密の隊列表"),
    );
    const text = formatAppDiagnostic(diagnostic);

    expect(text).toContain("Error");
    expect(text).not.toContain("owner@example.com");
    expect(text).not.toContain("秘密の隊列表");
  });
});

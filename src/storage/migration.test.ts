import { describe, expect, it } from "vitest";
import { MemoryMigrationRepository } from "./testing/MemoryMigrationRepository";
import { runMigrationContract } from "./testing/migrationContract";
import { collectLegacySources, parseLegacySource } from "./legacyReaders";

describe("legacy migration", () => {
  it("passes coordinator cases using anonymous phase-1 fixtures", async () => {
    expect((await runMigrationContract(() => new MemoryMigrationRepository())).scenarios).toBe(30);
  });
  it("distinguishes absent, malformed, access failures and valid empty; exposes read-only capabilities", async () => {
    expect(parseLegacySource("test", "list", null).status).toBe("absent");
    expect(parseLegacySource("test", "list", "").status).toBe("unreadable");
    expect(parseLegacySource("test", "list", "{}").status).toBe("unreadable");
    expect(parseLegacySource("test", "list", "[]")).toMatchObject({ status: "ok", projects: [] });
    const sources = await collectLegacySources({ local: () => { throw new DOMException("denied", "SecurityError"); },
      native: { readText: async () => { throw new Error("locked"); }, draftNames: async () => { throw new Error("locked"); } } });
    expect(sources.slice(0, 3).every(s => s.status === "unreadable" && s.issue === "ACCESS_DENIED")).toBe(true);
    expect(sources.slice(3).every(s => s.status === "unreadable" && s.issue === "IO_ERROR")).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { collectLegacySources, createCapacitorLegacyReader } from "./legacyReaders";
const fs = vi.hoisted(() => ({ readFile: vi.fn(), readdir: vi.fn() }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" }, Filesystem: fs }));

describe("read-only Capacitor legacy reader", () => {
  it("only treats the installed plugin's not-found code as absent", async () => {
    const reader = await createCapacitorLegacyReader();
    fs.readFile.mockRejectedValueOnce({ code: "OS-PLUG-FILE-0008" });
    expect(await reader.readText("projects/projects.json")).toBeNull();
    fs.readFile.mockRejectedValueOnce({ code: "OS-PLUG-FILE-0013" });
    await expect(reader.readText("projects/projects.json")).rejects.toEqual({ code: "OS-PLUG-FILE-0013" });
    fs.readdir.mockRejectedValueOnce({ code: "OS-PLUG-FILE-0008" });
    expect(await reader.draftNames()).toBeNull();
    fs.readdir.mockRejectedValueOnce({ code: "OS-PLUG-FILE-0013" });
    await expect(reader.draftNames()).rejects.toEqual({ code: "OS-PLUG-FILE-0013" });
    expect(fs.readFile).toHaveBeenCalledWith({ directory: "DATA", encoding: "utf8", path: "projects/projects.json" });
  });
  it("never follows draft directory entries into other paths", async () => {
    const paths: string[] = [];
    const sources = await collectLegacySources({ local: () => ({ getItem: () => null }), native: {
      readText: async path => { paths.push(path); return null; },
      draftNames: async () => ["../escape.json", "C:\\escape.json", "nested/escape.json", "bad%.json", "anonymous.pending.json"],
    } });
    expect(paths).toEqual(["projects/projects.json", "projects/projects.pending.json", "projects/projects.backup.json", "personal-cloud-drafts/anonymous.pending.json"]);
    expect(sources.find(s => s.source === "personal-cloud-drafts/bad%.json")).toMatchObject({ status: "unreadable", issue: "CORRUPT" });
  });
});

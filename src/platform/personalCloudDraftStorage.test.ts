import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types";

const nativeMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  files: new Map<string, string>(),
  isIPadNativeApp: vi.fn(() => true),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("./runtime", () => ({
  isIPadNativeApp: nativeMocks.isIPadNativeApp,
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "UTF8" },
  Filesystem: {
    deleteFile: nativeMocks.deleteFile,
    mkdir: nativeMocks.mkdir,
    readFile: nativeMocks.readFile,
    rename: nativeMocks.rename,
    writeFile: nativeMocks.writeFile,
  },
}));

import {
  deletePersonalCloudDraft,
  readPersonalCloudDraft,
  writePersonalCloudDraft,
  type PersonalCloudDraft,
} from "./personalCloudDraftStorage";

const project = (id: string): Project =>
  ({ frames: [], id, title: id } as unknown as Project);

const draft = (
  cloudProjectId: string,
  savedAt: string,
  projectId = savedAt,
): PersonalCloudDraft => ({
  baseUpdatedAt: "2026-08-03T00:00:00.000Z",
  cloudProjectId,
  project: project(projectId),
  savedAt,
});

describe("personal cloud draft storage", () => {
  beforeEach(() => {
    nativeMocks.files.clear();
    nativeMocks.isIPadNativeApp.mockReturnValue(true);
    nativeMocks.mkdir.mockReset().mockResolvedValue(undefined);
    nativeMocks.readFile.mockReset().mockImplementation(({ path }) => {
      const value = nativeMocks.files.get(path);
      if (value === undefined) {
        return Promise.reject(new Error("missing"));
      }
      return Promise.resolve({ data: value });
    });
    nativeMocks.writeFile.mockReset().mockImplementation(({ data, path }) => {
      nativeMocks.files.set(path, data);
      return Promise.resolve({ uri: `file://${path}` });
    });
    nativeMocks.deleteFile.mockReset().mockImplementation(({ path }) => {
      if (!nativeMocks.files.delete(path)) {
        return Promise.reject(new Error("missing"));
      }
      return Promise.resolve();
    });
    nativeMocks.rename.mockReset().mockImplementation(({ from, to }) => {
      const value = nativeMocks.files.get(from);
      if (value === undefined) {
        return Promise.reject(new Error("missing"));
      }
      nativeMocks.files.set(to, value);
      nativeMocks.files.delete(from);
      return Promise.resolve();
    });
  });

  it("writes through a temporary file and reads the saved draft", async () => {
    const value = draft("cloud-atomic", "2026-08-03T10:00:00.000Z");

    await writePersonalCloudDraft(value);

    expect(nativeMocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "personal-cloud-drafts/cloud-atomic.pending.json",
      }),
    );
    expect(nativeMocks.rename).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "personal-cloud-drafts/cloud-atomic.pending.json",
        to: "personal-cloud-drafts/cloud-atomic.json",
      }),
    );
    expect(await readPersonalCloudDraft("cloud-atomic")).toEqual(value);
  });

  it("recovers the newest valid generation after an interrupted write", async () => {
    const older = draft("cloud-recovery", "2026-08-03T09:00:00.000Z", "old");
    const newer = draft("cloud-recovery", "2026-08-03T10:00:00.000Z", "new");
    nativeMocks.files.set(
      "personal-cloud-drafts/cloud-recovery.json",
      "{corrupt",
    );
    nativeMocks.files.set(
      "personal-cloud-drafts/cloud-recovery.backup.json",
      JSON.stringify(older),
    );
    nativeMocks.files.set(
      "personal-cloud-drafts/cloud-recovery.pending.json",
      JSON.stringify(newer),
    );

    expect(await readPersonalCloudDraft("cloud-recovery")).toEqual(newer);
  });

  it("does not let a stale queued save overwrite a newer draft", async () => {
    const newer = draft("cloud-order", "2026-08-03T11:00:00.000Z", "new");
    const stale = draft("cloud-order", "2026-08-03T10:00:00.000Z", "stale");

    await Promise.all([
      writePersonalCloudDraft(newer),
      writePersonalCloudDraft(stale),
    ]);

    expect(await readPersonalCloudDraft("cloud-order")).toEqual(newer);
  });

  it("deletes primary, temporary, and backup generations", async () => {
    const value = draft("cloud-delete", "2026-08-03T10:00:00.000Z");
    for (const suffix of [".json", ".pending.json", ".backup.json"]) {
      nativeMocks.files.set(
        `personal-cloud-drafts/cloud-delete${suffix}`,
        JSON.stringify(value),
      );
    }

    await deletePersonalCloudDraft("cloud-delete");

    expect(
      [...nativeMocks.files.keys()].filter((path) =>
        path.includes("cloud-delete"),
      ),
    ).toEqual([]);
  });

  it("does not touch native storage outside the iPad app", async () => {
    nativeMocks.isIPadNativeApp.mockReturnValue(false);

    await writePersonalCloudDraft(
      draft("cloud-web", "2026-08-03T10:00:00.000Z"),
    );

    expect(await readPersonalCloudDraft("cloud-web")).toBeNull();
    expect(nativeMocks.writeFile).not.toHaveBeenCalled();
  });
});

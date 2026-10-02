// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types";

const platformMocks = vi.hoisted(() => ({
  loadNativeProjectsMirror: vi.fn(),
  saveNativeProjectsMirror: vi.fn(),
}));

vi.mock("../platform", () => ({
  getAppRuntime: () => "capacitor-ios",
  loadNativeProjectsMirror: platformMocks.loadNativeProjectsMirror,
  saveNativeProjectsMirror: platformMocks.saveNativeProjectsMirror,
}));

import { hydrateProjectsFromNativeStorage, saveProjectsToStorage, loadProjectsFromStorage } from "./storage";

const project = (id: string, updatedAt: string): Project =>
  ({ id, title: id, updatedAt }) as Project;

describe("hydrateProjectsFromNativeStorage", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    window.localStorage.clear();
    platformMocks.loadNativeProjectsMirror.mockReset();
    platformMocks.saveNativeProjectsMirror.mockReset();
  });

  it("preserves a legacy focusMemberId through saving and reloading", () => {
    platformMocks.saveNativeProjectsMirror.mockResolvedValue(undefined);
    const saved = { ...project("legacy", "2026-08-03T10:00:00.000Z"), focusMemberId: "member-old" };
    saveProjectsToStorage([saved]);
    expect(loadProjectsFromStorage()[0].focusMemberId).toBe("member-old");
  });

  it("keeps a newer browser save and repairs the native mirror", async () => {
    window.localStorage.setItem(
      "stageflow.projects.v1",
      JSON.stringify([project("local-new", "2026-08-03T10:00:00.000Z")]),
    );
    window.localStorage.setItem(
      "stageflow.projects.updatedAt.v1",
      "2026-08-03T10:00:00.000Z",
    );
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("native-old", "2026-08-03T09:00:00.000Z")],
      savedAt: "2026-08-03T09:00:00.000Z",
    });

    const result = await hydrateProjectsFromNativeStorage();

    expect(result?.map(({ id }) => id)).toEqual(["local-new"]);
    expect(platformMocks.saveNativeProjectsMirror).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "local-new" })]),
      "2026-08-03T10:00:00.000Z",
    );
  });

  it("restores a newer native save when WebView storage is stale", async () => {
    window.localStorage.setItem(
      "stageflow.projects.v1",
      JSON.stringify([project("local-old", "2026-08-03T09:00:00.000Z")]),
    );
    window.localStorage.setItem(
      "stageflow.projects.updatedAt.v1",
      "2026-08-03T09:00:00.000Z",
    );
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("native-new", "2026-08-03T10:00:00.000Z")],
      savedAt: "2026-08-03T10:00:00.000Z",
    });

    const result = await hydrateProjectsFromNativeStorage();

    expect(result?.map(({ id }) => id)).toEqual(["native-new"]);
    expect(
      JSON.parse(window.localStorage.getItem("stageflow.projects.v1") ?? "[]"),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "native-new" })]),
    );
  });

  it("treats an intentionally empty local library as authoritative", async () => {
    window.localStorage.setItem("stageflow.projects.v1", "[]");
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("deleted-project", "2026-08-03T09:00:00.000Z")],
      savedAt: "2026-08-03T09:00:00.000Z",
    });

    const result = await hydrateProjectsFromNativeStorage();

    expect(result).toEqual([]);
    expect(platformMocks.saveNativeProjectsMirror).toHaveBeenCalledWith(
      [],
      expect.any(String),
    );
  });

  it("uses the native mirror when browser storage is empty", async () => {
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("native-backup", "2026-08-03T10:00:00.000Z")],
      savedAt: "2026-08-03T10:00:00.000Z",
    });

    const result = await hydrateProjectsFromNativeStorage();

    expect(result?.map(({ id }) => id)).toEqual(["native-backup"]);
  });

  it("recovers from a corrupt browser project index", async () => {
    window.localStorage.setItem("stageflow.projects.v1", "{not-valid-json");
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("native-recovery", "2026-08-03T10:00:00.000Z")],
      savedAt: "2026-08-03T10:00:00.000Z",
    });

    const result = await hydrateProjectsFromNativeStorage();

    expect(result?.map(({ id }) => id)).toEqual(["native-recovery"]);
  });

  it("returns recovered projects even when browser repair exceeds quota", async () => {
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("recovered", "2026-08-03T10:00:00.000Z")],
      savedAt: "2026-08-03T10:00:00.000Z",
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await hydrateProjectsFromNativeStorage();
    expect(result?.map(({ id }) => id)).toEqual(["recovered"]);
  });

  it("recovers native projects when browser reads are denied without rewriting the mirror", async () => {
    platformMocks.loadNativeProjectsMirror.mockResolvedValue({
      projects: [project("native", "2026-08-03T10:00:00.000Z")],
      savedAt: "2026-08-03T10:00:00.000Z",
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await hydrateProjectsFromNativeStorage();
    expect(result?.map(({ id }) => id)).toEqual(["native"]);
    expect(platformMocks.saveNativeProjectsMirror).not.toHaveBeenCalled();
  });

  it("does not create an empty replacement when neither storage can be read", async () => {
    platformMocks.loadNativeProjectsMirror.mockResolvedValue(null);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(hydrateProjectsFromNativeStorage()).resolves.toBeNull();
    expect(platformMocks.saveNativeProjectsMirror).not.toHaveBeenCalled();
  });

  it("keeps the readable browser library when native repair fails", async () => {
    window.localStorage.setItem("stageflow.projects.v1", JSON.stringify([
      project("browser", "2026-08-03T10:00:00.000Z"),
    ]));
    platformMocks.loadNativeProjectsMirror.mockResolvedValue(null);
    platformMocks.saveNativeProjectsMirror.mockRejectedValue(new Error("disk full"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await hydrateProjectsFromNativeStorage();
    expect(result?.map(({ id }) => id)).toEqual(["browser"]);
  });
});

import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { Project } from "../types";
import {
  createTairetsuArchive,
  readTairetsuArchive,
} from "./tairetsuFile";

const toFile = async (
  blob: Blob,
  name: string,
  type = "application/zip",
): Promise<File> => new File([await blob.arrayBuffer()], name, { type });

describe("tairetsu file compatibility", () => {
  it.each(["zip", "json", "nested"])("accepts legacy excess parade distance on %s import without logging names or manifest", async format => {
    const project = { ...createSampleProject(), mode: "parade" as const, paradeSettings: { totalDistance: 501 } } as Project;
    const logs = [vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    let file: File;
    if (format === "json") file = new File([JSON.stringify({ project })], "private-name.json", { type: "application/json" });
    else {
      const archive = await createTairetsuArchive(project);
      if (format === "nested") {
        const zip = new JSZip(); zip.file("private-name.tairetsu", await archive.arrayBuffer());
        file = new File([await zip.generateAsync({ type: "arraybuffer" })], "private-name.zip");
      } else file = await toFile(archive, "private-name.zip");
    }
    await expect(readTairetsuArchive(file)).resolves.toMatchObject({ project });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
  it("accepts legacy excess backward distance and both boundary distances", async () => {
    const project = { ...createSampleProject(), mode: "parade" as const, paradeSettings: { totalDistance: 500, backwardDistanceMeters: 501 } } as Project;
    await expect(readTairetsuArchive(new File([JSON.stringify(project)], "project.json"))).resolves.toMatchObject({ project });
    project.paradeSettings!.backwardDistanceMeters = 500;
    await expect(readTairetsuArchive(await toFile(await createTairetsuArchive(project), "project.zip"))).resolves.toMatchObject({ project });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips the shared project shape through ZIP/.tairetsu", async () => {
    const source = createSampleProject();
    const archive = await createTairetsuArchive(source);

    const imported = await readTairetsuArchive(
      await toFile(archive, "sample.tairetsu", "application/octet-stream"),
    );

    expect(imported.audioBlob).toBeNull();
    expect(imported.project).toEqual({ ...source, audio: null });
    expect(source.focusMemberId).toBeTruthy();
    expect(imported.project.focusMemberId).toBe(source.focusMemberId);
  });

  it("preserves an included audio file and its project metadata", async () => {
    const source: Project = {
      ...createSampleProject(),
      audio: {
        id: "audio-compat",
        name: "parade.m4a",
        size: 4,
        type: "audio/mp4",
      },
    };
    const audio = new Blob([new Uint8Array([9, 8, 7, 6])], {
      type: "audio/mp4",
    });

    const archive = await createTairetsuArchive(source, { audioBlob: audio });
    const imported = await readTairetsuArchive(
      await toFile(archive, "audio-project.zip"),
    );

    expect(imported.project).toEqual(source);
    expect(imported.audioFileName).toBe("audio.m4a");
    expect([
      ...new Uint8Array(await imported.audioBlob!.arrayBuffer()),
    ]).toEqual([9, 8, 7, 6]);
  });

  it("imports both raw and wrapped legacy JSON project files", async () => {
    const source = createSampleProject();
    const raw = new File([JSON.stringify(source)], "project.json", {
      type: "application/json",
    });
    const wrapped = new File(
      [JSON.stringify({ project: source })],
      "project-wrapper.json",
      { type: "application/json" },
    );

    await expect(readTairetsuArchive(raw)).resolves.toMatchObject({
      audioBlob: null,
      project: source,
    });
    await expect(readTairetsuArchive(wrapped)).resolves.toMatchObject({
      audioBlob: null,
      project: source,
    });
  });

  it("recovers a valid project when a sharing service wraps it in another ZIP", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const source = createSampleProject();
    const innerArchive = await createTairetsuArchive(source);
    const outerZip = new JSZip();
    outerZip.file("shared-file.tairetsu", await innerArchive.arrayBuffer());
    const outerArchive = await outerZip.generateAsync({ type: "blob" });

    const imported = await readTairetsuArchive(
      await toFile(outerArchive, "line-download.zip"),
    );

    expect(imported.project).toEqual({ ...source, audio: null });
  });

  it("rejects a ZIP that does not contain a project", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const zip = new JSZip();
    zip.file("readme.txt", "not a project");
    const invalidArchive = await zip.generateAsync({ type: "blob" });

    await expect(
      readTairetsuArchive(await toFile(invalidArchive, "invalid.zip")),
    ).rejects.toThrow("manifest.json または project.json");
  });

  it("rejects empty, oversized, and excessive-entry imports before extraction", async () => {
    await expect(
      readTairetsuArchive(new File([], "empty.tairetsu")),
    ).rejects.toThrow("空です");

    const oversized = new File(["PK"], "oversized.tairetsu");
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: 256 * 1024 * 1024 + 1,
    });
    await expect(readTairetsuArchive(oversized)).rejects.toThrow("256MB以下");

    const crowdedZip = new JSZip();
    for (let index = 0; index < 65; index += 1) {
      crowdedZip.file(`entry-${index}.txt`, "x");
    }
    const crowdedArchive = await crowdedZip.generateAsync({ type: "blob" });
    await expect(
      readTairetsuArchive(await toFile(crowdedArchive, "crowded.zip")),
    ).rejects.toThrow("64件以下");
  });
});

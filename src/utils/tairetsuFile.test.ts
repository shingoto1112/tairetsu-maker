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
  it.each([
    ["project.json", "application/json"], ["project", "application/json"], ["project", ""],
  ])("A11: identifies ZIP bytes before name/MIME (%s, %s)", async (name, type) => {
    const source = createSampleProject();
    const file = await toFile(await createTairetsuArchive(source), name, type);
    await expect(readTairetsuArchive(file)).resolves.toMatchObject({ project: { ...source, audio: null } });
  });
  it.each([[3, 4], [5, 6], [7, 8]])("A11: never reinterprets a broken ZIP signature as JSON (%s, %s)", async (a, b) => {
    await expect(readTairetsuArchive(new File([new Uint8Array([80, 75, a, b])], "broken.json", { type: "application/json" })))
      .rejects.toThrow("ZIPファイルとして展開できませんでした。");
  });
  it.each(["json", "wrapped", "zip"])("A10: rejects malformed nested data before audio extraction (%s)", async format => {
    const source = createSampleProject();
    const invalid = [
      { members: [{ ...source.members[0], name: 123 }] }, { members: [null] }, { stageObjects: [null] }, { frames: [null] },
      { frames: [{ ...source.frames[0], positions: { m: { x: "1", y: 2 } } }] },
      { frames: [{ ...source.frames[0], objectAssignments: { o: [null] } }] },
      { id: "../bad" }, { audio: { id: "bad/id", name: "曲", type: "audio/mpeg", size: 1 } },
    ];
    for (const patch of invalid) {
      const value = { ...source, ...patch };
      let file: File;
      if (format === "zip") {
        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify({ fileType: "tairetsu-project", formatVersion: 1, includesAudio: true }));
        zip.file("project.json", JSON.stringify(value)); zip.file("audio/audio.mp3", new Uint8Array([1]));
        file = new File([await zip.generateAsync({ type: "arraybuffer" })], "bad.zip");
      } else file = new File([JSON.stringify(format === "wrapped" ? { project: value } : value)], "bad.json");
      await expect(readTairetsuArchive(file)).rejects.toThrow("隊列表データが壊れている可能性があります。");
    }
  });
  it.each(["json", "zip"])("A10: leaves missing legacy fields and unknown fields untouched (%s)", async format => {
    const value = { title: "旧データ", unknown: { keep: true } };
    let file: File;
    if (format === "zip") {
      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify({ fileType: "tairetsu-project", formatVersion: 1 }));
      zip.file("project.json", JSON.stringify(value));
      file = new File([await zip.generateAsync({ type: "arraybuffer" })], "old.zip");
    } else file = new File([JSON.stringify({ project: value })], "old.json");
    expect((await readTairetsuArchive(file)).project).toEqual(value);
  });
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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./exportRaster", () => ({ elementToCanvas: vi.fn(), waitForExportFonts: vi.fn().mockResolvedValue(undefined) }));
const writer = vi.hoisted(() => ({ add: vi.fn(), finish: vi.fn(), dispose: vi.fn() }));
vi.mock("./pdfExport", () => ({ createMobilePdfWriter: vi.fn(async () => writer) }));
import { elementToCanvas } from "./exportRaster";
import { createMobilePdfWriter } from "./pdfExport";
import { generateDocumentExport } from "./mobileExport";
import { createRosterExportSnapshot } from "./rosterExportSnapshot";
import type { ExportRequest, ExportSnapshot } from "./mobileExportTypes";
import { formationExportFixture } from "./formationExportFixture";
import { createFormationSnapshot } from "./formationExportLayout";
import { prepareFormationPages } from "./formationExport";

const snapshot = (): ExportSnapshot => ({ target: "members", data: createRosterExportSnapshot("演目", "members",
  Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `名前${i + 1}` })), []) });
const request: ExportRequest = { target: "members", scope: "current", purpose: "mobile", format: "png" };
const hosts = () => document.querySelectorAll("[data-mobile-export-host]");
describe("mobile export pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writer.finish.mockReturnValue(new Blob(["pdf"], { type: "application/pdf" }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const width = Number.parseFloat(this.style.width) || 492;
      const line = Number.parseFloat(this.style.lineHeight) || 34;
      const font = Number.parseFloat(this.style.fontSize) || 24;
      const height = Math.max(1, Math.ceil((this.textContent?.length ?? 1) * font / width)) * line;
      return { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };
    });
    vi.mocked(elementToCanvas).mockImplementation(async (element, ratio) => {
      expect(hosts()).toHaveLength(1);
      expect(document.querySelectorAll("[data-mobile-export-page]")).toHaveLength(1);
      expect(element.querySelectorAll("input, button")).toHaveLength(0);
      expect(element.style.width).toBe("540px"); expect(ratio).toBe(2);
      return { width: 1080, height: Number.parseInt(element.style.height) * 2,
        toBlob: (callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" })),
        toDataURL: () => "data:image/png;base64,mock",
      } as unknown as HTMLCanvasElement;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  it("plans first, renders one page at a time with metadata and repeated page numbers, then returns every file", async () => {
    const progress = vi.fn(); const text: string[] = [];
    const implementation = vi.mocked(elementToCanvas).getMockImplementation()!;
    vi.mocked(elementToCanvas).mockImplementation(async (element, ratio) => { text.push(element.textContent ?? ""); return implementation(element, ratio); });
    const result = await generateDocumentExport(snapshot(), request, { signal: new AbortController().signal, onProgress: progress });
    expect(result.pageCount).toBeGreaterThan(1); expect(result.files).toHaveLength(result.pageCount);
    expect(text[0]).toContain("総数: 60人"); expect(text[1]).not.toContain("総数:");
    expect(text[1]).toContain("未所属（60人）（続き）");
    expect(text.map((content, i) => content.includes(`${i + 1}/${result.pageCount}`)).every(Boolean)).toBe(true);
    expect(result.files[0].name).toMatch(/^演目_メンバー名簿_.*_1.png$/);
    expect(result.files[0].name).not.toContain("名前"); expect(hosts()).toHaveLength(0);
  });
  it("encodes a PDF with identical mobile page dimensions and no extra margin", async () => {
    const dimensions: number[][] = [];
    writer.add.mockImplementation((canvas: HTMLCanvasElement) => dimensions.push([canvas.width * 0.375, canvas.height * 0.375]));
    const result = await generateDocumentExport(snapshot(), { ...request, format: "pdf" }, { signal: new AbortController().signal, onProgress: vi.fn() });
    expect(dimensions[0]).toEqual([405, 720]);
    expect(dimensions[dimensions.length - 1][1]).toBeLessThan(720);
    expect(writer.add).toHaveBeenCalledTimes(result.pageCount);
    expect(writer.finish).toHaveBeenCalledTimes(1); expect(writer.dispose).toHaveBeenCalledTimes(1);
    expect(result.files).toHaveLength(1); expect(result.preview.type).toBe("image/png"); expect(hosts()).toHaveLength(0);
  });
  it("cleans up and rejects the whole output if a later page fails or generation is cancelled", async () => {
    vi.mocked(elementToCanvas).mockRejectedValueOnce(new Error("capture failed"));
    await expect(generateDocumentExport(snapshot(), request, { signal: new AbortController().signal, onProgress: vi.fn() })).rejects.toThrow("capture failed");
    expect(hosts()).toHaveLength(0);
    const controller = new AbortController();
    await expect(generateDocumentExport(snapshot(), request, { signal: controller.signal, onProgress: (message) => { if (message.includes("2/")) controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(hosts()).toHaveLength(0); expect(createMobilePdfWriter).not.toHaveBeenCalled();
  });
  it("renders an unassigned visible tool as muted 担当者なし", async () => {
    const data: ExportSnapshot = { target: "assignments", data: { title: "演目", exportedAt: new Date().toISOString(), totalCount: 1, scopeLabel: "シーン1", scenes: [{ name: "シーン1", time: "0:00", groups: [{ name: "旗", color: "red", tools: [{ name: "旗1", color: "blue", assignees: [] }] }] }] } };
    const implementation = vi.mocked(elementToCanvas).getMockImplementation()!;
    vi.mocked(elementToCanvas).mockImplementation(async (element, ratio) => { expect(element.textContent).toContain("担当者なし"); return implementation(element, ratio); });
    await generateDocumentExport(data, { ...request, target: "assignments" }, { signal: new AbortController().signal, onProgress: vi.fn() });
  });
  it("uses the same sequential pipeline for 30 scenes with details and releases every canvas", async () => {
    const project = formationExportFixture();
    project.frames = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(project.frames[i % 3]), id: `s${i}`, label: `シーン${i + 1}`, timeSec: i * 30 }));
    const source = { project, projectTitle: project.title, members: project.members, memberGroups: [], objects: project.stageObjects, objectGroups: [], frames: project.frames, currentFrame: project.frames[0], objectStates: {} };
    const data: ExportSnapshot = { target: "formation", data: createFormationSnapshot(source, "all") };
    const implementation = vi.mocked(elementToCanvas).getMockImplementation()!;
    let previous: HTMLCanvasElement | undefined;
    vi.mocked(elementToCanvas).mockImplementation(async (element, ratio) => {
      if (previous) expect([previous.width, previous.height]).toEqual([0, 0]);
      expect(element.querySelectorAll(".formation-mobile-page")).toHaveLength(0);
      expect(element.querySelectorAll("[data-formation-block]").length).toBeLessThanOrEqual(2);
      previous = await implementation(element, ratio); return previous;
    });
    const result = await generateDocumentExport(data, { ...request, target: "formation", includeDetails: true }, { signal: new AbortController().signal, onProgress: vi.fn() });
    expect(result.pageCount).toBe(75); expect(result.files).toHaveLength(result.pageCount);
    expect([previous!.width, previous!.height]).toEqual([0, 0]); expect(hosts()).toHaveLength(0);
  }, 30000);
  it("estimates and generates exactly eight PDF pages for three 12x8m scenes with details", async () => {
    const project = formationExportFixture();
    const source = { project, projectTitle: project.title, members: project.members, memberGroups: [], objects: project.stageObjects,
      objectGroups: [], frames: project.frames, currentFrame: project.frames[0], objectStates: {} };
    const data = createFormationSnapshot(source, "all");
    const options = { signal: new AbortController().signal, onProgress: vi.fn() };
    const estimated = await prepareFormationPages(data, true, options);
    expect(estimated).toHaveLength(8);
    const result = await generateDocumentExport({ target: "formation", data },
      { ...request, target: "formation", includeDetails: true, format: "pdf" }, options);
    expect(result.pageCount).toBe(estimated.length);
    expect(writer.add).toHaveBeenCalledTimes(8);
  });
});

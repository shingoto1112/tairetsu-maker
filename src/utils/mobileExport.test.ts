vi.mock("./memberMobileExport", async importOriginal => { const actual = await importOriginal<typeof import("./memberMobileExport")>(); return { ...actual, prepareMemberMobilePlan: vi.fn(actual.prepareMemberMobilePlan) }; });
import { prepareMemberMobilePlan } from "./memberMobileExport";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./exportRaster", () => ({ elementToCanvas: vi.fn(), waitForExportFonts: vi.fn().mockResolvedValue(undefined) }));

vi.mock("./rosterPdf", () => ({ generateRosterPdf: vi.fn() }));
import { elementToCanvas } from "./exportRaster";
import { generateRosterPdf } from "./rosterPdf";
import { exportTargets, generateDocumentExport } from "./mobileExport";
import { createRosterExportSnapshot } from "./rosterExportSnapshot";
import type { ExportRequest, ExportSnapshot } from "./mobileExportTypes";
import { formationExportFixture } from "./formationExportFixture";

const snapshot = (): ExportSnapshot => ({ target: "members", data: createRosterExportSnapshot("演目", "members",
  Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `名前${i + 1}` })), []) });
const request: ExportRequest = { target: "members", scope: "current", purpose: "mobile", format: "png", memberOverflow: "readable" };
const hosts = () => document.querySelectorAll("[data-mobile-export-host]");
describe("mobile export pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateRosterPdf).mockResolvedValue({ blob: new Blob(["pdf"], { type: "application/pdf" }), preview: new Blob(["png"], { type: "image/png" }), pageCount: 2, orientation: "portrait", mode: "raster" });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const line = Number.parseFloat(this.style.lineHeight) || 34;
      const font = Number.parseFloat(this.style.fontSize) || 24;
      const width = this.style.width === "max-content"
        ? Math.max(1, (this.textContent?.length ?? 1) * font * .55)
        : Number.parseFloat(this.style.width) || 492;
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
    vi.mocked(prepareMemberMobilePlan).mockResolvedValueOnce(null);
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
  it.each(["mobile", "a4"] as const)("routes %s PDF before mobile planning and A4 PNG", async purpose => {
    const result = await generateDocumentExport(snapshot(), { ...request, purpose, format: "pdf" }, { signal: new AbortController().signal, onProgress: vi.fn() });
    expect(generateRosterPdf).toHaveBeenCalledOnce(); expect(prepareMemberMobilePlan).not.toHaveBeenCalled();
    expect(elementToCanvas).not.toHaveBeenCalled(); expect(result.files).toHaveLength(1); expect(result.pageCount).toBe(2);
    expect(result.files[0].name.endsWith(".pdf")).toBe(true);
  });
  it("cleans up and rejects the whole output if a later page fails or generation is cancelled", async () => {
    vi.mocked(prepareMemberMobilePlan).mockResolvedValueOnce(null);
    vi.mocked(elementToCanvas).mockRejectedValueOnce(new Error("capture failed"));
    await expect(generateDocumentExport(snapshot(), request, { signal: new AbortController().signal, onProgress: vi.fn() })).rejects.toThrow("capture failed");
    expect(hosts()).toHaveLength(0);
    vi.mocked(prepareMemberMobilePlan).mockResolvedValueOnce(null);
    const controller = new AbortController();
    await expect(generateDocumentExport(snapshot(), request, { signal: controller.signal, onProgress: (message) => { if (message.includes("2/")) controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(hosts()).toHaveLength(0); expect(generateRosterPdf).not.toHaveBeenCalled();
  });
  it.each(["png"] as const)("exports every registered member in one final-pixel %s page", async format => {
    const items = Array.from({ length: 146 }, (_, i) => ({ id: `person-${i}`, name: i%2 ? "同じ名前" : "匿名👨‍👩‍👧‍👦" }));
    const data = createRosterExportSnapshot("演目", "members", items, []);
    vi.mocked(elementToCanvas).mockImplementation(async (element, ratio) => {
      expect(ratio).toBe(1); expect(element.style.width).toBe("1536px"); expect(element.style.height).toBe("2048px");
      expect([...element.querySelectorAll<HTMLElement>("[data-member-id]")].map(e => e.dataset.memberId)).toEqual(items.map(e => e.id));
      expect(element.textContent).toContain("総人数: 146人"); expect(element.textContent).toContain("名前は拡大して確認できます");
      return { width: 1536, height: 2048, toBlob: (cb: BlobCallback) => cb(new Blob(["png"], { type: "image/png" })), toDataURL: () => "data:image/png;base64,mock" } as HTMLCanvasElement;
    });
    const result = await generateDocumentExport({ target: "members", data }, { ...request, target: "members", format }, { signal: new AbortController().signal, onProgress: vi.fn() });
    expect(result.pageCount).toBe(1); expect(result.files).toHaveLength(1);
    expect(elementToCanvas).toHaveBeenCalledTimes(1); expect(hosts()).toHaveLength(0);
    expect(document.querySelectorAll("[data-member-mobile-measure]")).toHaveLength(0);
  });
  it("includes scene-hidden and globally hidden people in the member snapshot", () => {
    const project = formationExportFixture(); project.members[0].visible = false;
    project.frames[0].memberVisibility = Object.fromEntries(project.members.map(m => [m.id,false]));
    const data = exportTargets.members.snapshot({ project, projectTitle: project.title, members: project.members, memberGroups: [], objects: [], objectGroups: [], frames: project.frames, currentFrame: project.frames[0], objectStates: {} }, { ...request, target: "members" });
    if (data.target !== "members") throw new Error("wrong target");
    expect(data.data.columns.flatMap(g => g.items.map(e => e.id))).toEqual(project.members.map(m => m.id));
    expect(data.data.totalCount).toBe(project.members.length);
  });
  it("keeps below-floor text in one bounded image by default and paginates only on explicit readable selection", async () => {
    const data = createRosterExportSnapshot("演目", "members", Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: "長い名前".repeat(6) })), []);
    vi.mocked(elementToCanvas).mockImplementation(async (element, ratio) => {
      if (element.dataset.memberMobileFont) {
        expect(Number(element.dataset.memberMobileFont)).toBeLessThan(24);
        expect(element.style.height).toBe("2048px"); expect(ratio).toBe(1);
      } else { expect(element.style.width).toBe("540px"); expect(ratio).toBe(2); }
      return { width: parseInt(element.style.width)*ratio!, height: parseInt(element.style.height)*ratio!,
        toBlob: (cb: BlobCallback) => cb(new Blob(["png"], { type: "image/png" })), toDataURL: () => "data:image/png;base64,mock" } as HTMLCanvasElement;
    });
    const options = { signal: new AbortController().signal, onProgress: vi.fn() };
    const single = await generateDocumentExport({ target: "members", data }, { ...request, target: "members", memberOverflow: "single" }, options);
    expect(single.pageCount).toBe(1); expect(single.files).toHaveLength(1);
    const readable = await generateDocumentExport({ target: "members", data }, { ...request, target: "members", memberOverflow: "readable" }, options);
    expect(readable.pageCount).toBeGreaterThan(1); expect(readable.files).toHaveLength(readable.pageCount);
    expect(hosts()).toHaveLength(0);
  }, 30000);
});

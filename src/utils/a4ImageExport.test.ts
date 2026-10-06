// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./exportRaster", () => ({ elementToCanvas: vi.fn() }));
import { elementToCanvas } from "./exportRaster";
import { generateA4Images, numberedImageName } from "./a4ImageExport";
import { a4PageSize, fitPdfImage } from "./pdfPageLayout";

describe("A4 PNG pages", () => {
  const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() };
  let sources: HTMLCanvasElement[];
  beforeEach(() => {
    vi.clearAllMocks(); sources = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      callback(new Blob([`${this.width}x${this.height}`], { type: "image/png" }));
    });
    vi.mocked(elementToCanvas).mockImplementation(async () => {
      if (sources.length) expect([sources[sources.length - 1].width, sources[sources.length - 1].height]).toEqual([0, 0]);
      const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 800; sources.push(canvas); return canvas;
    });
  });
  afterEach(() => vi.restoreAllMocks());
  const documentPages = (count: number) => { const root = document.createElement("div"); root.innerHTML = '<section class="print-page"></section>'.repeat(count); return root; };
  it.each(["portrait", "landscape"] as const)("sequentially composes 12 %s pages with matching PDF fit, numbers and ordered filenames", async orientation => {
    const root = documentPages(12), size = a4PageSize(orientation), factor = 192 / 72;
    const result = await generateA4Images(root, orientation, "演目_隊列表_日時");
    expect(result.files.map(file => file.name)).toEqual(Array.from({ length: 12 }, (_, i) => `演目_隊列表_日時_${String(i + 1).padStart(3, "0")}.png`));
    expect(result.pageCount).toBe(root.children.length); expect(result.preview).toBe(result.files[0]);
    expect(context.fillText.mock.calls.map(call => call[0])).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}/12`));
    const fit = fitPdfImage(1600, 800, size.width, size.height);
    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([fit.x * factor, fit.y * factor, fit.width * factor, fit.height * factor]);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, Math.ceil(size.width * factor), Math.ceil(size.height * factor));
    expect(vi.mocked(elementToCanvas).mock.calls.map(call => call[0])).toEqual([...root.children]);
    expect(sources.every(canvas => !canvas.width && !canvas.height)).toBe(true);
  });
  it("omits the ink number for one page and expands filename padding to total digits", async () => {
    await generateA4Images(documentPages(1), "portrait", "演目_隊列表_日時");
    expect(context.fillText).not.toHaveBeenCalled();
    expect(numberedImageName("演目", 12, 1200)).toBe("演目_0012.png");
  });
  it("rejects failed encoding, releases canvases and allows a clean retry", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => callback(null));
    await expect(generateA4Images(documentPages(2), "portrait", "演目")).rejects.toThrow("画像を作成できませんでした。");
    expect(sources[0].width).toBe(0);
    expect((await generateA4Images(documentPages(2), "portrait", "演目")).files).toHaveLength(2);
    await expect(generateA4Images(documentPages(0), "portrait", "演目")).rejects.toThrow();
  });
});

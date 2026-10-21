// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ addPage: vi.fn(), addImage: vi.fn(), output: vi.fn(() => new Blob(["pdf"])), setProperties: vi.fn(), ctor: vi.fn(),
  internal: { pageSize: { getWidth: () => 405, getHeight: () => 720 } } }));
vi.mock("jspdf", () => ({ jsPDF: class { constructor(options: unknown) { pdf.ctor(options); return pdf; } } }));
import { cameraImageToPdfBlob, imagePagesToPdfBlob, jpegDataUrlsToPdfBlob } from "./pdfExport";

describe("generalized PDF pages", () => {
  beforeEach(() => vi.clearAllMocks());
  it("embeds PNG and JPEG with explicit compression, A4 margins and custom per-page dimensions", async () => {
    await imagePagesToPdfBlob([{ dataUrl: "png", width: 1080, height: 1920, format: "PNG" }, { dataUrl: "jpeg", width: 1080, height: 1000, format: "JPEG", pageSize: [405, 375] }]);
    expect(pdf.ctor).toHaveBeenCalledWith(expect.objectContaining({ format: "a4", compress: true }));
    expect(pdf.addPage).toHaveBeenCalledWith([405, 375], "landscape");
    expect(pdf.addImage.mock.calls.map((call) => [call[1], call[7]])).toEqual([["PNG", "SLOW"], ["JPEG", "SLOW"]]);
    expect(pdf.addImage.mock.calls[0][2]).toBe(20);
  });
  it("uses exact image-to-point dimensions without added margins for mobile", async () => {
    await imagePagesToPdfBlob([{ dataUrl: "png", width: 1080, height: 1920, format: "PNG", pageSize: [405, 720] }], { marginPt: 0 });
    expect(pdf.ctor).toHaveBeenCalledWith(expect.objectContaining({ format: [405, 720], orientation: "portrait" }));
    expect(pdf.addImage).toHaveBeenCalledWith("png", "PNG", 0, 0, 405, 720, undefined, "SLOW");
  });
  it("retains the JPEG URL wrapper and its FAST compression", async () => {
    vi.stubGlobal("Image", class { width = 1080; height = 1920; onload = () => {}; set src(_: string) { this.onload(); } });
    await jpegDataUrlsToPdfBlob(["jpeg"], "互換", "portrait");
    expect(pdf.ctor).toHaveBeenCalledWith(expect.objectContaining({ format: "a4", orientation: "portrait" }));
    expect(pdf.addImage.mock.calls[0][1]).toBe("JPEG"); expect(pdf.addImage.mock.calls[0][7]).toBe("FAST");
    vi.unstubAllGlobals();
  });
  it("rejects empty pages and invalid dimensions", async () => {
    await expect(imagePagesToPdfBlob([])).rejects.toThrow();
    await expect(imagePagesToPdfBlob([{ dataUrl: "png", width: 0, height: 10, format: "PNG" }])).rejects.toThrow();
  });
  it("keeps camera bounds on one page without extra margin", async () => {
    vi.stubGlobal("Image", class { naturalWidth = 1080; naturalHeight = 1920; onload = () => {}; set src(_: string) { this.onload(); } });
    try {
      await cameraImageToPdfBlob(new Blob(["png"], { type: "image/png" }), "カメラ");
      expect(pdf.ctor).toHaveBeenCalledWith(expect.objectContaining({ format: [405, 720], orientation: "portrait" }));
      expect(pdf.addImage).toHaveBeenCalledWith(expect.stringContaining("data:image/png"), "PNG", 0, 0, 405, 720, undefined, "SLOW");
      expect(pdf.addPage).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("cancels between compression of pages without returning a partial PDF", async () => {
    const controller = new AbortController();
    const page = { dataUrl: "png", width: 1080, height: 1920, format: "PNG" as const };
    await expect(imagePagesToPdfBlob([page, page], { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(pdf.addImage).toHaveBeenCalledTimes(1); expect(pdf.output).not.toHaveBeenCalled();
  });

});

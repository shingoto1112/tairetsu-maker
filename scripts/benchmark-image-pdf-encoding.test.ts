// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/utils/exportRaster", () => ({ elementToCanvas: vi.fn() }));
vi.mock("../src/utils/pdfExport", () => ({ imagePagesToPdfBlob: vi.fn() }));
import { elementToCanvas } from "../src/utils/exportRaster";
import { imagePagesToPdfBlob } from "../src/utils/pdfExport";
import { benchmarkImagePdfEncoding } from "./benchmark-image-pdf-encoding";

describe("same-canvas PDF encoding comparison", () => {
  it("rasterizes once, encodes PNG and JPEG q0.9 once, and compares identical dimensions/margins", async () => {
    const canvas = { width: 1480, height: 2000, toDataURL: vi.fn((format) => format) };
    vi.mocked(elementToCanvas).mockResolvedValue(canvas as unknown as HTMLCanvasElement);
    vi.mocked(imagePagesToPdfBlob).mockImplementation(async (_pages, options) => new Blob(["x".repeat(options?.compression === "SLOW" ? 10 : 20)]));
    const result = await benchmarkImagePdfEncoding(document.createElement("div"));
    expect(elementToCanvas).toHaveBeenCalledTimes(1);
    expect(canvas.toDataURL.mock.calls).toEqual([["image/png", undefined], ["image/jpeg", 0.9]]);
    expect(result.results).toHaveLength(4); expect(result.results[2].bytes).toBe(10);
    expect(result.smallest).toMatchObject({ format: "PNG", compression: "SLOW", bytes: 10 });
    expect(imagePagesToPdfBlob).toHaveBeenCalledWith([expect.objectContaining({ width: 1480, height: 2000, format: "JPEG" })], { orientation: "landscape", compression: "FAST" });
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
});

import { elementToCanvas } from "../src/utils/exportRaster";
import { imagePagesToPdfBlob, type PdfOrientation } from "../src/utils/pdfExport";

/** Browser-only diagnostic. One rasterization, same dimensions/margins for every candidate. */
export const benchmarkImagePdfEncoding = async (element: HTMLElement, orientation: PdfOrientation = "landscape") => {
  const start = performance.now();
  const canvas = await elementToCanvas(element, 2);
  const rasterMs = performance.now() - start;
  try {
    const results = [];
    for (const [format, quality] of [["PNG", undefined], ["JPEG", 0.9]] as const) {
      const encodingStart = performance.now();
      const dataUrl = canvas.toDataURL(format === "PNG" ? "image/png" : "image/jpeg", quality);
      const encodeMs = performance.now() - encodingStart;
      for (const compression of format === "PNG" ? ["FAST", "MEDIUM", "SLOW"] as const : ["FAST"] as const) {
        const pdfStart = performance.now();
        const blob = await imagePagesToPdfBlob([{ dataUrl, width: canvas.width, height: canvas.height, format }], { orientation, compression });
        results.push({ format, quality, compression, bytes: blob.size, encodeMs, pdfMs: performance.now() - pdfStart });
      }
    }
    const smallest = results.reduce((best, candidate) => candidate.bytes < best.bytes ? candidate : best);
    return { width: canvas.width, height: canvas.height, rasterMs, results, smallest };
  } finally { canvas.width = 0; canvas.height = 0; }
};

import { elementToCanvas } from "./exportRaster";
import { a4PageSize, fitPdfImage } from "./pdfPageLayout";
import { withFileExtension } from "./exportFileName";
import type { PdfOrientation } from "./pdfExport";

export const numberedImageName = (base: string, page: number, total: number) =>
  withFileExtension(`${base}_${String(page).padStart(Math.max(3, String(total).length), "0")}`, "png");

export const canvasToPngBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error("画像を作成できませんでした。")), "image/png"));

/** Rasterize and release each print-page before starting the next; never capture the document root. */
export const generateA4Images = async (element: HTMLElement, orientation: PdfOrientation, base: string,
  onProgress?: (message: string) => void): Promise<{ files: File[]; preview: Blob; pageCount: number }> => {
  const pages = [...element.querySelectorAll<HTMLElement>(".print-page")];
  if (!pages.length) throw new Error("画像用ページが見つかりません。");
  const size = a4PageSize(orientation), pixelsPerPoint = 192 / 72;
  const files: File[] = [];
  for (const [index, page] of pages.entries()) {
    onProgress?.(`${index + 1}/${pages.length}ページを作成中…`);
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    const source = await elementToCanvas(page, 2);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = Math.ceil(size.width * pixelsPerPoint);
      canvas.height = Math.ceil(size.height * pixelsPerPoint);
      const ctx = canvas.getContext("2d");
      if (!ctx || !source.width || !source.height) throw new Error("画像の描画領域を作成できませんでした。");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const fit = fitPdfImage(source.width, source.height, size.width, size.height);
      ctx.drawImage(source, fit.x * pixelsPerPoint, fit.y * pixelsPerPoint, fit.width * pixelsPerPoint, fit.height * pixelsPerPoint);
      if (pages.length > 1) {
        ctx.fillStyle = "#64748b"; ctx.font = `${10 * pixelsPerPoint}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`${index + 1}/${pages.length}`, canvas.width / 2, (size.height - 10) * pixelsPerPoint);
      }
      files.push(new File([await canvasToPngBlob(canvas)], numberedImageName(base, index + 1, pages.length), { type: "image/png" }));
    } finally { source.width = 0; source.height = 0; canvas.width = 0; canvas.height = 0; }
  }
  return { files, preview: files[0], pageCount: pages.length };
};

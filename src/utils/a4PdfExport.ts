import type { Project } from "../types";
import type { ShareExportOptions } from "../components/ShareExportModal";
import { getPrintOrientation } from "./printLayout";
import { boundedJpegPixelRatio, elementToJpegDataUrl } from "./exportImage";
import { jpegDataUrlsToPdfBlob } from "./pdfExport";
import { createA4VectorPdf } from "./vectorPdf/a4Document";
import { checkAbort } from "./vectorPdf/fonts";
import { validateParadeA4Export } from "./paradeA4Limits";

export const A4_PREVIEW_LIMITS = { maxSide: 2048, maxPixels: 2_000_000 };
export const A4_FALLBACK_LIMITS = { maxSide: 4096, maxPixels: 8_000_000 };

/** Normal A4 PDF only; camera, PNG and roster writers keep their own paths. */
export async function generateA4Pdf(request: {
  element: HTMLElement; project: Project; frameIds: string[]; options: ShareExportOptions; title: string;
  signal?: AbortSignal; onProgress?: (message: string) => void;
}) {
  const { element, project, options, signal, title, onProgress } = request;
  checkAbort(signal);
  validateParadeA4Export(project, request.frameIds, options);
  const pages = [...element.querySelectorAll<HTMLElement>(".print-page")];
  if (!pages.length) throw new Error("PDF用ページが見つかりません。");
  const isParade = project.mode === "parade";
  if (isParade) for (const page of pages) boundedJpegPixelRatio(page.scrollWidth, page.scrollHeight, A4_PREVIEW_LIMITS);
  let firstPageImage: string | undefined;
  const blob = await createA4VectorPdf({ ...request, options, fallback: async () => {
    validateParadeA4Export(project, request.frameIds, options);
    const pixels = !isParade ? 0 : pages.reduce((sum, page) => {
      const width = page.scrollWidth, height = page.scrollHeight;
      const ratio = boundedJpegPixelRatio(width, height, A4_FALLBACK_LIMITS);
      return sum + Math.floor(width * ratio) * Math.floor(height * ratio);
    }, 0);
    if (pixels > 64_000_000) throw new Error("画像PDFの総描画量が安全上限を超えています。出力するシーン数を減らしてください。");
    const images: string[] = [];
    for (const [i, page] of pages.entries()) {
      checkAbort(signal); onProgress?.(`${i + 1} / ${pages.length}ページを作成中`);
      checkAbort(signal);
      images.push(await elementToJpegDataUrl(page, isParade ? A4_FALLBACK_LIMITS : undefined)); checkAbort(signal);
    }
    const result = await jpegDataUrlsToPdfBlob(images, title, getPrintOrientation(project), { signal,
      onProgress: (done, total) => onProgress?.(`${done} / ${total}ページを仕上げ中`) });
    if (!isParade) firstPageImage = images[0];
    return result;
  } });
  checkAbort(signal); onProgress?.("プレビューを準備中");
  checkAbort(signal);
  firstPageImage ??= await elementToJpegDataUrl(pages[0], isParade ? A4_PREVIEW_LIMITS : undefined);
  checkAbort(signal);
  const preview = await (await fetch(firstPageImage)).blob();
  checkAbort(signal);
  return { blob, preview, pageCount: pages.length };
}

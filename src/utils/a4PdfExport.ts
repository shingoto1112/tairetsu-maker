import type { Project } from "../types";
import type { ShareExportOptions } from "../components/ShareExportModal";
import { getPrintOrientation } from "./printLayout";
import { elementToJpegDataUrl } from "./exportImage";
import { jpegDataUrlsToPdfBlob } from "./pdfExport";
import { createA4VectorPdf } from "./vectorPdf/a4Document";
import { checkAbort } from "./vectorPdf/fonts";

/** Normal A4 PDF only; camera, PNG and roster writers keep their own paths. */
export async function generateA4Pdf(request: {
  element: HTMLElement; project: Project; frameIds: string[]; options: ShareExportOptions; title: string;
  signal?: AbortSignal; onProgress?: (message: string) => void;
}) {
  const { element, project, options, signal, title, onProgress } = request;
  checkAbort(signal);
  const pages = [...element.querySelectorAll<HTMLElement>(".print-page")];
  if (!pages.length) throw new Error("PDF用ページが見つかりません。");
  let firstPageImage: string | undefined;
  const blob = await createA4VectorPdf({ ...request, options, fallback: async () => {
    const images: string[] = [];
    for (const [i, page] of pages.entries()) {
      checkAbort(signal); onProgress?.(`${i + 1} / ${pages.length}ページを作成中`);
      images.push(await elementToJpegDataUrl(page)); checkAbort(signal);
    }
    const result = await jpegDataUrlsToPdfBlob(images, title, getPrintOrientation(project), { signal,
      onProgress: (done, total) => onProgress?.(`${done} / ${total}ページを仕上げ中`) });
    firstPageImage = images[0];
    return result;
  } });
  checkAbort(signal); onProgress?.("プレビューを準備中");
  firstPageImage ??= await elementToJpegDataUrl(pages[0]);
  checkAbort(signal);
  const preview = await (await fetch(firstPageImage)).blob();
  checkAbort(signal);
  return { blob, preview, pageCount: pages.length };
}

import { elementToCanvas } from "./exportRaster";
import { createMobilePdfWriter } from "./pdfExport";
import { withFileExtension } from "./exportFileName";
import { MOBILE_WIDTH } from "./mobileExportLayout";
import type { GeneratedExport, GenerationOptions } from "./mobileExportTypes";

export const yieldExportUI = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
export const checkExportCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError");
};

export const encodeMobilePages = async <P extends { height: number; pageNumber: number }>(
  pages: readonly P[], draw: (page: P) => HTMLElement, release: () => void,
  format: "png" | "pdf", base: string, targetLabel: string, scopeLabel: string, options: GenerationOptions,
): Promise<GeneratedExport> => {
  const check = () => checkExportCancelled(options.signal);
  check();
  const writer = format === "pdf" ? await createMobilePdfWriter(`${base} ${targetLabel}`, options.signal) : undefined;
  const files: File[] = [];
  let preview: Blob | undefined;
  try {
    for (const page of pages) {
      check(); options.onProgress(`${page.pageNumber}/${pages.length}ページを作成中…`); await yieldExportUI(); check();
      const element = draw(page);
      if (element.scrollHeight > page.height || element.scrollWidth > MOBILE_WIDTH) throw new Error("ページの内容がはみ出しています。書き出しを中止しました。");
      const canvas = await elementToCanvas(element, 2);
      try {
        check();
        if (format === "png" || !preview) {
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("画像を作成できませんでした。")), "image/png"));
          check(); if (!blob.size) throw new Error("画像を作成できませんでした。");
          preview ??= blob;
          if (format === "png") files.push(new File([blob], withFileExtension(`${base}_${page.pageNumber}`, "png"), { type: "image/png" }));
        }
        writer?.add(canvas);
      } finally { canvas.width = 0; canvas.height = 0; release(); }
    }
    check();
    if (writer) {
      options.onProgress("PDFをまとめています…"); await yieldExportUI(); check();
      files.push(new File([writer.finish()], withFileExtension(base, "pdf"), { type: "application/pdf" }));
    }
    check();
    if (!preview || !files.length) throw new Error("書き出し結果を作成できませんでした。");
    return { files, preview, targetLabel, scopeLabel, pageCount: pages.length };
  } finally { writer?.dispose(); release(); }
};

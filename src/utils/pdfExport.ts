let jsPdfPromise: Promise<typeof import("jspdf")> | null = null;

const loadJsPdf = () => (jsPdfPromise ??= import("jspdf"));

export type ImagePdfPage = {
  dataUrl: string;
  height: number;
  width: number;
  format: "PNG" | "JPEG";
  /** Explicit page size in points. Omitted pages use options.pageSize (A4 by default). */
  pageSize?: [number, number];
};

export type PdfOrientation = "landscape" | "portrait";

const PDF_MARGIN_PT = 20;

/** Mobile pages are embedded immediately; no array of full-resolution base64 images is retained. */
export const createMobilePdfWriter = async (title: string, signal: AbortSignal) => {
  const { jsPDF } = await loadJsPdf();
  let pdf: InstanceType<typeof jsPDF> | undefined;
  const check = () => { if (signal.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError"); };
  check();
  return {
    add: (canvas: HTMLCanvasElement) => {
      check();
      const size: [number, number] = [canvas.width * 0.375, canvas.height * 0.375];
      const orientation = size[0] > size[1] ? "landscape" : "portrait";
      if (!pdf) {
        pdf = new jsPDF({ compress: true, format: size, orientation, unit: "pt" });
        pdf.setProperties({ creator: "隊列メーカー", title });
      } else pdf.addPage(size, orientation);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, size[0], size[1], undefined, "SLOW");
      check();
    },
    finish: () => {
      check();
      if (!pdf) throw new Error("PDFのページがありません。");
      const blob = pdf.output("blob"); pdf = undefined;
      if (!blob.size) throw new Error("PDFデータを作成できませんでした。");
      return blob;
    },
    dispose: () => { pdf = undefined; },
  };
};

const getImageSize = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        height: image.naturalHeight || image.height,
        width: image.naturalWidth || image.width,
      });
    image.onerror = () => reject(new Error("PDF用画像の読み込みに失敗しました。"));
    image.src = dataUrl;
  });

export const imagePagesToPdfBlob = async (
  pages: readonly ImagePdfPage[],
  { title = "隊列メーカー 印刷用", orientation = "landscape", pageSize = "a4", marginPt = PDF_MARGIN_PT, compression = "SLOW", signal, onProgress }: {
    title?: string;
    orientation?: PdfOrientation;
    pageSize?: "a4" | [number, number];
    marginPt?: number;
    compression?: "NONE" | "FAST" | "MEDIUM" | "SLOW";
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<Blob> => {
  if (!pages.length || !Number.isFinite(marginPt) || marginPt < 0) throw new Error("PDFのページ設定が不正です。");
  const check = () => { if (signal?.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError"); };
  check();
  for (const page of pages) {
    if (!(page.width > 0 && page.height > 0) || !Number.isFinite(page.width + page.height)) throw new Error("PDF用画像の寸法が不正です。");
    const size = page.pageSize ?? pageSize;
    if (size !== "a4" && (size.some((v) => !Number.isFinite(v) || v <= marginPt * 2))) throw new Error("PDFのページ寸法が不正です。");
  }
  const { jsPDF } = await loadJsPdf();
  check();
  const orientationFor = (page: ImagePdfPage): PdfOrientation => {
    const size = page.pageSize ?? pageSize;
    return size === "a4" ? orientation : size[0] > size[1] ? "landscape" : "portrait";
  };
  const pdf = new jsPDF({
    compress: true,
    format: pages[0].pageSize ?? pageSize,
    orientation: orientationFor(pages[0]),
    unit: "pt",
  });

  pdf.setProperties({
    creator: "隊列メーカー",
    title,
  });

  for (const [index, page] of pages.entries()) {
    check();
    if (index > 0) {
      pdf.addPage(page.pageSize ?? pageSize, orientationFor(page));
    }

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const maxWidth = pageWidth - marginPt * 2;
    const maxHeight = pageHeight - marginPt * 2;
    const scale = Math.min(maxWidth / page.width, maxHeight / page.height);
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const drawX = (pageWidth - drawWidth) / 2;
    const drawY = (pageHeight - drawHeight) / 2;

    pdf.addImage(
      page.dataUrl,
      page.format,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
      undefined,
      compression,
    );
    onProgress?.(index + 1, pages.length);
    if (signal || onProgress) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  check();
  const blob = pdf.output("blob");
  if (blob.size <= 0) throw new Error("PDFデータを作成できませんでした。");
  return blob;
};

export const jpegDataUrlsToPdfBlob = async (
  dataUrls: string[],
  title?: string,
  orientation: PdfOrientation = "landscape",
): Promise<Blob> => {
  const pages = await Promise.all(
    dataUrls.map(async (dataUrl) => ({
      dataUrl,
      format: "JPEG" as const,
      ...(await getImageSize(dataUrl)),
    })),
  );
  const pdfBlob = await imagePagesToPdfBlob(pages, { title, orientation, compression: "FAST" });
  if (pdfBlob.size <= 0) {
    throw new Error("PDFデータを作成できませんでした。");
  }
  return pdfBlob;
};

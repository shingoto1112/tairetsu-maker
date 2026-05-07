type JpegPage = {
  dataUrl: string;
  height: number;
  width: number;
};

const PDF_MARGIN_PT = 20;

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

const buildPdf = async (
  pages: JpegPage[],
  title = "隊列メーカー 印刷用",
): Promise<Blob> => {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    compress: true,
    format: "a4",
    orientation: "landscape",
    unit: "pt",
  });

  pdf.setProperties({
    creator: "隊列メーカー",
    title,
  });

  pages.forEach((page, index) => {
    if (index > 0) {
      pdf.addPage("a4", "landscape");
    }

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const maxWidth = pageWidth - PDF_MARGIN_PT * 2;
    const maxHeight = pageHeight - PDF_MARGIN_PT * 2;
    const scale = Math.min(maxWidth / page.width, maxHeight / page.height);
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const drawX = (pageWidth - drawWidth) / 2;
    const drawY = (pageHeight - drawHeight) / 2;

    pdf.addImage(
      page.dataUrl,
      "JPEG",
      drawX,
      drawY,
      drawWidth,
      drawHeight,
      undefined,
      "FAST",
    );
  });

  return pdf.output("blob");
};

export const jpegDataUrlsToPdfBlob = async (
  dataUrls: string[],
  title?: string,
): Promise<Blob> => {
  const pages = await Promise.all(
    dataUrls.map(async (dataUrl) => ({
      dataUrl,
      ...(await getImageSize(dataUrl)),
    })),
  );
  const pdfBlob = await buildPdf(pages, title);
  if (pdfBlob.size <= 0) {
    throw new Error("PDFデータを作成できませんでした。");
  }
  return pdfBlob;
};

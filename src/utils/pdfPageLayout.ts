export const PDF_MARGIN_PT = 20;
export const a4PageSize = (orientation: "portrait" | "landscape") => {
  const short = 595.28, long = 841.89;
  return orientation === "portrait" ? { width: short, height: long } : { width: long, height: short };
};

/** Shared by PDF embedding and A4 PNG composition; dimensions are in points. */
export const fitPdfImage = (width: number, height: number, pageWidth: number, pageHeight: number, margin = PDF_MARGIN_PT) => {
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  const drawWidth = width * scale, drawHeight = height * scale;
  return { x: (pageWidth - drawWidth) / 2, y: (pageHeight - drawHeight) / 2, width: drawWidth, height: drawHeight };
};

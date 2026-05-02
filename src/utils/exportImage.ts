import { toJpeg, toPng } from "html-to-image";

export const elementToPngBlob = async (
  element: HTMLElement,
  options: { backgroundColor?: string; pixelRatio?: number } = {},
): Promise<Blob> => {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: options.pixelRatio ?? 2,
    backgroundColor: options.backgroundColor ?? "#ffffff",
  });
  const response = await fetch(dataUrl);
  return response.blob();
};

export const elementToJpegDataUrl = async (
  element: HTMLElement,
): Promise<string> =>
  toJpeg(element, {
    backgroundColor: "#ffffff",
    cacheBust: true,
    pixelRatio: 2,
    quality: 0.95,
  });

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportElementAsPng = async (
  element: HTMLElement,
  filename: string,
): Promise<void> => {
  const blob = await elementToPngBlob(element);
  downloadBlob(blob, filename);
};

import { toJpeg, toPng } from "html-to-image";

const waitForFonts = async (): Promise<void> => {
  const fontSet = document.fonts;
  if (!fontSet) {
    return;
  }
  try {
    await fontSet.ready;
  } catch {
    // Font readiness is a best-effort polish step; image export should continue.
  }
};

const getElementPixelSize = (element: HTMLElement): { height: number; width: number } => {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(element.scrollWidth || element.offsetWidth || rect.width);
  const height = Math.ceil(element.scrollHeight || element.offsetHeight || rect.height);
  return { height, width };
};

const withExportClone = async <T>(
  element: HTMLElement,
  callback: (clone: HTMLElement, size: { height: number; width: number }) => Promise<T>,
): Promise<T> => {
  const size = getElementPixelSize(element);
  if (size.width <= 0 || size.height <= 0) {
    throw new Error("画像化する範囲のサイズを取得できませんでした。");
  }

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    background: "#ffffff",
    left: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: `${size.width}px`,
    zIndex: "-1",
  });

  const clone = element.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    display: "block",
    left: "auto",
    margin: "0",
    maxWidth: "none",
    position: "static",
    top: "auto",
    transform: "none",
    width: `${size.width}px`,
  });

  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitForFonts();
    return await callback(clone, size);
  } finally {
    host.remove();
  }
};

export const elementToPngBlob = async (
  element: HTMLElement,
  options: { backgroundColor?: string; pixelRatio?: number } = {},
): Promise<Blob> => {
  const dataUrl = await withExportClone(element, (clone, size) =>
    toPng(clone, {
      backgroundColor: options.backgroundColor ?? "#ffffff",
      cacheBust: true,
      height: size.height,
      pixelRatio: options.pixelRatio ?? 2,
      width: size.width,
    }),
  );
  const response = await fetch(dataUrl);
  return response.blob();
};

export const visibleElementToPngBlob = async (
  element: HTMLElement,
  options: { backgroundColor?: string; pixelRatio?: number } = {},
): Promise<Blob> => {
  const size = getElementPixelSize(element);
  if (size.width <= 0 || size.height <= 0) {
    throw new Error("画像化する範囲のサイズを取得できませんでした。");
  }

  await waitForFonts();
  const dataUrl = await toPng(element, {
    backgroundColor: options.backgroundColor ?? "#ffffff",
    cacheBust: true,
    height: size.height,
    pixelRatio: options.pixelRatio ?? 2,
    width: size.width,
  });
  const response = await fetch(dataUrl);
  return response.blob();
};

export const elementToJpegDataUrl = async (
  element: HTMLElement,
): Promise<string> =>
  withExportClone(element, (clone, size) =>
    toJpeg(clone, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      height: size.height,
      pixelRatio: 2,
      quality: 0.95,
      width: size.width,
    }),
  );

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

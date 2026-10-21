import { applyPrintObjectLabels } from "./printObjectLabelBrowser";

let htmlToImagePromise: Promise<typeof import("html-to-image")> | null = null;

export const loadHtmlToImage = () =>
  (htmlToImagePromise ??= import("html-to-image"));

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

export const getElementPixelSize = (element: HTMLElement): { height: number; width: number } => {
  // Prop text may bleed, but must never enlarge the paper/camera fitting extent.
  // The legacy writer clipped this text inside the prop. Measure the same shape
  // extent, including rotated props, and restore all inline styles immediately.
  const labels = [...element.querySelectorAll<HTMLElement>("[data-print-object-label]")];
  const displays = labels.map(label => [label.style.getPropertyValue("display"), label.style.getPropertyPriority("display")] as const);
  labels.forEach(label => label.style.setProperty("display", "none", "important"));
  try {
    const rect = element.getBoundingClientRect();
    return { width: Math.ceil(element.scrollWidth || element.offsetWidth || rect.width),
      height: Math.ceil(element.scrollHeight || element.offsetHeight || rect.height) };
  } finally {
    labels.forEach((label, i) => {
      if (displays[i][0]) label.style.setProperty("display", displays[i][0], displays[i][1]);
      else label.style.removeProperty("display");
    });
  }
};

export const withExportClone = async <T>(
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
    left: "-100000px",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: `${size.width}px`,
    zIndex: "0",
  });

  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-ephemeral]').forEach(node => node.remove());
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
    applyPrintObjectLabels(clone);
    return await callback(clone, size);
  } finally {
    host.remove();
  }
};

export const elementToPngBlob = async (
  element: HTMLElement,
  options: { backgroundColor?: string; pixelRatio?: number } = {},
): Promise<Blob> => {
  const { toPng } = await loadHtmlToImage();
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
  const { toPng } = await loadHtmlToImage();
  const size = getElementPixelSize(element);
  if (size.width <= 0 || size.height <= 0) {
    throw new Error("画像化する範囲のサイズを取得できませんでした。");
  }

  await waitForFonts();
  const dataUrl = await toPng(element, {
    filter: node => !(node instanceof Element && node.hasAttribute('data-ephemeral')),
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
  limits?: { maxSide: number; maxPixels: number },
): Promise<string> => {
  const { toJpeg } = await loadHtmlToImage();
  return withExportClone(element, (clone, size) => {
    const pixelRatio = limits ? boundedJpegPixelRatio(size.width, size.height, limits) : 2;
    return toJpeg(clone, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      height: size.height,
      pixelRatio,
      quality: 0.95,
      width: size.width,
    });
  });
};

/** Keep source layout intact; bound only the raster destination (including tall A4 clones). */
export function boundedJpegPixelRatio(width: number, height: number, limits: { maxSide: number; maxPixels: number }) {
  if (![width, height, limits.maxSide, limits.maxPixels].every(v => Number.isFinite(v) && v > 0))
    throw new Error("PDF用画像の寸法が不正です。");
  const ratio = Math.min(2, limits.maxSide / width, limits.maxSide / height, Math.sqrt(limits.maxPixels / width / height));
  if (Math.floor(width * ratio) < 1 || Math.floor(height * ratio) < 1)
    throw new Error("PDF用画像が極端に縦長または横長のため、安全にプレビューを作成できません。");
  return ratio;
}

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportElementAsPng = async (
  element: HTMLElement,
  filename: string,
): Promise<void> => {
  const blob = await elementToPngBlob(element);
  downloadBlob(blob, filename);
};

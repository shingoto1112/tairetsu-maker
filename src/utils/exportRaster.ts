import { loadHtmlToImage, withExportClone } from "./exportImage";

/** One DOM rasterization; callers may encode PNG and comparison JPEG from this canvas. */
export const elementToCanvas = async (element: HTMLElement, pixelRatio = 2): Promise<HTMLCanvasElement> => {
  const { toCanvas } = await loadHtmlToImage();
  return withExportClone(element, (clone, size) => toCanvas(clone, {
    backgroundColor: "#ffffff", cacheBust: true, height: size.height, width: size.width, pixelRatio,
  }));
};

export const elementToPngPage = async (element: HTMLElement) => {
  const canvas = await elementToCanvas(element, 2);
  try {
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, format: "PNG" as const };
  } finally { canvas.width = 0; canvas.height = 0; }
};

/** Font preparation is cancellable, including when a web font never finishes loading. */
export const waitForExportFonts = async (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError");
  const fonts = document.fonts;
  if (!fonts) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException("書き出しを取り消しました。", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    fonts.ready.then(() => { cleanup(); resolve(); }, (error: unknown) => { cleanup(); reject(error); });
  });
};

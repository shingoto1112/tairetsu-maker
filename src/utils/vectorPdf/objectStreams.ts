import { checkAbort } from "./fonts";

/** Re-save an already VERIFIED jsPDF output with PDF 1.5 object streams (pdf-lib, loaded on demand).
 * Page, font, image and form streams are copied as they are; only the object dictionaries and the
 * cross-reference table are packed and Flate-compressed (3–9% smaller in measurements).
 * Returns null — and the caller keeps the original bytes — when pdf-lib cannot load it, the page
 * count changes, the re-saved file does not load again, or it is not smaller. Cancellation is never
 * swallowed. Callers must keep their own checks on the original output: after packing, font
 * dictionaries live inside compressed object streams and are no longer visible as plain text. */
export async function packObjectStreams(bytes: ArrayBuffer, pageCount: number, signal?: AbortSignal): Promise<Uint8Array | null> {
  checkAbort(signal);
  try {
    const { PDFDocument } = await import("pdf-lib");
    checkAbort(signal);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.getPageCount() !== pageCount) return null;
    const packed = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    checkAbort(signal);
    const again = await PDFDocument.load(packed, { updateMetadata: false });
    if (again.getPageCount() !== pageCount) return null;
    return packed.byteLength < bytes.byteLength ? packed : null;
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
    return null;
  }
}

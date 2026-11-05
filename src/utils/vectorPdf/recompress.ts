import type { PDFDocument } from "pdf-lib";
import { checkAbort } from "./fonts";

/** Re-encode every single-filter /FlateDecode stream of a document we generated with zlib's best
 * level (pako 9). jsPDF compresses with fflate, whose output is about 8% larger at any setting.
 * The drawing never changes: a stream is replaced — under the same reference, so shared forms stay
 * shared — only when the new data is smaller AND inflates back to exactly the same bytes. Predictors
 * (/DecodeParms of images) work on those decoded bytes, so they stay valid; /Length is rewritten by
 * pdf-lib when saving. Other or chained filters and streams that do not inflate are left as they are.
 * Yields to the event loop every `sliceMs` so the page and the cancel button stay responsive (one
 * stream is compressed in one go). Only for our own exports: it has no output-size limit for
 * inflating untrusted input. Never throws except for cancellation; a stream that fails is kept. */
export async function recompressFlateStreams(doc: PDFDocument, signal?: AbortSignal, sliceMs = 24) {
  checkAbort(signal);
  const [{ PDFName, PDFRawStream }, pakoModule] = await Promise.all([import("pdf-lib"), import("pako")]);
  const pako = (pakoModule as unknown as { default?: typeof pakoModule }).default ?? pakoModule;
  checkAbort(signal);
  const context = doc.context;
  const flate = PDFName.of("FlateDecode"), filterKey = PDFName.of("Filter");
  let replaced = 0, savedBytes = 0, sliceStart = performance.now();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (performance.now() - sliceStart > sliceMs) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
    checkAbort(signal);
    if (!(object instanceof PDFRawStream) || object.dict.get(filterKey) !== flate) continue;
    try {
      const decoded = pako.inflate(object.contents);
      const smaller = pako.deflate(decoded, { level: 9 });
      if (smaller.length >= object.contents.length) continue;
      const back = pako.inflate(smaller);
      if (back.length !== decoded.length) continue;
      let same = true;
      for (let i = 0; i < back.length; i++) if (back[i] !== decoded[i]) { same = false; break; }
      if (!same) continue;
      context.assign(ref, PDFRawStream.of(object.dict.clone(context), smaller));
      replaced++; savedBytes += object.contents.length - smaller.length;
    } catch {
      // Keep this stream exactly as it was.
    }
  }
  return { replaced, savedBytes };
}

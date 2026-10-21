import type { Project } from "../../types";
import type { ShareExportOptions } from "../../components/ShareExportModal";
import { buildScenePage, type PropTextLayout, type ScenePage } from "./model";
import { renderScenePages } from "./renderer";
import { checkAbort, type FontBytesReader } from "./fonts";

/** Explicit development entry. App/PNG/roster/camera exports do not import this module.
 * The caller supplies the existing full-document image export, including unsupported cases. */
export async function createVectorPdfPrototype(request: {
  project: Project; frameIds: string[]; options?: Partial<ShareExportOptions>;
  propText?: PropTextLayout; signal?: AbortSignal; readFontBytes?: FontBytesReader;
  /** Existing .print-page scroll dimensions (measurePrintPageExtent) for exact A4 fitting. */
  pageExtent?: Pick<ScenePage, "width" | "height">;
  fallback: (signal?: AbortSignal) => Promise<Blob>;
}) {
  checkAbort(request.signal);
  try {
    if (request.project.mode === "parade") throw new Error("パレードはA4本実装を使用してください。");
    if (request.options?.includeAssignments) throw new Error("試作APIは割当欄に対応していません。A4本実装を使用してください。");
    if (request.frameIds.length !== 1) throw new Error("複数シーンの改ページは段階②以降です。");
    const page = buildScenePage(request.project, request.frameIds[0], request.options, request.propText, request.pageExtent);
    const result = await renderScenePages([page], request);
    checkAbort(request.signal);
    return { ...result, mode: "vector" as const };
  } catch (error) {
    checkAbort(request.signal);
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
    const blob = await request.fallback(request.signal);
    checkAbort(request.signal);
    return { blob, mode: "image" as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

export { createA4VectorPdf, vectorPdfDiagnostics } from "./a4Document";

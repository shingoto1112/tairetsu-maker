import type { Project } from "../../types";
import type { ShareExportOptions } from "../../components/ShareExportModal";
import { defaultPrintOptions, getAssignmentPrintEntries, getPrintMetrics, isPrintMemberVisible, paginateFrames } from "../printLayout";
import { sortFrames } from "../interpolation";
import { buildScenePage, UnsupportedVectorLayout, visibleTextLines, type ScenePage } from "./model";
import { measurePrintPageExtent, measurePropText } from "./browserTextLayout";
import { ensureBrowserFonts, measureAssignmentLayout, measureBaseline, measureTextLines, relativeRect } from "./browserDocumentLayout";
import { buildAssignmentDrawings } from "./assignmentModel";
import { checkAbort } from "./fonts";
import { measureMixedGraphemes } from "./browserMixedText";
import { renderScenePages } from "./renderer";

type Diagnostic = { timestamp: string; reason: string };
const diagnostics: Diagnostic[] = [];
/** Bounded session-only diagnostics; never change saved projects or display a warning. */
export const vectorPdfDiagnostics = (): readonly Diagnostic[] => diagnostics.map(d => ({ ...d }));

export async function withVectorFallback<T>(vector: () => Promise<T>, fallback: () => Promise<T>, signal?: AbortSignal) {
  checkAbort(signal);
  try { const result = await vector(); checkAbort(signal); return result; }
  catch (error) {
    checkAbort(signal);
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
    diagnostics.unshift({ timestamp: new Date().toISOString(), reason: error instanceof Error ? error.message : String(error) });
    diagnostics.splice(5);
    const result = await fallback(); checkAbort(signal); return result;
  }
}

export function buildA4Document(project: Project, frameIds: string[], element: HTMLElement, supplied: ShareExportOptions): ScenePage[] {
  const options = { ...defaultPrintOptions, ...supplied };
  const frames = sortFrames(project.frames).filter(f => frameIds.includes(f.id));
  if (frames.length !== frameIds.length || !frames.length) throw new UnsupportedVectorLayout("対象シーンが一致しません。");
  const metrics = getPrintMetrics(project, frames, options);
  const paginated = paginateFrames(project, frames, metrics, options);
  const sheets = [...element.querySelectorAll<HTMLElement>(".print-page")];
  if (sheets.length !== paginated.length) throw new UnsupportedVectorLayout("改ページの計測が一致しません。");
  return paginated.map((pageFrames, i) => {
    const sheet = sheets[i], blocks = [...sheet.querySelectorAll<HTMLElement>(".print-scene-block")];
    if (blocks.length !== pageFrames.length) throw new UnsupportedVectorLayout("シーン配置の計測が一致しません。");
    return { ...measurePrintPageExtent(sheet), frameId: pageFrames.map(f => f.id).join(","), drawings: pageFrames.map((frame, j) => {
      const block = blocks[j];
      const model = buildScenePage(project, frame.id, options, measurePropText, undefined, { metrics, gapAfter: j < pageFrames.length - 1 });
      const stage = model.drawings.find(d => d.kind === "group" && d.id === "stage");
      const members = project.members.filter(m => frame.positions[m.id] && isPrintMemberVisible(frame, m));
      const icons = [...block.querySelectorAll<HTMLElement>(".print-stage .print-member")];
      if (stage?.kind !== "group" || members.length !== icons.length) throw new UnsupportedVectorLayout("メンバー文字の計測が一致しません。");
      members.forEach((member, k) => {
        const node = stage.children.find(d => d.kind === "group" && d.id === member.id);
        if (node?.kind !== "group") throw new UnsupportedVectorLayout("メンバー文字が見つかりません。");
        const baseline = measureBaseline(getComputedStyle(icons[k])).line;
        const domLines = [...icons[k].querySelectorAll<HTMLElement>(".print-member__label-line")];
        visibleTextLines(node.children).forEach((line, index) => {
          line.baselineOffset = baseline;
          // Lazy measurement is only invoked if cmap/shaping checks choose a bitmap.
          // Member icon coordinates are unrotated; stored stage positions stay authoritative.
          line.measureMixed = () => {
            const r = icons[k].getBoundingClientRect();
            return measureMixedGraphemes(domLines[index], icons[k]).map(p => ({ ...p, x: p.x - r.width * 25.4 / 96 / 2,
              baseline: p.baseline - r.height * 25.4 / 96 / 2 }));
          };
        });
      });
      // CSS owns scene block stacking/title wrapping and assignment grid/flex layout.
      // Stage/member/rotated prop geometry is entirely from the model, never DOM bboxes.
      const position = relativeRect(block, sheet);
      const title = block.querySelector<HTMLElement>(".print-scene-title h2")!;
      model.drawings[0] = { kind: "group", id: "title", x: 0, y: 0, rotation: 0, children: measureTextLines(title, block) };
      if (options.includeAssignments) model.drawings.push(...buildAssignmentDrawings(project, frame, measureAssignmentLayout(block, getAssignmentPrintEntries(project, frame))));
      return { kind: "group" as const, id: frame.id, x: position.x, y: position.y, rotation: 0, children: model.drawings };
    }) };
  });
}

export async function createA4VectorPdf(request: {
  project: Project; frameIds: string[]; element: HTMLElement; options: ShareExportOptions; title: string;
  signal?: AbortSignal; onProgress?: (message: string) => void; fallback: () => Promise<Blob>;
}) {
  return withVectorFallback(async () => {
    // Reject before loading fonts; unsupported documents keep the untouched legacy font.
    if (request.project.mode === "parade") throw new UnsupportedVectorLayout("パレードは段階③まで画像PDFを使用します。");
    request.onProgress?.("文字とレイアウトを準備中");
    await ensureBrowserFonts(["bold"], request.signal);
    const previous = request.element.style.fontFamily;
    try {
      request.element.style.fontFamily = '"BIZUDPGothic"';
      checkAbort(request.signal);
      const pages = buildA4Document(request.project, request.frameIds, request.element, request.options);
      const result = await renderScenePages(pages, request);
      return result.blob;
    } finally { request.element.style.fontFamily = previous; }
  }, request.fallback, request.signal);
}

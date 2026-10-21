import type { Project } from "../../types";
import type { ShareExportOptions } from "../../components/ShareExportModal";
import { defaultPrintOptions, getAssignmentPrintEntries, getPrintMetrics, getPrintOrientation, isPrintMemberVisible, paginateFrames } from "../printLayout";
import { validateParadeA4Export } from "../paradeA4Limits";
import { sortFrames } from "../interpolation";
import { buildScenePage, CSS_PX_MM, UnsupportedVectorLayout, visibleTextLines, type ScenePage } from "./model";
import { measurePrintPageExtent, measurePropText } from "./browserTextLayout";
import { ensureBrowserFonts, measureAssignmentLayout, measureBaseline, measureTextLines, relativeRect } from "./browserDocumentLayout";
import { buildAssignmentDrawings } from "./assignmentModel";
import { checkAbort } from "./fonts";
import { measureMixedGraphemes } from "./browserMixedText";
import { renderScenePages } from "./renderer";
import { withExportClone } from "../exportImage";

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

/** The caller must keep an isolated export clone mounted through rendering.
 * Live UI zoom would mix visual DOMRects with model/layout millimetres. */
export function buildA4Document(project: Project, frameIds: string[], element: HTMLElement, supplied: ShareExportOptions): ScenePage[] {
  const options = { ...defaultPrintOptions, ...supplied };
  validateParadeA4Export(project, frameIds, options);
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
      const stageElement = block.querySelector<HTMLElement>(".print-stage");
      if (!stageElement || Math.abs(stageElement.getBoundingClientRect().width * CSS_PX_MM - metrics.stageWidthMm) > .025)
        throw new UnsupportedVectorLayout("印刷用の複製DOMとステージ寸法が一致しません。");
      const model = buildScenePage(project, frame.id, options, measurePropText, undefined, { metrics, gapAfter: j < pageFrames.length - 1 });
      const stage = model.drawings.find(d => d.kind === "group" && d.id === "stage");
      const members = project.members.filter(m => frame.positions[m.id] && isPrintMemberVisible(frame, m));
      const icons = [...block.querySelectorAll<HTMLElement>(".print-stage .print-member")];
      if (stage?.kind !== "group" || members.length !== icons.length) throw new UnsupportedVectorLayout("メンバー文字の計測が一致しません。");
      const memberNodes = new Map(stage.children.filter(d => d.kind === "group").map(d => [d.id, d]));
      members.forEach((member, k) => {
        const node = memberNodes.get(member.id);
        if (node?.kind !== "group") throw new UnsupportedVectorLayout("メンバー文字が見つかりません。");
        const domLines = [...icons[k].querySelectorAll<HTMLElement>(".print-member__label-line")];
        visibleTextLines(node.children).forEach((line, index) => {
          const range = document.createRange(); range.selectNodeContents(domLines[index]);
          const glyphs = range.getBoundingClientRect(), icon = icons[k].getBoundingClientRect();
          // CSS rounds individual line boxes/baselines to layout pixels, which
          // matters at the readable-size floor. Only y comes from font layout;
          // the horizontal anchor remains the model's circle centre (x = 0).
          line.y = (glyphs.y + glyphs.height / 2 - icon.y - icon.height / 2) * CSS_PX_MM;
          line.baselineOffset = measureBaseline(getComputedStyle(domLines[index])).range;
          // Ordinary vector names stay centred on the data-driven circle.
          // Only fallback glyphs need browser measurements, in the same clone.
          line.measureMixed = () => {
            const r = icons[k].getBoundingClientRect();
            return measureMixedGraphemes(domLines[index], icons[k]).map(p => ({ ...p, x: p.x - r.width * CSS_PX_MM / 2,
              baseline: p.baseline - r.height * CSS_PX_MM / 2 }));
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
  // Unsafe input must not enter the more expensive whole-document image fallback.
  checkAbort(request.signal);
  validateParadeA4Export(request.project, request.frameIds, request.options);
  return withVectorFallback(async () => {
    request.onProgress?.("文字とレイアウトを準備中");
    await ensureBrowserFonts(request.project.mode === "parade" && request.options.includeMeterRulers ? ["normal", "bold"] : ["bold"], request.signal);
    // Match the legacy image writer's layout context. The live PrintPreview can
    // inherit #root's desktop zoom:0.8: DOMRects then contain zoomed coordinates,
    // while model mm, computed font sizes and scroll extents remain unzoomed.
    // Measuring the same isolated clone avoids both mixed units and zoom-induced
    // glyph/line-box rounding. Keep it mounted through lazy mixed-glyph rendering.
    return withExportClone(request.element, async clone => {
      clone.style.fontFamily = '"BIZUDPGothic"';
      checkAbort(request.signal);
      const pages = buildA4Document(request.project, request.frameIds, clone, request.options);
      const parade = request.project.mode === "parade";
      const result = await renderScenePages(pages, { ...request, orientation: getPrintOrientation(request.project),
        fillStrokes: parade, clipPage: parade });
      return result.blob;
    });
  }, request.fallback, request.signal);
}

import { createRosterExportSnapshot } from "./rosterExportSnapshot";
import { waitForExportFonts } from "./exportRaster";
import { encodeMobilePages } from "./mobileExportPipeline";
import { formatExportTimestamp, withFileExtension } from "./exportFileName";
import {
  MOBILE_INNER_WIDTH, MOBILE_PADDING, MOBILE_WIDTH,
  planMobilePages, rosterMobileSections, type MobilePage, type MobileSection, type TextMeasure,
} from "./mobileExportLayout";
import type { ExportRequest, ExportSnapshot, ExportSource, ExportTarget, GeneratedExport, GenerationOptions } from "./mobileExportTypes";

type TextExportSnapshot = ExportSnapshot;

const FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const div = (text?: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const element = document.createElement("div");
  if (text !== undefined) element.textContent = text;
  Object.assign(element.style, { boxSizing: "border-box", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }, style);
  return element;
};
const checkCancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError"); };
const yieldToUI = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

type TargetDefinition = {
  label: string; supportsA4: boolean;
  snapshot: (source: ExportSource, request: ExportRequest) => ExportSnapshot;
  plan: (snapshot: ExportSnapshot, measure: TextMeasure) => MobileSection[];
  draw: typeof drawMobilePage;
};
export const exportTargets: Record<ExportTarget, TargetDefinition> = {
  members: {
    label: "メンバー名簿", supportsA4: true,
    snapshot: source => ({ target: "members", data: createRosterExportSnapshot(source.projectTitle, "members", source.members, source.memberGroups) }),
    plan: (snapshot, measure) => rosterMobileSections(snapshot.data, measure), draw: drawMobilePage,
  },
};

const metadata = (snapshot: TextExportSnapshot) => `書き出し日: ${new Date(snapshot.data.exportedAt).toLocaleDateString("ja-JP")}　総数: ${snapshot.data.totalCount}人`;
const headerSize = (snapshot: TextExportSnapshot, label: string, first: boolean, measure: TextMeasure) =>
  measure(snapshot.data.title, MOBILE_INNER_WIDTH, 30, 40, true)
  + measure(label, MOBILE_INNER_WIDTH - 120, 28, 38, true)
  + (first ? measure(metadata(snapshot), MOBILE_INNER_WIDTH, 20, 30) : 0) + 16;

function drawMobilePage(snapshot: TextExportSnapshot, label: string, page: MobilePage): HTMLElement {
  const sheet = div(undefined, {
    width: `${MOBILE_WIDTH}px`, height: `${page.height}px`, padding: `${MOBILE_PADDING}px`,
    background: "#ffffff", color: "#0f172a", fontFamily: FONT, fontSize: "24px", lineHeight: "34px",
  });
  sheet.dataset.mobileExportPage = String(page.pageNumber);
  const header = div(undefined, { height: `${page.headerHeight}px` });
  header.append(div(snapshot.data.title, { fontSize: "30px", lineHeight: "40px", fontWeight: "700" }));
  const target = div(undefined, { display: "flex", alignItems: "start", gap: "12px" });
  target.append(div(label, { width: `${MOBILE_INNER_WIDTH - 120}px`, fontSize: "28px", lineHeight: "38px", fontWeight: "700", color: "#0f766e" }),
    div(`${page.pageNumber}/${page.totalPages}`, { flex: "1", textAlign: "right", fontSize: "20px", lineHeight: "38px", color: "#64748b" }));
  header.append(target);
  if (page.pageNumber === 1) header.append(div(metadata(snapshot), { fontSize: "20px", lineHeight: "30px", color: "#64748b" }));
  sheet.append(header);
  for (const block of page.blocks) {
    if (block.heading) {
      const { text, color } = block.heading;
      const heading = div(undefined, { height: `${block.height}px`, display: "flex", gap: "12px", padding: "10px 8px",
        fontSize: "28px", lineHeight: "38px", fontWeight: "700",
        background: "#f8fafc", borderLeft: `4px solid ${color ?? "#94a3b8"}`,
      });
      heading.append(div(text, { minWidth: "0", flex: "1" })); sheet.append(heading);
    } else if (block.row) {
      const row = div(undefined, { height: `${block.height}px`, display: "flex", gap: "16px", padding: "7px 0 8px", borderBottom: "1px solid #e2e8f0", color: block.row.muted ? "#64748b" : "#0f172a" });
      for (const cell of block.row.cells) {
        const item = div(undefined, { display: "flex", flex: "1", minWidth: "0" });
        if (cell.no !== undefined) item.append(div(`${cell.no}.`, { flex: "0 0 44px", fontSize: "20px", color: "#64748b" }));
        item.append(div(cell.text, { minWidth: "0", flex: "1" })); row.append(item);
      }
      // A final single entry in two columns keeps the same text width used in measurement.
      sheet.append(row);
    }
  }
  return sheet;
}

export const generateDocumentExport = async (
  snapshot: ExportSnapshot, request: ExportRequest, options: GenerationOptions,
): Promise<GeneratedExport> => {
  const target = exportTargets[snapshot.target];
  const scopeLabel = "全体";
  const label = target.label;
  const base = `${snapshot.data.title}_${label}_${formatExportTimestamp(new Date(snapshot.data.exportedAt))}`;
  const check = () => checkCancelled(options.signal);
  check();
  if (request.format === "pdf") {
    const { generateRosterPdf } = await import("./rosterPdf");
    const result = await generateRosterPdf(snapshot.data, options);
    check();
    return { files: [new File([result.blob], withFileExtension(base, "pdf"), { type: "application/pdf" })],
      preview: result.preview, targetLabel: label, scopeLabel, pageCount: result.pageCount };
  }
  if (request.purpose === "a4") {
    options.onProgress("印刷用ページを準備中…"); await yieldToUI(); check();
    const { generateRosterExport } = await import("./rosterExport");
    const result = await generateRosterExport(snapshot.data, request.format, { ...options, paginatedImages: true });
    check();
    const blobs = request.format === "png" ? result.images ?? [result.blob] : [result.blob];
    const files = blobs.map((blob, index) => new File([blob], withFileExtension(request.format === "png" ? `${base}_${index + 1}` : base, request.format), { type: blob.type }));
    return { files, preview: result.preview ?? result.blob, targetLabel: label, scopeLabel, pageCount: result.pageCount ?? 1 };
  }
  if (snapshot.target === "members") {
    const { prepareMemberMobilePlan, generateMemberMobileExport } = await import("./memberMobileExport");
    options.onProgress("全員が入る1枚の配置を確認中…");
    let plan = await prepareMemberMobilePlan(snapshot.data, options);
    if (!plan && request.memberOverflow !== "readable") plan = await prepareMemberMobilePlan(snapshot.data, options, true);
    if (plan) return generateMemberMobileExport(snapshot.data, request.format, base, options, plan);
    if (request.memberOverflow !== "readable") throw new Error("全員を1枚に配置できません。読みやすさを優先して分ける方法を選んでください。");
    // Explicit opt-in only: retain the existing readable pagination pipeline.
  }
  const host = div(undefined, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none", fontFamily: FONT });
  host.setAttribute("aria-hidden", "true"); host.dataset.mobileExportHost = "true";
  document.body.append(host);
  try {
    options.onProgress("フォントと改ページを準備中…");
    // A bounded measuring element, separate from page rendering and image generation.
    const probe = div(snapshot.data.title, { fontSize: "24px", lineHeight: "34px", width: `${MOBILE_INNER_WIDTH}px` }); host.append(probe);
    await waitForExportFonts(options.signal); check();
    let measurements = 0;
    const cache = new Map<string, number>();
    const measure: TextMeasure = (text, width, fontSize, lineHeight, bold = false) => {
      check(); measurements++;
      const key = JSON.stringify([text, width, fontSize, lineHeight, bold]);
      const cached = cache.get(key); if (cached !== undefined) return cached;
      Object.assign(probe.style, { width: `${width}px`, fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, fontWeight: bold ? "700" : "400" });
      probe.textContent = text || " ";
      const height = Math.ceil(probe.getBoundingClientRect().height);
      if (height <= 0) throw new Error("文字の表示サイズを測定できませんでした。");
      cache.set(key, height); return height;
    };
    {
      let count = 0;
      for (const group of snapshot.data.columns) for (const item of group.items) {
        measure(item.name, 194, 24, 34); measure(item.name, MOBILE_INNER_WIDTH - 44, 24, 34);
        if (++count % 32 === 0) { options.onProgress(`${count}件の名前を測定中…`); await yieldToUI(); check(); }
      }
    }
    const sections = target.plan(snapshot, measure);
    // Warm exact section measurements in small batches so cancellation can be handled.
    for (let index = 0; index < sections.length; index++) {
      for (const heading of sections[index].headings) {
        measure(heading.text, MOBILE_INNER_WIDTH - 24, 28, 38, true);
      }
      for (const row of sections[index].rows) {
        const width = (MOBILE_INNER_WIDTH - (row.cells.length - 1) * 16) / row.cells.length;
        for (const cell of row.cells) measure(cell.text, width - (cell.no === undefined ? 0 : 44), 24, 34);
      }
      if ((index + 1) % 16 === 0) { await yieldToUI(); check(); }
    }
    const pages = planMobilePages(sections, measure, (first) => headerSize(snapshot, label, first, measure));
    options.onProgress(`${pages.length}ページの画像を準備中…`);
    probe.remove(); await yieldToUI(); check();
    if (!measurements) throw new Error("文字の表示サイズを測定できませんでした。");
    return await encodeMobilePages(pages, (page) => {
      const element = target.draw(snapshot, label, page); host.replaceChildren(element); return element;
    }, () => host.replaceChildren(), request.format, base, label, scopeLabel, options);
  } finally { host.remove(); }
};

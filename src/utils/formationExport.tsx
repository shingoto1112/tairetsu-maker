import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FormationMobilePage } from "../components/FormationMobilePage";
import { planFormationPages } from "./formationExportLayout";
import { waitForExportFonts } from "./exportRaster";
import { encodeMobilePages, checkExportCancelled, yieldExportUI } from "./mobileExportPipeline";
import { MOBILE_INNER_WIDTH, type TextMeasure } from "./mobileExportLayout";
import { formatExportTimestamp } from "./exportFileName";
import type { ExportRequest, FormationSnapshot, GenerationOptions } from "./mobileExportTypes";

/** A single bounded measuring element, prepared in the same font as the rendered pages. */
export const prepareFormationPages = async (snapshot: FormationSnapshot, details: boolean, options: GenerationOptions) => {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif' });
  const probe = document.createElement("div");
  Object.assign(probe.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere", boxSizing: "border-box" });
  host.append(probe); document.body.append(host);
  try {
    await waitForExportFonts(options.signal);
    const cache = new Map<string, number>();
    const measure: TextMeasure = (text, width, fontSize, lineHeight, bold) => {
      checkExportCancelled(options.signal);
      const key = JSON.stringify([text, width, fontSize, lineHeight, bold]);
      const previous = cache.get(key); if (previous !== undefined) return previous;
      Object.assign(probe.style, { width: `${width}px`, fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, fontWeight: bold ? "700" : "400" });
      probe.textContent = text || " ";
      const height = Math.ceil(probe.getBoundingClientRect().height);
      if (!(height > 0)) throw new Error("文字の表示サイズを測定できませんでした。");
      cache.set(key, height); return height;
    };
    for (const [index, frame] of snapshot.project.frames.entries()) {
      measure(frame.label, MOBILE_INNER_WIDTH, 30, 38, true);
      if ((index + 1) % 16 === 0) { await yieldExportUI(); checkExportCancelled(options.signal); }
    }
    return planFormationPages(snapshot, details, measure);
  } finally { host.remove(); }
};

export const generateFormationExport = async (snapshot: FormationSnapshot, request: ExportRequest, options: GenerationOptions) => {
  options.onProgress("フォントと改ページを準備中…");
  const pages = await prepareFormationPages(snapshot, Boolean(request.includeDetails), options);
  options.onProgress(`${pages.length}ページの画像を準備中…`);
  const host = document.createElement("div"); host.dataset.mobileExportHost = "true"; host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none" });
  document.body.append(host); const root = createRoot(host);
  try {
    const base = `${snapshot.title}_隊列表_${snapshot.scopeLabel}_${formatExportTimestamp(new Date(snapshot.exportedAt))}`;
    return await encodeMobilePages(pages, (page) => {
      flushSync(() => root.render(<FormationMobilePage snapshot={snapshot} page={page} />));
      const element = host.firstElementChild;
      if (!(element instanceof HTMLElement)) throw new Error("隊列表の画像を準備できませんでした。");
      return element;
    }, () => flushSync(() => root.render(null)), request.format, base, "隊列表", snapshot.scopeLabel, options);
  } finally { root.unmount(); host.remove(); }
};

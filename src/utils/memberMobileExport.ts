import { waitForExportFonts } from "./exportRaster";
import { encodeMobilePages, checkExportCancelled, yieldExportUI } from "./mobileExportPipeline";
import {
  bestMemberMobileCandidate, memberMobileCandidates, memberLineHeight, memberHeadingFont, memberTextWidth,
  MEMBER_MOBILE_FONT, MEMBER_MOBILE_PADDING, type MemberMobilePlan,
} from "./memberMobileLayout";
import type { RosterExportSnapshot } from "./rosterExportSnapshot";
import type { GenerationOptions, GeneratedExport } from "./mobileExportTypes";
import type { TextMeasure } from "./mobileExportLayout";

const node = (text: string | undefined, style: Partial<CSSStyleDeclaration> = {}) => {
  const e = document.createElement("div");
  if (text !== undefined) e.textContent = text;
  Object.assign(e.style, { boxSizing: "border-box", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, style);
  return e;
};

/** Measure with the exact output font, including wrapping and emoji. No raster is created. */
export const prepareMemberMobilePlan = async (
  snapshot: RosterExportSnapshot, options: GenerationOptions, allowSmall = false,
): Promise<MemberMobilePlan | null> => {
  const host = node(undefined, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none", fontFamily: MEMBER_MOBILE_FONT });
  host.dataset.memberMobileMeasure = "true"; host.setAttribute("aria-hidden", "true");
  const probe = node(snapshot.title); host.append(probe); document.body.append(host);
  const check = () => checkExportCancelled(options.signal);
  try {
    await waitForExportFonts(options.signal); check();
    const cache = new Map<string, number>();
    const measure: TextMeasure = (text, width, fontSize, lineHeight, bold = false) => {
      const key = JSON.stringify([text, width, fontSize, lineHeight, bold]);
      const value = cache.get(key); if (value !== undefined) return value;
      Object.assign(probe.style, { width: `${width}px`, fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`, fontWeight: bold ? "700" : "400" });
      probe.textContent = text || " ";
      const height = Math.ceil(probe.getBoundingClientRect().height);
      if (!height || !Number.isFinite(height)) throw new Error("名前の表示サイズを測定できませんでした。");
      // An indivisible grapheme (e.g. an emoji sequence) must fit too; the output
      // reserves one em for punctuation outside the measured line box.
      if (probe.scrollWidth > Math.ceil(width + fontSize)) { cache.set(key, Infinity); return Infinity; }
      cache.set(key, height); return height;
    };
    for (let font = 32; font >= (allowSmall ? 1 : 24); font--) {
      const candidates: MemberMobilePlan[] = [];
      let count = 0;
      for (const result of memberMobileCandidates(snapshot, measure, font)) {
        check(); if (result) candidates.push(result);
        if (++count % 4 === 0) { await yieldExportUI(); check(); }
      }
      const result = bestMemberMobileCandidate(candidates);
      if (result) return result;
    }
    return null;
  } finally { host.remove(); }
};

export const drawMemberMobilePage = (snapshot: RosterExportSnapshot, plan: MemberMobilePlan): HTMLElement => {
  const font = plan.fontSize, line = memberLineHeight(font), padding = MEMBER_MOBILE_PADDING;
  const sheet = node(undefined, { position: "relative", width: `${plan.width}px`, height: `${plan.height}px`, background: "#ffffff", color: "#0f172a", fontFamily: MEMBER_MOBILE_FONT, fontSize: `${font}px`, lineHeight: `${line}px` });
  sheet.dataset.mobileExportPage = "1";
  sheet.dataset.memberMobileColumns = String(plan.columns); sheet.dataset.memberMobileFont = String(font);
  const header = node(undefined, { position: "absolute", top: `${padding}px`, left: `${padding}px`, width: `${plan.width-padding*2}px` });
  const titleFont = plan.titleFontSize;
  header.append(node(snapshot.title, { width: `${memberTextWidth(plan.width-padding*2,titleFont)}px`, fontSize: `${titleFont}px`, lineHeight: `${memberLineHeight(titleFont)}px`, fontWeight: "700" }),
    node("メンバー名簿", { fontWeight: "700", color: "#0f766e" }), node(`総人数: ${snapshot.totalCount}人`));
  sheet.append(header);
  for (const block of plan.blocks) {
    const box = node(undefined, { position: "absolute", left: `${block.x}px`, top: `${block.y}px`, width: `${block.width}px`, height: `${block.height}px` });
    if (block.heading) {
      const h = block.heading;
      const headingFont = memberHeadingFont(font);
      box.dataset.memberGroup = h.groupId; box.dataset.continuation = String(h.continuation);
      box.append(node(h.text, { width: `${memberTextWidth(block.width-20,headingFont)}px` }));
      Object.assign(box.style, { padding: "10px 8px", borderLeft: `4px solid ${h.color ?? "#94a3b8"}`, background: "#f8fafc", fontWeight: "700", fontSize: `${headingFont}px`, lineHeight: `${memberLineHeight(headingFont)}px` });
    } else if (block.entry) {
      box.dataset.memberId = block.entry.id;
      Object.assign(box.style, { display: "flex", padding: "4px 0", borderBottom: "1px solid #e2e8f0" });
      box.append(node(`${block.entry.no}.`, { width: `${plan.numberWidth}px`, flexShrink: "0", color: "#475569", fontSize: `${font*.75}px` }),
        node(block.entry.name, { width: `${memberTextWidth(block.width-plan.numberWidth,font)}px`, minWidth: "0" }));
    } else box.textContent = "登録なし";
    sheet.append(box);
  }
  if (!snapshot.totalCount && !plan.blocks.length) sheet.append(node("名簿は空です。", { position: "absolute", left: `${padding}px`, top: `${padding+plan.headerHeight}px` }));
  sheet.append(node(`書き出し日: ${new Date(snapshot.exportedAt).toLocaleDateString("ja-JP")}　名前は拡大して確認できます`, { position: "absolute", bottom: `${padding}px`, left: `${padding}px`, width: `${plan.width-padding*2}px`, fontSize: "20px", lineHeight: "26px", color: "#475569" }));
  return sheet;
};

export const generateMemberMobileExport = async (
  snapshot: RosterExportSnapshot, format: "png" | "pdf", base: string, options: GenerationOptions,
  plan: MemberMobilePlan,
): Promise<GeneratedExport> => {
  const host = node(undefined, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none" });
  host.setAttribute("aria-hidden", "true"); host.dataset.mobileExportHost = "true"; document.body.append(host);
  try {
    return await encodeMobilePages([{ ...plan, pageNumber: 1 }], () => {
      const sheet = drawMemberMobilePage(snapshot, plan); host.replaceChildren(sheet);
      // Check every measured row too, not just the outer fixed-size canvas.
      for (const row of sheet.querySelectorAll<HTMLElement>("[data-member-id], [data-member-group]")) {
        if (row.scrollHeight > Math.ceil(parseFloat(row.style.height)) || row.scrollWidth > Math.ceil(parseFloat(row.style.width))) throw new Error("名前が配置範囲に収まりません。書き出しを中止しました。");
      }
      return sheet;
    }, () => host.replaceChildren(), format, base, "メンバー名簿", "全体", options, { width: plan.width, pixelRatio: 1 });
  } finally { host.remove(); }
};

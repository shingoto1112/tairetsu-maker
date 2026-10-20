import { CSS_PX_MM, UnsupportedVectorLayout, type GraphemePlacement } from "./model";
import { graphemes } from "./textRuns";

/** Temporary zero-size inline probes read the actual mixed-font baseline. The
 * original text node identities and all DOM content are restored in finally.
 * All callers supply unrotated elements (prop measurement uses a separate host). */
export function measureMixedGraphemes(el: HTMLElement, root: HTMLElement): GraphemePlacement[] {
  const origin = root.getBoundingClientRect();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const result: GraphemePlacement[] = [];
  const spaces: { index: number; rect: DOMRect }[] = [];
  for (const source of nodes) {
    let sourceOffset = 0;
    const original = graphemes(source.data).map(text => {
      const range = document.createRange(); range.setStart(source, sourceOffset); sourceOffset += text.length; range.setEnd(source, sourceOffset);
      return { text, before: range.getBoundingClientRect() };
    });
    // Direct text in a flex container is one anonymous flex item. Keep that item
    // intact when inserting probes; otherwise the probe becomes a new flex item.
    const parent = source.parentElement!;
    const flex = /^(inline-)?(flex|grid)$/.test(getComputedStyle(parent).display);
    const wrapper = flex ? document.createElement("span") : undefined;
    if (wrapper) { source.replaceWith(wrapper); wrapper.append(source); }
    try {
      let offset = 0;
      for (const { text, before } of original) {
        offset += text.length;
        if (/^\s+$/u.test(text)) {
          spaces.push({ index: result.length, rect: before });
          result.push({ text, x: (before.x - origin.x) * CSS_PX_MM, advance: before.width * CSS_PX_MM, baseline: NaN });
          continue;
        }
        const marker = document.createComment("pdf-baseline"), probe = document.createElement("span");
        const at = offset;
        const left = document.createTextNode(source.data.slice(0, at)), right = document.createTextNode(source.data.slice(at));
        probe.setAttribute("data-ephemeral", "");
        probe.style.cssText = "display:inline-block!important;width:0!important;height:0!important;padding:0!important;margin:0!important;border:0!important;vertical-align:baseline!important;line-height:0!important;transform:none!important";
        source.replaceWith(marker, left, probe, right);
        try {
          const check = document.createRange();
          check.setStart(left, at - text.length); check.setEnd(left, at);
          const r = check.getBoundingClientRect(), baseline = probe.getBoundingClientRect().y;
          if (Math.abs(r.x - before.x) > .15 || Math.abs(r.y - before.y) > .15 || Math.abs(r.width - before.width) > .15 ||
            baseline < before.y || baseline > before.bottom + .15)
            throw new UnsupportedVectorLayout("基準線プローブで文字配置が変化しました。");
          // Keep original Range advances, not the independently rounded split-node
          // advances. Only the zero-dimensional probe supplies the baseline.
          result.push({ text, x: (before.x - origin.x) * CSS_PX_MM, advance: before.width * CSS_PX_MM,
            baseline: (baseline - origin.y) * CSS_PX_MM });
        } finally { left.remove(); probe.remove(); right.remove(); marker.replaceWith(source); }
      }
    } finally { wrapper?.replaceWith(source); }
  }
  for (const { index, rect } of spaces) {
    const baseline = result.find(p => Number.isFinite(p.baseline) && p.baseline / CSS_PX_MM + origin.y >= rect.y &&
      p.baseline / CSS_PX_MM + origin.y <= rect.bottom + .15)?.baseline;
    if (baseline === undefined) throw new UnsupportedVectorLayout("空白の行基準線を取得できません。");
    result[index].baseline = baseline;
  }
  return result;
}

export function slicePlacements(parts: GraphemePlacement[], start: number, end: number) {
  let offset = 0;
  return parts.filter(p => { const from = offset; offset += p.text.length; return from >= start && offset <= end; });
}

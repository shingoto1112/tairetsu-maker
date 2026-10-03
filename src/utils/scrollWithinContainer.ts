/** Reveal a target in its nearest scroll owner, never in the document. */
export const scrollWithinContainer = (
  element: HTMLElement | null,
  options: { block?: "center" | "nearest" | "end"; behavior?: ScrollBehavior } = {},
) => {
  if (!element) return;
  const doc = element.ownerDocument;
  let container = element.parentElement;
  while (container && container !== doc.body && container !== doc.documentElement) {
    const css = getComputedStyle(container);
    if (/(auto|scroll)/.test(css.overflowY) && container.scrollHeight > container.clientHeight) {
      const rect = container.getBoundingClientRect();
      const target = element.getBoundingClientRect();
      const top = rect.top + container.clientTop + (parseFloat(css.scrollPaddingTop) || 0);
      const bottom = rect.top + container.clientTop + container.clientHeight - (parseFloat(css.scrollPaddingBottom) || 0);
      const block = options.block ?? "nearest";
      let delta = block === "center" ? (target.top + target.bottom - top - bottom) / 2
        : block === "end" ? target.bottom - bottom
        : target.top < top ? target.top - top : target.bottom > bottom ? target.bottom - bottom : 0;
      delta = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + delta));
      container.scrollTo({ top: delta, behavior: options.behavior ?? "smooth" });
      return;
    }
    container = container.parentElement;
  }
};

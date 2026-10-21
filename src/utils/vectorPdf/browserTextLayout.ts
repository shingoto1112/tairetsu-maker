import { CSS_PX_MM, UnsupportedVectorLayout, type PropTextLayout, type TextLine } from "./model";
import { measureTextLines } from "./browserDocumentLayout";
import { applyPrintObjectLabels } from "../printObjectLabelBrowser";
import { getElementPixelSize } from "../exportImage";

/** Preserve the existing A4 fitting; never derive shape positions from DOM bboxes. */
export const measurePrintPageExtent = (element: HTMLElement) => {
  const size = getElementPixelSize(element);
  return { width: size.width * CSS_PX_MM, height: size.height * CSS_PX_MM };
};

/** Read final DOM rows in their local coordinates, with rotation removed.
 * Both writers use the very same chosen lines and font sizes. */
function localLabelLines(original: HTMLElement, width: number, height: number): TextLine[] {
  const host = original.cloneNode(true) as HTMLElement;
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", visibility: "hidden",
    transform: "none", width: width + "mm", height: height + "mm",
    fontFamily: getComputedStyle(original).fontFamily });
  const label = host.querySelector<HTMLElement>("[data-print-object-label]");
  if (!label) throw new UnsupportedVectorLayout("道具名の配置が見つかりません。");
  // The model already anchors the saved shape centre. Remove the DOM-only
  // compensation for CSS's minimum box, along with its readable rotation.
  Object.assign(label.style, { transform: "none", left: "50%", top: "50%" });
  document.body.append(host);
  try {
    const bounds = host.getBoundingClientRect(), cx = bounds.width * CSS_PX_MM / 2, cy = bounds.height * CSS_PX_MM / 2;
    return [...label.querySelectorAll<HTMLElement>(".print-object-label__line")].flatMap(row => {
      const lines = measureTextLines(row, host);
      return lines.map(line => ({ ...line, x: line.x - cx, y: line.y - cy,
        measureMixed: () => {
          document.body.append(host);
          try { return line.measureMixed!().map(p => ({ ...p, x: p.x - cx, baseline: p.baseline - cy })); }
          finally { host.remove(); }
        } }));
    });
  } finally { host.remove(); }
}

export function propTextFromPrintDom(root: HTMLElement): PropTextLayout {
  const objects = [...root.querySelectorAll<HTMLElement>(".print-stage .print-object")];
  let index = 0;
  return (value, width, height) => {
    const object = objects[index++], label = object?.querySelector<HTMLElement>("[data-print-object-label]");
    if (!label || label.dataset.labelText !== value || Math.abs(Number(label.dataset.labelWidth) - width) > .001 ||
      Math.abs(Number(label.dataset.labelHeight) - height) > .001)
      throw new UnsupportedVectorLayout("道具名のDOMとモデルが一致しません。");
    return localLabelLines(object, width, height);
  };
}

/** Prototype API uses the same adapter as the public DOM writer. */
export const measurePropText: PropTextLayout = (value, width, height, _correction, radius = 0) => {
  const host = document.createElement("div"), label = document.createElement("span");
  host.className = "print-object" + (radius ? " shape-circle" : "");
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", visibility: "hidden",
    width: width + "mm", height: height + "mm", fontFamily: '"BIZUDPGothic"' });
  label.className = "print-object-label"; label.dataset.printObjectLabel = "";
  Object.assign(label.dataset, { labelText: value, labelWidth: String(width), labelHeight: String(height) });
  host.append(label); document.body.append(host);
  try { applyPrintObjectLabels(host); return localLabelLines(host, width, height); }
  finally { host.remove(); }
};

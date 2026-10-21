import { useEffect, useRef, useState } from "react";
import { getPrintObjectLabelLayout } from "../utils/printObjectLabel";
import { createPrintObjectLabelMeasurer, labelInput, printObjectLabelAnchor } from "../utils/printObjectLabelBrowser";

/** Dedicated print label; editor labels and saved data do not use this component. */
export function PrintObjectLabel({ text, width, height, correction = 0, rotation = 0 }: {
  text: string; width: number; height: number; correction?: number; rotation?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState<(ReturnType<typeof getPrintObjectLabelLayout> & { anchor: ReturnType<typeof printObjectLabelAnchor> })>();
  useEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (!cancelled && ref.current) {
        const { input, style } = labelInput(ref.current);
        // jsdom has no text geometry. Real export clones always remeasure.
        if (ref.current.parentElement?.getBoundingClientRect().width)
          setMeasured({ ...createPrintObjectLabelMeasurer()(input, style), anchor: printObjectLabelAnchor(ref.current) });
      }
    };
    measure(); void document.fonts?.ready.then(measure);
    return () => { cancelled = true; };
  }, [text, width, height, correction, rotation]);
  return <span ref={ref} className="print-object-label" data-print-object-label=""
    data-label-text={text} data-label-width={width} data-label-height={height}
    data-label-overflow={measured ? String(measured.overflow) : undefined}
    style={{ ...measured?.anchor, transform: `rotate(${correction}deg)` }}>
    {measured ? measured.lines.map((line, i) => <span key={i} className="print-object-label__line"
      style={{ fontSize: `${measured.size}mm`, left: `${line.x}mm`, top: `${line.y - (line.boxOffsetY ?? 0)}mm` }}>{line.text}</span>) : text}
  </span>;
}

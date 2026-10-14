/** Display only. Interior stage coordinates use the surface's padding box; endpoints use border centers. */
export const stageRulerPosition = (positionMeters: number, extentMeters: number): string => {
  const p = positionMeters / extentMeters;
  if (Math.abs(p) < 1e-9) return "calc(var(--stage-border-width) / 2)";
  if (Math.abs(p - 1) < 1e-9) return "calc(100% - var(--stage-border-width) / 2)";
  return `calc(${p * 100}% + var(--stage-border-width) * ${1 - 2 * p})`;
};

/** Parade geometry stays in px, including after zoom. Do not scale its coordinates as percentages. */
export const paradeRulerPosition = (positionPx: number, extentPx: number): string => {
  if (Math.abs(positionPx) < 1e-7) return "calc(var(--parade-border-width) / 2)";
  if (Math.abs(positionPx - extentPx) < 1e-7) return `calc(${extentPx}px - var(--parade-border-width) / 2)`;
  return `calc(${positionPx}px + var(--parade-border-width))`;
};

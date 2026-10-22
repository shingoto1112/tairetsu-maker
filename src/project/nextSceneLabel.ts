import type { FormationFrame } from "../types";

/** Only new scenes are named here; existing labels remain unchanged. */
export const nextSceneLabel = (frames: readonly Pick<FormationFrame, "label">[]): string => {
  const used = new Set<number>();
  for (const { label } of frames) {
    const match = /^(?:シーン|Scene)\s*(\d+)$/u.exec(label.trim());
    if (match) used.add(Number(match[1]));
  }
  let number = frames.length + 1;
  while (used.has(number)) number += 1;
  return `シーン${number}`;
};

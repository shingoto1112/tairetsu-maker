import type { Project } from "../types";

/** Deterministic 24-person, three-scene fixture for export regression tests. */
export const formationExportFixture = (): Project => ({
  version: 1, title: "練習用", updatedAt: "2026-10-02T00:00:00Z",
  stage: { widthMeters: 12, depthMeters: 8, gridSizeMeters: 1, showGrid: true,
    showCenterLine: true, audienceSide: "bottom", showStageLabels: true, memberDiameterMeters: 0.5 },
  members: Array.from({ length: 24 }, (_, index) => ({ id: `m${index}`, name: `名前${index + 1}`, color: "#0d8b78" })),
  stageObjects: [{ id: "flag", type: "prop", name: "旗", color: "#2563eb", shape: "rectangle",
    widthMeters: 3, heightMeters: 1, defaultX: 4, defaultY: 3, defaultRotation: 45, visible: true, locked: false, zIndex: 0 }],
  frames: Array.from({ length: 3 }, (_, index) => ({ id: `s${index}`, label: `シーン${index + 1}`, timeSec: index * 30,
    notes: "書き出さないメモ", positions: Object.fromEntries(Array.from({ length: 24 }, (_, member) =>
      [`m${member}`, { x: 1 + (member % 8) * 1.3, y: 1 + Math.floor(member / 8) * 2 }])), objectStates: {} })),
});

import type { Project } from "../../types";
/** Entirely fictional, deliberately asymmetric performer-view export fixture. */
export function vectorPdfFixture(width = 9, depth = 5.5, count = 1): Project {
  const names = ["あお", "紅", "みどり", "山田花子", "高橋あかね", "佐々木ひかる", "Takahashi", "Yuki", "AB12", "髙橋", "﨑山", "夏祭り出演者"];
  const colors = ["#38bdf8", "#fda4af", "#86efac", "#fde047", "#c4b5fd", "#2563eb"];
  const props = [
    { id: "panel", name: "大道具Ａ", color: "#2563eb", shape: "rectangle" as const, w: 2.4, h: .65, x: 2, y: 2.1, rotation: 137 },
    { id: "circle", name: "円形台", color: "#c62828", shape: "circle" as const, w: .9, h: .9, x: 6.4, y: 3, rotation: -35 },
    { id: "edge", name: "ななめ", color: "#237a34", shape: "rectangle" as const, w: 1.6, h: .45, x: -.15, y: 4.3, rotation: 35 },
  ];
  return { version: 1, title: "架空・学祭Ｂ型", mode: "stage", updatedAt: "2026-10-21T00:00:00Z", viewerPerspective: "performer",
    stage: { widthMeters: width, depthMeters: depth, gridSizeMeters: .5, showGrid: true, showCenterLine: true,
      audienceSide: "bottom", frontDirection: "bottom", showStageLabels: false, memberDiameterMeters: .5,
      horizontalGuideMode: "centerSplit", emphasizeHorizontalNumbers: true, emphasizeVerticalEvery5m: true },
    members: Array.from({ length: 32 }, (_, i) => ({ id: `m${i}`, name: names[i % names.length], color: colors[i % colors.length] })),
    stageObjects: props.map(p => ({ id: p.id, name: p.name, color: p.color, type: "prop", shape: p.shape,
      widthMeters: p.w, heightMeters: p.h, defaultX: p.x, defaultY: p.y, defaultRotation: p.rotation, visible: true, locked: false, zIndex: 0 })),
    frames: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `学祭Ｂ型・シーン${i + 1}`, timeSec: i * 20,
      positions: Object.fromEntries(Array.from({ length: 32 }, (_, j) => [`m${j}`, { x: .45 + j % 8 * (width - .9) / 7,
        y: .5 + Math.floor(j / 8) * (depth - 1) / 3 }])),
      objectStates: Object.fromEntries(props.map(p => [p.id, { objectId: p.id, x: p.x, y: p.y, widthMeters: p.w,
        heightMeters: p.h, rotation: p.rotation, visible: true, zIndex: 0 }])),
      annotationLines: { diagonal: { x1: -1, y1: 1, x2: width + 1, y2: depth - 1, color: "red", dash: "dashed" },
        solid: { x1: 1, y1: depth - .4, x2: width - 1, y2: .4, color: "blue", dash: "solid" } },
    })),
  };
}

/** Stage② acceptance fixtures; the prototype fixture stays unchanged for regression tests. */
export function vectorStage2Fixture(width = 9, depth = 5.5, count = 7): Project {
  const p = vectorPdfFixture(width, depth, count);
  p.objectGroups = [{ id: "fixtures", name: "検証用道具", objectIds: ["circle", "edge", "panel"] }];
  p.frames.forEach((frame, i) => {
    frame.objectAssignments = { panel: ["m24", "m25", "m26", "m27", "m28"], circle: ["m29", "m30"], edge: ["m23"] };
    frame.memberVisibility = { m31: false };
    frame.memberAppearanceOverrides = { m2: { color: "#0d8b78" } };
    frame.objectStates.panel.rotation = [0, 45, 90, -90, 137, 180, 270][i % 7];
  });
  return p;
}

/** Addendum fixtures leave the original stage② regression inputs intact. */
export function vectorCurtainFixture(width = 9, depth = 5.5, count = 7): Project {
  const p = vectorStage2Fixture(width, depth, count);
  // Modern curtain preset and legacy saved curtain shapes must both stay striped.
  Object.assign(p.stageObjects[0], { type: "curtain", shape: "rectangle", name: "大ラス幕" });
  p.stageObjects[2].shape = "line";
  p.stageObjects[2].name = "線";
  const extras = [
    { id: "curtain90", name: "花街幕", shape: "curtain" as const, rotation: 90, x: 6, y: .9 },
    { id: "curtain137", name: "斜め幕", shape: "curtain" as const, rotation: 137, x: 4, y: 3.5 },
    { id: "custom", name: "カスタム", shape: "custom" as const, rotation: 35, x: .7, y: .8 },
  ];
  p.stageObjects.push(...extras.map(e => ({ ...p.stageObjects[2], id: e.id, name: e.name, shape: e.shape,
    widthMeters: 1.4, heightMeters: .5, defaultX: e.x, defaultY: e.y, defaultRotation: e.rotation })));
  p.objectGroups![0].objectIds = p.stageObjects.map(o => o.id);
  p.frames.forEach(f => {
    f.objectStates.panel.rotation = 0;
    for (const [i, e] of extras.entries()) {
      f.objectStates[e.id] = { objectId: e.id, x: e.x, y: e.y, widthMeters: 1.4, heightMeters: .5,
        rotation: e.rotation, visible: true, zIndex: 0 };
      f.objectAssignments![e.id] = [`m${20 + i}`];
    }
  });
  return p;
}

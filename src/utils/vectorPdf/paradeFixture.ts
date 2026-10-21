import { vectorCurtainFixture, vectorAssignmentFixture } from "./fixture";

/** Fictional acceptance inputs only. Kept separate from existing stage fixtures. */
export function vectorParadeFixture(spec: { total?: number; backward?: number; cell?: number; width?: number;
  count?: number; empty?: boolean; annotationsOnly?: boolean; long?: boolean; many?: boolean;
  crossing?: boolean; assignments?: boolean; emptyAssignments?: boolean; emphasisOff?: boolean; emoji?: boolean;
  horizontalMode?: "normalMeter" | "centerSplit" } = {}) {
  const total = spec.total ?? 100, backward = spec.backward ?? 0, width = spec.width ?? 9.3;
  const p = spec.many ? vectorAssignmentFixture(width, 18, spec.count ?? 1) : vectorCurtainFixture(width, 6, spec.count ?? 1);
  p.mode = "parade"; p.title = "架空・パレードPDF検証";
  p.stage.depthMeters = total; p.stage.widthMeters = width;
  p.paradeSettings = { totalDistance: total, backwardDistanceMeters: backward, width,
    cellSizeMeters: spec.cell ?? 1, direction: "up", rulerPosition: "both",
    horizontalMeasureMode: spec.horizontalMode ?? "centerSplit", emphasizeEvery5m: !spec.emphasisOff,
    emphasizeEvery10m: !spec.emphasisOff, emphasizeVerticalNumbers: false };
  if (spec.emoji) {
    p.members[0].name = "あお🔥"; p.members[1].name = "👩🏽‍🎤"; p.members[2].name = "𠮷田";
    p.stageObjects[0].name = "幕🔥";
  }
  p.frames.forEach((f, i) => {
    f.label = `パレード・シーン${i + 1}`;
    const start = spec.crossing ? total - 3 : spec.long ? .4 : total / 2 + i % 3 * 2;
    const depth = spec.long ? total + backward - .8 : spec.many ? 18 : 6;
    f.positions = Object.fromEntries(p.members.map((member, j) => [member.id, {
      x: .45 + j % 8 * (width - .9) / 7,
      y: start + Math.floor(j / 8) * depth / Math.max(1, Math.ceil(p.members.length / 8) - 1),
    }]));
    for (const [j, state] of Object.values(f.objectStates).entries()) {
      state.y = start + j % 3 * 1.6; state.x = Math.min(width - state.widthMeters, Math.max(0, state.x));
    }
    // Rotation extends beyond the unrotated range at the upper/lower crop edge.
    if (!spec.many) {
      Object.assign(f.objectStates.edge, { y: start - 1, widthMeters: 6, heightMeters: .45, rotation: 90 });
      Object.assign(f.objectStates.panel, { y: start + 5.8, rotation: 137 });
    }
    f.objectAssignments = spec.assignments && !spec.emptyAssignments ? { [p.stageObjects[0].id]: ["m24", "m25"] } : {};
    f.memberVisibility = { m31: false, m25: false };
    f.annotationLines = {
      diagonal: { x1: -1, y1: start - 7, x2: width + 1, y2: start + 11, color: "red", dash: "dashed" },
      solid: { x1: 1, y1: start + 4, x2: width - 1, y2: start - 2, color: "blue", dash: "solid" },
    };
    if (spec.empty || spec.annotationsOnly) { f.positions = {}; f.objectStates = Object.fromEntries(Object.entries(f.objectStates).map(([id, s]) => [id, { ...s, visible: false }])); f.objectAssignments = {}; }
    if (spec.annotationsOnly) {
      // Intersect the legacy empty range [0, 10], and extend beyond both ends.
      f.annotationLines.diagonal.y1 = -3; f.annotationLines.diagonal.y2 = 14;
      f.annotationLines.solid.y1 = 9; f.annotationLines.solid.y2 = -1;
    }
    if (spec.empty) f.annotationLines = {};
  });
  return p;
}

/** Full-size fictional regression project. Do not inherit the stage fixture's
 * 18-frame slice: requested counts must really contain 60/100 distinct scenes. */
export function vectorLargeParadeFixture(memberCount = 146, sceneCount = 60) {
  const p = vectorParadeFixture({ total: 150, width: 12, many: true, assignments: true });
  p.stageObjects = p.stageObjects.slice(0, 6);
  p.members = Array.from({ length: memberCount }, (_, i) => ({ ...p.members[i % p.members.length], id: `m${i}`, name: `架空${i + 1}` }));
  const source = p.frames[0];
  p.frames = Array.from({ length: sceneCount }, (_, i) => ({ ...structuredClone(source), id: `s${i}`, label: `パレード・シーン${i + 1}`, timeSec: i * 20,
    positions: Object.fromEntries(p.members.map((member, j) => [member.id, { x: .5 + j % 12, y: 30 + Math.floor(j / 12) }])),
    objectStates: Object.fromEntries(p.stageObjects.map(o => [o.id, structuredClone(source.objectStates[o.id])])),
    objectAssignments: i % 3 === 0 ? { [p.stageObjects[0].id]: ["m24", "m25"] } : {},
  }));
  return p;
}

import { describe, expect, it } from "vitest";
import { formationExportFixture } from "./formationExportFixture";
import { createFormationSnapshot, DETAIL_MIN_DIAMETER_PX, FORMATION_DRAW_WIDTH, formationVerticalRange,
  horizontalTiles, planFormationPages, rotatedObjectBounds, TILE_OVERLAP_METERS } from "./formationExportLayout";
import type { ExportSource, FormationSnapshot } from "./mobileExportTypes";
import type { TextMeasure } from "./mobileExportLayout";

const measure: TextMeasure = (text, width, font, line) => Math.max(1, Math.ceil(text.length * font * 0.65 / width)) * line;
export const formationSnapshotFixture = (): FormationSnapshot => ({ title: "練習用", exportedAt: "2026-10-02T00:00:00Z", scopeLabel: "全シーン", project: formationExportFixture() });

describe("formation mobile page planning", () => {
  it("packs whole scene blocks, shrinks only the last page and numbers every page", () => {
    const snapshot = formationSnapshotFixture();
    const pages = planFormationPages(snapshot, false, measure);
    expect(pages.map((page) => page.blocks.length)).toEqual([2, 1]);
    expect(pages[0].height).toBe(960); expect(pages[1].height).toBeLessThan(960);
    expect(pages.flatMap((page) => page.blocks).map((block) => block.frame.id)).toEqual(["s0", "s1", "s2"]);
    expect(pages.flatMap((page) => page.blocks).every((block) => block.slices === 1)).toBe(true);
    expect(pages.map((page) => [page.pageNumber, page.totalPages])).toEqual([[1, 2], [2, 2]]);
  });
  it("uses a single physical scale for differing scene widths and depths", () => {
    const snapshot = formationSnapshotFixture(); snapshot.project.useGlobalStageSize = false;
    snapshot.project.frames[1].stageWidthMeters = 6; snapshot.project.frames[2].stageDepthMeters = 30;
    const blocks = planFormationPages(snapshot, false, measure).flatMap((page) => page.blocks);
    expect(new Set(blocks.map((block) => block.scale)).size).toBe(1);
    expect(blocks[1].stageWidth).toBe(6);
    expect(blocks[1].range.right - blocks[1].range.left).toBeLessThan(blocks[0].range.right - blocks[0].range.left);
    expect(blocks.every((block) => block.slices === 1 && block.height <= 882)).toBe(true);
  });
  it("uses the minimum columns for 64px circles, capped at three, including rulers and overlap", () => {
    expect(horizontalTiles(12, 0.5)).toHaveLength(2);
    expect(horizontalTiles(18, 0.5)).toHaveLength(3);
    expect(horizontalTiles(4, 0.5)).toHaveLength(1);
    expect(horizontalTiles(100, 0.5)).toHaveLength(3);
    expect(horizontalTiles(12, 0.1)).toHaveLength(3);
    for (const width of [4, 12, 18]) {
      const tiles = horizontalTiles(width, 0.5);
      for (const tile of tiles) expect(0.5 * FORMATION_DRAW_WIDTH * 2 / (tile.right - tile.left)).toBeGreaterThanOrEqual(DETAIL_MIN_DIAMETER_PX);
      for (let i = 1; i < tiles.length; i++) expect(tiles[i - 1].right - tiles[i].left).toBeCloseTo(TILE_OVERLAP_METERS);
      expect(tiles[0].left).toBe(-0.25); expect(tiles[tiles.length - 1].right).toBe(width + 0.25);
    }
  });
  it("keeps all overviews first, details left to right and supplies exact locator and overlap ranges", () => {
    const snapshot = formationSnapshotFixture();
    const pages = planFormationPages(snapshot, true, measure);
    const blocks = pages.flatMap((page) => page.blocks), first = blocks.findIndex((block) => block.detail);
    expect(first).toBe(3); expect(blocks.slice(first).every((block) => block.detail)).toBe(true);
    const details = blocks.filter((block) => block.frame.id === "s0" && block.detail);
    expect(pages).toHaveLength(8);
    expect(pages.filter((page) => !page.blocks[0].detail)).toHaveLength(2);
    expect(pages.filter((page) => page.blocks[0].detail)).toHaveLength(6);
    expect([...new Set(details.map((block) => block.tile?.index))]).toEqual([0, 1]);
    expect(details[0].fullRange).toEqual({ left: -0.25, right: 12.25, top: -0.25, bottom: 8.25 });
    expect(details[0].range.left).toBe(-0.25); expect(details[0].range.right).toBe(6.25);
    expect(details.every((block) => block.slices === 1 && block.overlapTop === 0 && block.overlapBottom === 0)).toBe(true);
    expect(details.every((block) => block.scale * 0.5 * 2 >= DETAIL_MIN_DIAMETER_PX)).toBe(true);
    expect(details[0].scale * 0.5 * 2).toBeCloseTo(64.615, 2);
    expect(pages.filter((page) => page.blocks[0].detail).every((page) => page.blocks.length === 1)).toBe(true);
    expect(pages.every((page) => page.height <= 960)).toBe(true);
  });
  it("does not duplicate an already readable narrow stage or parade", () => {
    const snapshot = formationSnapshotFixture(); snapshot.project.stage.widthMeters = 4; snapshot.project.stage.depthMeters = 4;
    expect(planFormationPages(snapshot, true, measure).flatMap((page) => page.blocks).some((block) => block.detail)).toBe(false);
    snapshot.project.mode = "parade";
    snapshot.project.paradeSettings = { totalDistance: 100, width: 4, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    expect(planFormationPages(snapshot, true, measure).flatMap((page) => page.blocks).some((block) => block.detail)).toBe(false);
  });
  it("fits even very deep stage details proportionally on one page without vertical splitting", () => {
    const snapshot = formationSnapshotFixture(); snapshot.project.stage.widthMeters = 4; snapshot.project.stage.depthMeters = 30;
    const blocks = planFormationPages(snapshot, true, measure).flatMap((page) => page.blocks);
    expect(blocks.filter((block) => !block.detail).every((block) => block.slices === 1)).toBe(true);
    const details = blocks.filter((block) => block.detail);
    expect(details).toHaveLength(3);
    expect(details.every((block) => block.tile?.count === 1 && block.slices === 1)).toBe(true);
    expect(details.every((block) => block.range.top === -0.25 && block.range.bottom === 30.25 && block.height <= 882)).toBe(true);
    expect(details[0].scale).toBeLessThan(FORMATION_DRAW_WIDTH / 4.5);
  });
  it("retains vertical parade slicing for both overviews and necessary horizontal details", () => {
    const snapshot = formationSnapshotFixture(), project = snapshot.project; project.mode = "parade";
    project.paradeSettings = { totalDistance: 100, width: 12, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    project.frames[0].positions.m0.y = 95;
    const blocks = planFormationPages(snapshot, true, measure).flatMap((page) => page.blocks).filter((block) => block.frame.id === "s0");
    expect(blocks.some((block) => !block.detail && block.slices > 1)).toBe(true);
    expect(blocks.some((block) => block.detail && block.slices > 1)).toBe(true);
    for (const index of [0, 1]) {
      const slices = blocks.filter((block) => block.detail && block.tile?.index === index);
      expect(slices.length).toBeGreaterThan(1);
      expect(slices[0].range.top).toBe(slices[0].fullRange.top);
      expect(slices[slices.length - 1].range.bottom).toBe(slices[0].fullRange.bottom);
      for (let i = 1; i < slices.length; i++) expect(slices[i - 1].range.bottom - slices[i].range.top).toBeCloseTo(0.5);
    }
  });
  it("covers rotated props and visible unassigned members with 2m padding before vertical parade splitting", () => {
    const snapshot = formationSnapshotFixture(), project = snapshot.project; project.mode = "parade";
    project.paradeSettings = { totalDistance: 100, width: 6, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    project.stageObjects[0] = { ...project.stageObjects[0], widthMeters: 10, heightMeters: 1, defaultRotation: 90, defaultY: 50 };
    project.frames[0].positions.m0.y = 95; project.frames[0].memberVisibility = { m0: false };
    const bounds = rotatedObjectBounds({ x: 4, y: 50, widthMeters: 10, heightMeters: 1, rotation: 90 });
    expect(bounds.top).toBeCloseTo(45.5); expect(bounds.bottom).toBeCloseTo(55.5);
    const full = formationVerticalRange(project, project.frames[0]);
    expect(full.bottom).toBe(58); expect(full.top).toBe(0);
    const blocks = planFormationPages(snapshot, false, measure).flatMap((page) => page.blocks).filter((block) => block.frame.id === "s0");
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[blocks.length - 1].range.bottom).toBe(58);
    expect(blocks[1].caption).toMatch(/続き 2\/\d+・[\d.]+〜[\d.]+m/);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i - 1].range.bottom - blocks[i].range.top).toBeCloseTo(0.5);
  });
  it("freezes and sorts source without changing project data or the selected scope", () => {
    const project = formationExportFixture(); project.frames.reverse();
    const source: ExportSource = { project, projectTitle: project.title, members: project.members, memberGroups: [], objects: project.stageObjects,
      objectGroups: [], frames: project.frames, currentFrame: project.frames[1], objectStates: {} };
    const snapshot = createFormationSnapshot(source, "current");
    project.members[0].name = "変更";
    expect(snapshot.project.members[0].name).toBe("名前1");
    expect(snapshot.project.frames.map((frame) => frame.id)).toEqual(["s1"]);
    expect(project.frames[0].id).toBe("s2");
  });
});

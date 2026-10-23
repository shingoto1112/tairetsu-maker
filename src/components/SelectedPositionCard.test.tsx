/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SelectedPositionCard } from "./SelectedPositionCard";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "../utils/interpolation";

afterEach(cleanup);

// Hand-calculated for 10 x 6m. This card has no perspective prop: both views use these physical values.
it.each([
  ["top", -3, 1, 6], ["bottom", 3, 5, 4],
  ["left", 3, 5, 4], ["right", 3, 5, 4], [undefined, 3, 5, 4],
] as const)("performer-right signs and inverse for front=%s", (front, x, y, internalX) => {
  const p = props(); p.stage = { ...p.stage, depthMeters: 6, frontDirection: front };
  p.snapshot.positions.m_anna = { x: 2, y: 1 };
  const before = structuredClone(p.snapshot);
  render(<SelectedPositionCard {...p} />);
  expect((input(/^横（/) as HTMLInputElement).value).toBe(String(x));
  expect((input(/^縦（/) as HTMLInputElement).value).toBe(String(y));
  expect(p.onMoveMember).not.toHaveBeenCalled();
  change(/^横（/, "1");
  expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: internalX, y: 1 });
  // Number stepper changes pass through the same onChange inverse as typed values.
  change(/^横（/, "1.01");
  expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: front === "top" ? 6.01 : 3.99, y: 1 });
  change(/^横（/, "0.99");
  expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: front === "top" ? 5.99 : 4.01, y: 1 });
  expect(p.snapshot).toEqual(before);
});
it.each([
  ["top", -3, -5, 3, 6], ["bottom", 3, -3, 5, 4],
] as const)("prop keeps its stored corner and reordered numeric bounds for %s", (front, x, min, max, internalX) => {
  const p = props(); p.stage = { ...p.stage, depthMeters: 6, frontDirection: front };
  p.selected = { type: "object", id: "o_chair" };
  p.snapshot.objectStates.o_chair = { objectId: "o_chair", x: 2, y: 1, widthMeters: 2, heightMeters: 1, rotation: 0, visible: true, zIndex: 10 };
  render(<SelectedPositionCard {...p} />);
  const field = input(/^横（/) as HTMLInputElement;
  expect(field.value).toBe(String(x)); expect(field.min).toBe(String(min)); expect(field.max).toBe(String(max));
  change(/^横（/, "1"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { x: internalX });
});
it("uses audienceSide top when legacy front is absent", () => {
  const p = props(); p.stage.frontDirection = undefined; p.stage.audienceSide = "top";
  p.snapshot.positions.m_anna.y = 1;
  render(<SelectedPositionCard {...p} />);
  expect((input(/^横（/) as HTMLInputElement).value).toBe("-3");
  change(/^横（/, "1"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 6, y: 1 });
});
function props(): ComponentProps<typeof SelectedPositionCard> {
  const p = createSampleProject();
  return { selected: { type: "member", id: "m_anna" }, selectedMemberIds: [], members: p.members,
    memberGroups: [], objects: p.stageObjects, currentFrame: p.frames[0],
    snapshot: { ...getSnapshotForFrame(p, p.frames[0].id), positions: { m_anna: { x: 2, y: 23 } } },
    stage: { ...p.stage, widthMeters: 10, depthMeters: 8, gridSizeMeters: 2 },
    onMoveMember: vi.fn(), onUpdateObjectState: vi.fn() };
}
const input = (name: RegExp) => within(screen.getByRole("region", { name: "選択対象の位置" })).getByRole("spinbutton", { name });
const change = (name: RegExp, value: string) => fireEvent.change(input(name), { target: { value } });

it.each(["meters", "centerSplit"] as const)("preserves signed stage coordinates and effective scene bounds without snapping; %s", mode => {
  const p = props(); p.stage.horizontalGuideMode = mode;
  p.snapshot.positions.m_anna.y = 2;
  render(<SelectedPositionCard {...p} />);
  expect((input(/^横（/) as HTMLInputElement).value).toBe("3");
  expect(screen.queryByRole("textbox")).toBeNull();
  change(/^横（/, "-1.13"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 6.13, y: 2 });
  // 縦 is measured from 最前 (0m ruler line): internal y 2 on an 8m stage is 6m from the front.
  expect((input(/^縦（最前から）/) as HTMLInputElement).value).toBe("6");
  change(/^縦（/, "1.5"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 2, y: 6.5 });
  change(/^縦（/, "99"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 2, y: 0 });
});
it("preserves the distance from 最前 for legacy top data with labels enabled", () => {
  const p = props(); p.stage.frontDirection = "top";
  p.stage.showStageLabels = true;
  p.stage.originMode = "topLeft";
  p.snapshot.positions.m_anna.y = 2;
  const before = JSON.stringify(p.stage);
  render(<SelectedPositionCard {...p} />);
  expect((input(/^縦（最前から）/) as HTMLInputElement).value).toBe("2");
  expect(p.onMoveMember).not.toHaveBeenCalled();
  change(/^縦（/, "3"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 2, y: 3 });
  expect(JSON.stringify(p.stage)).toBe(before);
});
it.each(["normalMeter", "centerSplit"] as const)("converts parade distance, backward range and horizontal side; %s", mode => {
  const p = props(); p.projectMode = "parade";
  p.paradeSettings = { width: 10, totalDistance: 20, backwardDistanceMeters: 5, cellSizeMeters: 2,
    direction: "up", rulerPosition: "both", horizontalMeasureMode: mode, emphasizeEvery5m: true, emphasizeEvery10m: true };
  render(<SelectedPositionCard {...p} />);
  expect((input(/^m位置/) as HTMLInputElement).value).toBe("-3");
  change(/^m位置/, "-4.13"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 2, y: 24.13 });
  change(mode === "centerSplit" ? /^横位置/ : /^横（/, "1.23");
  expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: mode === "centerSplit" ? 3.77 : 6.23, y: 23 });
  if (mode === "centerSplit") expect(screen.getByText("左 3m")).toBeTruthy();
});
it("uses one tool geometry editor with minimum .01, rotation and size-dependent position correction", () => {
  const p = props(); p.selected = { type: "object", id: "o_chair" };
  p.snapshot.objectStates.o_chair = { objectId: "o_chair", x: 8, y: 6, widthMeters: 1, heightMeters: 1, rotation: 0, visible: true, zIndex: 10 };
  render(<SelectedPositionCard {...p} />);
  change(/横幅/, "0.001"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { widthMeters: .01, x: 8, y: 6 });
  change(/縦幅/, "4"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { heightMeters: 4, x: 8, y: 4 });
  change(/横幅/, "5"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { widthMeters: 5, x: 5, y: 6 });
  change(/回転角度/, "-35.5"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { rotation: -35.5 });
  change(/^横（/, "99"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { x: 0 });
  // A prop's 縦 is the distance from 最前 to its front edge: y 6 + height 1 on an 8m stage is 1m.
  expect((input(/^縦（/) as HTMLInputElement).value).toBe("1");
  change(/^縦（/, "2"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { y: 5 });
  change(/^縦（/, "99"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { y: 0 });
});
it("constrains a parade tool by its height at the backward edge", () => {
  const p = props(); p.selected = { type: "object", id: "o_chair" }; p.projectMode = "parade";
  p.paradeSettings = { width: 10, totalDistance: 20, backwardDistanceMeters: 5, cellSizeMeters: 1,
    direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
  p.snapshot.objectStates.o_chair = { objectId: "o_chair", x: 2, y: 22, widthMeters: 2, heightMeters: 2, rotation: 0, visible: true, zIndex: 10 };
  render(<SelectedPositionCard {...p} />);
  change(/^m位置/, "-5"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { y: 23 });
  change(/^横位置/, "1.13"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { x: 3.87 });
});
it("shows only a count for multiple selection, even with a primary member", () => {
  render(<SelectedPositionCard {...props()} selectedMemberIds={["m_anna", "m_ben"]} />);
  expect(screen.getByText("2人選択中")).toBeTruthy(); expect(screen.queryByRole("spinbutton")).toBeNull();
});
it("edits the sole member selected in multiple-selection mode", () => {
  const p = props(); p.selected = null; p.selectedMemberIds = ["m_anna"]; p.snapshot.positions.m_anna.y = 2;
  render(<SelectedPositionCard {...p} />);
  expect(screen.getByText("Anna")).toBeTruthy();
  change(/^横（/, "-1.13"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 6.13, y: 2 });
});
it.each(["member", "object"] as const)("disables readonly/playback edits for %s, including programmatic changes", type => {
  const p = props(); p.selected = { type, id: type === "member" ? "m_anna" : "o_chair" };
  render(<SelectedPositionCard {...p} canEditScene={false} sceneReadOnlyMessage="再生中" />);
  for (const field of screen.getAllByRole("spinbutton")) {
    expect((field as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "1.23" } });
  }
  expect(p.onMoveMember).not.toHaveBeenCalled(); expect(p.onUpdateObjectState).not.toHaveBeenCalled();
});

it('accepts negative tool corners with rotation-aware numeric bounds and keeps a rotation-only patch', () => {
  const p = props(); p.selected = { type: "object", id: "o_chair" };
  p.snapshot.objectStates.o_chair = { objectId: "o_chair", x: -1.25, y: 2, widthMeters: 3, heightMeters: .5, rotation: 90, visible: true, zIndex: 10 };
  render(<SelectedPositionCard {...p} />);
  change(/^横（/, "6.2"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { x: -1.2 });
  change(/横幅/, "4"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { widthMeters: 4, x: -1.25, y: 2 });
  change(/回転角度/, "45"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { rotation: 45 });
});
it('parade numeric y does not clamp a legitimate negative corner before geometry constraint', () => {
  const p = props(); p.selected = { type: "object", id: "o_chair" }; p.projectMode = "parade";
  p.paradeSettings = { width: 10, totalDistance: 20, backwardDistanceMeters: 5, cellSizeMeters: 1,
    direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
  p.snapshot.objectStates.o_chair = { objectId: "o_chair", x: 2, y: -1.25, widthMeters: .5, heightMeters: 3, rotation: 90, visible: true, zIndex: 10 };
  render(<SelectedPositionCard {...p} />);
  expect((input(/^m位置/) as HTMLInputElement).value).toBe("21.25");
  change(/^m位置/, "21.2"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { y: -1.2 });
});
it('leaves old overflow untouched on selection and corrects both axes on the next numeric move', () => {
  const p = props(); p.selected = { type: "object", id: "o_chair" };
  p.snapshot.objectStates.o_chair = { objectId: "o_chair", x: -9, y: -9, widthMeters: 3, heightMeters: .5, rotation: 90, visible: true, zIndex: 10 };
  render(<SelectedPositionCard {...p} />);
  expect(p.onUpdateObjectState).not.toHaveBeenCalled();
  change(/^横（/, "6.2"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { x: -1.2, y: 1.25 });
});

/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SelectedPositionCard } from "./SelectedPositionCard";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "../utils/interpolation";

afterEach(cleanup);
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
  expect((input(/^横（/) as HTMLInputElement).value).toBe("-3");
  expect(screen.queryByRole("textbox")).toBeNull();
  change(/^横（/, "-1.13"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 3.87, y: 2 });
  change(/^縦（/, "99"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 2, y: 8 });
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
  change(/^横（/, "99"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { x: 9 });
  change(/^縦（/, "99"); expect(p.onUpdateObjectState).toHaveBeenLastCalledWith("o_chair", { y: 7 });
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
  change(/^横（/, "-1.13"); expect(p.onMoveMember).toHaveBeenLastCalledWith("m_anna", { x: 3.87, y: 2 });
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

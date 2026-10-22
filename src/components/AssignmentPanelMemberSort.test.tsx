/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormationFrame, Member, MemberGroup } from "../types";
import { formationExportFixture } from "../utils/formationExportFixture";
import { AssignmentPanel } from "./AssignmentPanel";
import { StaticStagePreview } from "./StaticStagePreview";

afterEach(cleanup);

const members: Member[] = [
  { id: "a", name: "あい", color: "#000000" },
  { id: "b", name: "かい", color: "#000000" },
  { id: "c", name: "さい", color: "#000000" },
  { id: "d", name: "たい", color: "#000000" },
];
// Group order: 後組 (た, あ) first, then 前組 (か); さ has no group and goes last.
const memberGroups: MemberGroup[] = [
  { id: "g2", name: "後組", memberIds: ["d", "a"], color: "#111111" },
  { id: "g1", name: "前組", memberIds: ["b"], color: "#222222" },
];
const frame: FormationFrame = { id: "s1", label: "シーン1", timeSec: 0, positions: {}, objectStates: {}, memberVisibility: {} } as FormationFrame;

describe("assignment tab: member view sort", () => {
  it("offers グループ順 instead of 名前順 and orders like the member tab", async () => {
    render(<AssignmentPanel memberGroups={memberGroups} frames={[frame]} members={members} objects={[]} objectGroups={[]}
      currentFrame={frame} previousFrame={null} objectStates={{}} previousObjectStates={{}}
      onAssignMembers={vi.fn()} onApplyPreviousAssignments={vi.fn()} onRemoveAssignment={vi.fn()} onSelectFrame={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "メンバー別" }));
    const select = screen.getByRole("combobox", { name: "並び替え" }) as HTMLSelectElement;
    const options = [...select.options].map((option) => option.textContent);
    expect(options).toContain("グループ順");
    expect(options).not.toContain("名前順");
    await userEvent.selectOptions(select, "group");
    const list = screen.getByRole("region", { name: "メンバー別割当" });
    const names = within(list).getAllByRole("article").map((card) => card.querySelector("strong")?.textContent);
    expect(names).toEqual(["たい", "あい", "かい", "さい"]);
  });
});

describe("read-only preview without names", () => {
  it("omits member and prop names only when asked", () => {
    const project = formationExportFixture();
    const range = { left: 0, right: project.stage.widthMeters, top: 0, bottom: project.stage.depthMeters };
    const props = { project, frame: project.frames[0], stageWidth: project.stage.widthMeters, range, outputWidth: 800 };
    const { container, rerender } = render(<StaticStagePreview {...props} />);
    expect(container.querySelectorAll(".print-member__label").length).toBeGreaterThan(0);
    expect([...container.querySelectorAll(".print-object")].some((object) => object.textContent)).toBe(true);
    rerender(<StaticStagePreview {...props} hideLabels />);
    expect(container.querySelectorAll(".print-member").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".print-member__label")).toHaveLength(0);
    expect([...container.querySelectorAll(".print-object")].every((object) => !object.textContent)).toBe(true);
  });
});

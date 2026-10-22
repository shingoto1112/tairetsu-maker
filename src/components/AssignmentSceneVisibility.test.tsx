/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Member } from "../types";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { isMemberShownInScene } from "../utils/assignmentCandidates";
import { MemberPicker } from "./MemberPicker";
import { MemberToggleList } from "./MemberToggleList";
import { ObjectAssignmentEditor } from "./ObjectAssignmentEditor";

afterEach(cleanup);

const members: Member[] = [
  { id: "shown1", name: "たいが", color: "#000000" },
  { id: "hidden1", name: "てつ", color: "#000000" },
  { id: "shown2", name: "すん", color: "#000000" },
  { id: "hidden2", name: "あっきー", color: "#000000" },
];
const groupIndex = buildMemberGroupIndex([]);
// Snapshot visibility of the scene: false = hidden in this scene.
const memberVisibility = { hidden1: false, hidden2: false } as Record<string, boolean>;
const isShown = (member: Member) => isMemberShownInScene(member, memberVisibility);

const candidateNames = () => within(screen.getByLabelText("メンバー候補"))
  .queryAllByRole("button").map((button) => button.querySelector("span")?.textContent);

const PickerHarness = () => {
  const [open, setOpen] = useState(true);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  return <MemberPicker members={members} groupIndex={groupIndex} selectedMemberId="" isOpen={open}
    onOpenChange={setOpen} onSelect={vi.fn()}
    sceneVisibility={{ isShown, hiddenOnly, onHiddenOnlyChange: setHiddenOnly }} />;
};

describe("scene-aware assignment candidates", () => {
  it("treats members hidden by the scene or by themselves as not shown", () => {
    expect(isMemberShownInScene({ id: "a" }, {})).toBe(true);
    expect(isMemberShownInScene({ id: "a" }, { a: false })).toBe(false);
    expect(isMemberShownInScene({ id: "a", visible: false }, {})).toBe(false);
  });

  it("starts with everyone in one list (shown members marked 表示中), and the filter narrows to hidden members", async () => {
    render(<PickerHarness />);
    const checkbox = screen.getByRole("checkbox", { name: "このシーンで非表示の人だけ" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    // No grouping by visibility: the chosen order (here the incoming group-less order) is kept.
    expect(candidateNames()).toEqual(["たいが", "てつ", "すん", "あっきー"]);
    expect(screen.getByRole("button", { name: /たいが .* 表示中/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^てつ / }).getAttribute("aria-label")).not.toContain("表示中");
    await userEvent.click(checkbox);
    expect(candidateNames()).toEqual(["てつ", "あっきー"]);
    await userEvent.click(checkbox);
    expect(candidateNames()).toEqual(["たいが", "てつ", "すん", "あっきー"]);
  });

  it("explains how to see shown members when nobody is hidden", () => {
    render(<MemberPicker members={members} groupIndex={groupIndex} selectedMemberId="" isOpen onOpenChange={vi.fn()}
      onSelect={vi.fn()} sceneVisibility={{ isShown: () => true, hiddenOnly: true, onHiddenOnlyChange: vi.fn() }} />);
    expect(screen.getByText(/このシーンで非表示の人はいません/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "メンバーを選択" }).hasAttribute("disabled")).toBe(false);
  });

  it("warns before assigning a member who is shown in the scene", async () => {
    const onAssignMembers = vi.fn(() => true);
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return <ObjectAssignmentEditor objectId="flag" members={members} assignedMemberIds={[]} groupIndex={groupIndex}
        isPickerOpen={open} onPickerOpenChange={setOpen} onAssignMembers={onAssignMembers} onRemoveAssignment={vi.fn()}
        sceneVisibility={{ isShown, hiddenOnly: false, onHiddenOnlyChange: vi.fn() }} sceneId="s1" />;
    };
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "人を選ぶ" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /たいが .* 表示中/ }));
    expect(screen.getByRole("status").textContent).toBe("たいがさんは表示中です。割り当てると、このシーンでは非表示になります。");
    await userEvent.click(screen.getByRole("button", { name: "割当（1人）" }));
    expect(onAssignMembers).toHaveBeenCalledWith("flag", ["shown1"]);
  });

  it("does not warn for members already hidden in the scene", async () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return <ObjectAssignmentEditor objectId="flag" members={members} assignedMemberIds={[]} groupIndex={groupIndex}
        isPickerOpen={open} onPickerOpenChange={setOpen} onAssignMembers={vi.fn(() => true)} onRemoveAssignment={vi.fn()}
        sceneVisibility={{ isShown, hiddenOnly: true, onHiddenOnlyChange: vi.fn() }} sceneId="s1" />;
    };
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "人を選ぶ" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /てつ/ }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("counts shown people across searches and keeps them selected through hidden-only filtering", async () => {
    const Harness = () => {
      const [open, setOpen] = useState(true);
      const [hiddenOnly, setHiddenOnly] = useState(false);
      return <ObjectAssignmentEditor objectId="flag" members={members} assignedMemberIds={[]} groupIndex={groupIndex}
        isPickerOpen={open} onPickerOpenChange={setOpen} onAssignMembers={vi.fn(() => true)} onRemoveAssignment={vi.fn()}
        sceneVisibility={{ isShown, hiddenOnly, onHiddenOnlyChange: setHiddenOnly }} sceneId="s1" />;
    };
    render(<Harness />);
    for (const name of [/^たいが /, /^すん /, /^てつ /]) await userEvent.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("status").textContent).toBe("選択した3人のうち2人は表示中です。割り当てると、このシーンでは非表示になります。");
    await userEvent.click(screen.getByRole("checkbox", { name: "このシーンで非表示の人だけ" }));
    expect(screen.queryByRole("checkbox", { name: /^たいが / })).toBeNull();
    expect(screen.getByRole("button", { name: "3人を選択中" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "割当（3人）" })).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox"), "あっきー");
    expect(screen.getByRole("button", { name: "3人を選択中" })).toBeTruthy();
  });

  it("roster list asks inline before assigning a shown member and toggles hidden members directly", async () => {
    const onToggle = vi.fn();
    const Harness = () => {
      const [hiddenOnly, setHiddenOnly] = useState(false);
      return <MemberToggleList members={members} groupIndex={groupIndex} assignedIds={new Set()} otherObjectsByMember={new Map()}
        onToggle={onToggle} sceneVisibility={{ isShown, hiddenOnly, onHiddenOnlyChange: setHiddenOnly }} resetKey="s1:flag" />;
    };
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /^てつ/ }));
    expect(onToggle).toHaveBeenCalledWith("hidden1");
    await userEvent.click(screen.getByRole("button", { name: /^たいが .* 表示中/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("たいがさんは表示中です。");
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^たいが .* 表示中/ }));
    await userEvent.click(screen.getByRole("button", { name: "割り当てる" }));
    expect(onToggle).toHaveBeenLastCalledWith("shown1");
  });
});

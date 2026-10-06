/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormationFrame, Member, MemberGroup, StageObject } from "../types";
import { AssignmentPanel } from "./AssignmentPanel";
import { MemberPanel } from "./MemberPanel";
import { ObjectPanel } from "./ObjectPanel";

const members: Member[] = [
  { id: "m1", name: "太郎", color: "#000000" },
  { id: "m2", name: "花子", color: "#000000" },
];
const memberGroups: MemberGroup[] = [
  { id: "g", name: "赤組", color: "#ef476f", memberIds: ["m1", "m2"] },
];
const objects: StageObject[] = ["o1", "o2"].map((id) => ({
  id, name: id === "o1" ? "旗" : "椅子", color: "#118ab2",
  type: "prop", shape: "rectangle", widthMeters: 1, heightMeters: 1,
  defaultX: 0, defaultY: 0, defaultRotation: 0, visible: true, locked: false, zIndex: 10,
}));
const frame: FormationFrame = {
  id: "f", label: "シーン1", timeSec: 0, positions: {}, objectStates: {},
  objectAssignments: { o1: ["m1"] },
};

const assignmentProps = (): ComponentProps<typeof AssignmentPanel> => ({
  members, memberGroups, objects, objectGroups: [], frames: [frame],
  currentFrame: frame, previousFrame: null, objectStates: {}, previousObjectStates: {},
  onOpenRosterManager: vi.fn(), onAssignMember: vi.fn().mockReturnValue(true),
  onApplyPreviousAssignments: vi.fn(), onRemoveAssignment: vi.fn(), onSelectFrame: vi.fn(),
});
const objectProps = (): ComponentProps<typeof ObjectPanel> => ({
  members, memberGroups, objects, objectGroups: [], objectStates: {},
  objectAssignments: frame.objectAssignments, selected: null,
  visibilityTab: "visible", scrollTarget: null, canPasteObject: false,
  onOpenRosterManager: vi.fn(), onVisibilityTabChange: vi.fn(), onSelect: vi.fn(),
  onUpdateObject: vi.fn(), onUpdateObjectState: vi.fn(), onDelete: vi.fn(),
  onNudgeZ: vi.fn(), onAddObject: vi.fn(),
  onCreateObjectGroup: vi.fn(), onUpdateObjectGroup: vi.fn(), onDeleteObjectGroup: vi.fn(),
  onAddObjectToGroup: vi.fn(), onChangeObjectGroup: vi.fn(), onSetAllObjectsFrameVisibility: vi.fn(),
  onCopySelected: vi.fn(), onPasteObject: vi.fn(), onAssignMember: vi.fn().mockReturnValue(true),
  onRemoveAssignment: vi.fn(), onPlaceSelectedObject: vi.fn(),
});
const memberProps = (): ComponentProps<typeof MemberPanel> => ({
  members: [], groups: [],
  selected: null, selectedMemberIds: [],
  objectAssignmentLabelsByMemberId: {}, visibilityTab: "visible", scrollTarget: null,
  canPasteMember: false, onOpenRosterManager: vi.fn(), onVisibilityTabChange: vi.fn(),
  onSelect: vi.fn(), onToggleMemberSelection: vi.fn(), onUpdate: vi.fn(),
  onSetMembersGlobalVisibility: vi.fn(), onSetMemberFrameVisibility: vi.fn(),
  onSetAllMembersFrameVisibility: vi.fn(), onSetGroupFrameVisibility: vi.fn(),
  onDelete: vi.fn(), onAddMember: vi.fn(), onCreateGroup: vi.fn(), onUpdateGroup: vi.fn(),
  onDeleteGroup: vi.fn(), onAddMemberToGroup: vi.fn(), onSelectGroup: vi.fn(),
  onChangeMemberGroup: vi.fn(), onClearMemberObjectAssignments: vi.fn(),
  onRestoreMember: vi.fn(),
  onCopySelected: vi.fn(), onPasteMember: vi.fn(),
});

const objectCard = (name: string) => {
  const card = Array.from(document.querySelectorAll("article"))
    .find((article) => article.dataset.objectId === objects.find((object) => object.name === name)?.id ||
      article.querySelector(".list-card__row strong")?.textContent === name);
  expect(card).toBeTruthy();
  return card!;
};

describe("roster panel integration", () => {
  it("starts object assignment with all candidates and keeps the zIndex callback behind its Japanese label", async () => {
    const user = userEvent.setup(); const p = objectProps();
    render(<ObjectPanel {...p} objectAssignments={{}} memberVisibility={{ m1: true, m2: false }} />);
    await user.click(within(objectCard("旗")).getByRole("button", { name: "メンバーを選択" }));
    expect((screen.getByRole("checkbox", { name: /非表示の人だけ/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: /太郎 赤組/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /花子 赤組/ })).toBeTruthy();
    const order = within(objectCard("旗")).getByLabelText("重なり順（大きいほど手前）");
    fireEvent.change(order, { target: { value: "14" } });
    expect(p.onUpdateObjectState).toHaveBeenCalledWith("o1", { zIndex: 14 });
  });
  it.each(["members", "objects"] as const)("keeps icon group deletion accessible and disabled in read-only %s", async (panel) => {
    const user = userEvent.setup(); const remove = vi.fn();
    const view = panel === "members"
      ? render(<MemberPanel {...memberProps()} members={members} groups={memberGroups} onDeleteGroup={remove} />)
      : render(<ObjectPanel {...objectProps()} objectGroups={[{ id: "g", name: "赤組", objectIds: ["o1"] }]} onDeleteObjectGroup={remove} />);
    const button = screen.getByRole("button", { name: "グループ「赤組」を削除" });
    expect(button.textContent).toBe(""); expect(button.title).toBe("グループ「赤組」を削除");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await user.click(button); expect(remove).toHaveBeenCalledExactlyOnceWith("g"); remove.mockClear();
    if (panel === "members") view.rerender(<MemberPanel {...memberProps()} members={members} groups={memberGroups} canEditProject={false} onDeleteGroup={remove} />);
    else view.rerender(<ObjectPanel {...objectProps()} objectGroups={[{ id: "g", name: "赤組", objectIds: ["o1"] }]} canEditProject={false} onDeleteObjectGroup={remove} />);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button); expect(remove).not.toHaveBeenCalled();
  });
  it.each(["members", "objects"] as const)("places portrait management target beside group heading for %s", async (panel) => {
    const user = userEvent.setup();
    const props = panel === "members" ? memberProps() : objectProps();
    if (panel === "members") render(<MemberPanel {...memberProps()} onVisibilityTabChange={props.onVisibilityTabChange} portrait />);
    else render(<ObjectPanel {...objectProps()} onVisibilityTabChange={props.onVisibilityTabChange} portrait />);
    const target = screen.getByRole("group", { name: "管理欄の対象" });
    const heading = target.closest(".panel-section__header, .object-visibility-list__header")!;
    expect(heading.textContent).toContain("グループ一覧");
    expect(document.querySelector(".portrait-panel-header")?.contains(target)).toBe(false);
    await user.click(within(target).getByRole("button", { name: /^非表示$/ }));
    expect(props.onVisibilityTabChange).toHaveBeenCalledExactlyOnceWith("hidden");
  });
  it("counts portrait member details in one badge without changing the full state", () => {
    render(<MemberPanel {...memberProps()} portrait members={[{ ...members[0], visible: false }]}
      currentFrame={{ ...frame, memberAppearanceOverrides: { m1: { color: "#fff" } } }}
      objectAssignmentLabelsByMemberId={{ m1: ["旗", "椅子"] }} />);
    expect(document.querySelector(".scene-visibility-chip__badge")?.textContent).toBe("＋4");
    expect(document.querySelector(".scene-visibility-chip .sr-only")?.textContent).toContain("割当: 旗、椅子");
  });
  it.each([false, true])("separates selection/visibility for both panels; portrait=%s", async (portrait) => {
    const user = userEvent.setup();
    const member = { ...memberProps(), portrait, members, currentFrame: frame, objectAssignmentLabelsByMemberId: { m1: ["旗"] }, onRestoreMember: vi.fn() };
    const view = render(<MemberPanel {...member} />);
    const picker = screen.getByRole("region", { name: "このシーンの表示" });
    await user.click(within(picker).getByRole("button", { name: /^太郎/ }));
    expect(member.onSelect).toHaveBeenCalledExactlyOnceWith("m1"); expect(member.onRestoreMember).not.toHaveBeenCalled();
    vi.mocked(member.onSelect).mockClear();
    await user.click(within(picker).getByRole("checkbox", { name: "太郎をこのシーンに表示" }));
    expect(member.onRestoreMember).toHaveBeenCalledExactlyOnceWith("m1"); expect(member.onSelect).not.toHaveBeenCalled();
    expect(member.onClearMemberObjectAssignments).not.toHaveBeenCalled(); expect(member.onSetMemberFrameVisibility).not.toHaveBeenCalled();
    view.unmount();
    const object = { ...objectProps(), portrait }; render(<ObjectPanel {...object} />);
    const objectPicker = screen.getByRole("region", { name: "このシーンの表示" });
    await user.click(within(objectPicker).getByRole("button", { name: /^旗/ }));
    expect(object.onSelect).toHaveBeenCalledExactlyOnceWith("o1"); expect(object.onUpdateObjectState).not.toHaveBeenCalled();
    vi.mocked(object.onSelect).mockClear();
    await user.click(within(objectPicker).getByRole("checkbox", { name: "旗をこのシーンに表示" }));
    expect(object.onUpdateObjectState).toHaveBeenCalledExactlyOnceWith("o1", { visible: false }); expect(object.onSelect).not.toHaveBeenCalled();
    expect(object.onRemoveAssignment).not.toHaveBeenCalled();
  });

  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it.each(["members", "objects"] as const)("keeps only the tabs and add target sticky, after the visibility picker for %s", async (panel) => {
    const user = userEvent.setup();
    if (panel === "members") render(<MemberPanel {...memberProps()} />);
    else render(<ObjectPanel {...objectProps()} />);
    const tabs = screen.getByRole("tablist", { name: "表示状態" });
    const header = tabs.closest(".panel-sticky-header");
    expect(header?.querySelector("h2")).toBeNull();
    expect(document.querySelectorAll(".panel-sticky-header")).toHaveLength(1);
    const picker = screen.getByRole("region", { name: "このシーンの表示" });
    expect(picker.compareDocumentPosition(header!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header?.textContent).toContain("追加先: このシーンに表示");
    expect(document.querySelector(".panel-manager-header h2")?.textContent).toBe(panel === "members" ? "メンバー" : "道具");
    expect(within(header as HTMLElement).getAllByRole("button").map((button) => button.textContent)).toEqual([
      panel === "members" ? "表示 0" : "表示 2", "非表示 0",
    ]);
    expect(screen.getByText("このシーンの表示")).toBeTruthy();
    expect(screen.getByText("グループ一覧")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "グループ作成" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "＋グループ" }));
    const submit = screen.getByRole("button", { name: "グループ作成" });
    const form = submit.closest(".panel-group-form")!;
    expect(form.querySelector("input")!.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(submit);
    expect(panel === "members" ? true : screen.getByText("整列・配置")).toBeTruthy();
    for (const name of [/幕/, /マーク/, /推し/, /自分用確認/, /注目/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("keeps object type changes limited to type without overwriting shape or dimensions", async () => {
    const user = userEvent.setup();
    const props = objectProps();
    render(<ObjectPanel {...props} />);
    const card = objectCard("旗");
    const select = within(card).getAllByRole("combobox").find((element) =>
      element.closest("label")?.textContent?.startsWith("種類"));
    expect(select).toBeTruthy();
    await user.selectOptions(select!, "curtain");
    expect(props.onUpdateObject).toHaveBeenCalledExactlyOnceWith("o1", { type: "curtain" });
    expect(props.onUpdateObjectState).not.toHaveBeenCalled();
  });

  it.each(["members", "objects", "assignments"] as const)("opens the roster from %s independently of project edit permission", async (panel) => {
    const user = userEvent.setup();
    const onOpenRosterManager = vi.fn();
    if (panel === "members") render(<MemberPanel {...memberProps()} canEditProject={false} onOpenRosterManager={onOpenRosterManager} />);
    if (panel === "objects") render(<ObjectPanel {...objectProps()} canEditProject={false} onOpenRosterManager={onOpenRosterManager} />);
    if (panel === "assignments") render(<AssignmentPanel {...assignmentProps()} canEditScene={false} onOpenRosterManager={onOpenRosterManager} />);
    const button = screen.getByRole("button", { name: "全体名簿を開く" });
    expect(button.title).toBe("全体名簿を開く");
    await user.click(button);
    expect(onOpenRosterManager).toHaveBeenCalledTimes(1);
  });

  it.each(["members", "objects", "assignments"] as const)("disables the roster button for a non-owner in %s", async (panel) => {
    const user = userEvent.setup();
    const onOpenRosterManager = vi.fn();
    const access = { canOpenRosterManager: false, onOpenRosterManager };
    if (panel === "members") render(<MemberPanel {...memberProps()} {...access} />);
    if (panel === "objects") render(<ObjectPanel {...objectProps()} {...access} />);
    if (panel === "assignments") render(<AssignmentPanel {...assignmentProps()} {...access} />);
    const button = screen.getByRole("button", { name: "全体名簿を開く" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("名簿の編集はownerのみ可能です。");
    await user.click(button);
    expect(onOpenRosterManager).not.toHaveBeenCalled();
  });

  it.each(["objects", "assignments"] as const)("selects a candidate without assigning until confirmation in %s", async (panel) => {
    const user = userEvent.setup();
    const props = panel === "objects" ? objectProps() : assignmentProps();
    if (panel === "objects") render(<ObjectPanel {...objectProps()} onAssignMember={props.onAssignMember} />);
    else render(<AssignmentPanel {...assignmentProps()} onAssignMember={props.onAssignMember} />);
    await user.click(within(objectCard("旗")).getByRole("button", { name: "メンバーを選択" }));
    expect(screen.queryByRole("button", { name: "太郎 赤組" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "花子 赤組" }));
    expect(props.onAssignMember).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("メンバー候補")).toBeNull();
    const selectedTrigger = screen.getByRole("button", { name: "花子" });
    const card = selectedTrigger.closest("article");
    expect(card).toBeTruthy();
    await user.click(within(card!).getByRole("button", { name: "割当" }));
    expect(props.onAssignMember).toHaveBeenCalledExactlyOnceWith("o1", "m2");
    expect(screen.getAllByRole("button", { name: "メンバーを選択" })).toHaveLength(2);
  });

  it.each(["objects", "assignments"] as const)("opens only one picker and allows a member already assigned to another object in %s", async (panel) => {
    const user = userEvent.setup();
    if (panel === "objects") render(<ObjectPanel {...objectProps()} />);
    else render(<AssignmentPanel {...assignmentProps()} />);
    const triggers = ["旗", "椅子"].map((name) =>
      within(objectCard(name)).getByRole("button", { name: "メンバーを選択" }));
    await user.click(triggers[0]);
    await user.click(triggers[1]);
    expect(screen.getAllByLabelText("メンバー候補")).toHaveLength(1);
    expect(triggers[0].getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "太郎 赤組" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "太郎 の割当を解除" }).parentElement?.querySelector<HTMLElement>(".assignment-chip__dot")?.style.backgroundColor).toBe("rgb(239, 71, 111)");
  });

  it.each(["objects", "assignments"] as const)("preserves read-only disabling and explanation in %s", (panel) => {
    const access = { canEditScene: false, sceneReadOnlyMessage: "シーンは閲覧のみ" };
    if (panel === "objects") render(<ObjectPanel {...objectProps()} {...access} />);
    else render(<AssignmentPanel {...assignmentProps()} {...access} />);
    const buttons = [
      ...screen.getAllByRole("button", { name: "メンバーを選択" }),
      ...screen.getAllByRole("button", { name: "割当" }),
    ];
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.title).toBe("シーンは閲覧のみ");
    }
  });
});

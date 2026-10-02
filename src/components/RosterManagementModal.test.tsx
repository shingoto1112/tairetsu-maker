/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RosterManagementModal } from "./RosterManagementModal";

vi.mock("./DocumentExportSheet", () => ({
  DocumentExportSheet: ({ initialTarget, getSource }: { initialTarget: string; getSource: () => { members: { name: string }[] } }) => {
    const [name, setName] = useState("");
    return <div data-testid="export-probe">{initialTarget} {name}<button onClick={() => setName(getSource().members[0]?.name ?? "")}>snapshot probe</button></div>;
  },
}));

const createProps = (): ComponentProps<typeof RosterManagementModal> => ({
  isOpen: true,
  projectTitle: "演目",
  onNotice: vi.fn(),
  frames: [],
  currentFrame: null,
  objectStates: {},
  previousFrame: null,
  previousObjectStates: {},
  canEditAssignments: true,
  readOnlyMessage: "共同編集中の割当は隊列表の「割当」タブで行ってください。",
  onAssignMember: vi.fn().mockReturnValue(true),
  onRemoveAssignment: vi.fn(),
  onApplyPreviousAssignments: vi.fn(),
  onSelectFrame: vi.fn(),
  members: [],
  objects: [],
  memberGroups: [{ id: "g", name: "赤組", color: "#ef476f", memberIds: [] }],
  objectGroups: [{ id: "o", name: "旗", color: "#118ab2", objectIds: [] }],
  onClose: vi.fn(),
  onRenameMember: vi.fn(),
  onRenameObject: vi.fn(),
  onAddMember: vi.fn(),
  onAddObject: vi.fn(),
  onQuickAddMember: vi.fn(),
  onQuickAddObject: vi.fn(),
  onCreateMemberGroup: vi.fn(),
  onCreateObjectGroup: vi.fn(),
  onRenameMemberGroup: vi.fn(),
  onRenameObjectGroup: vi.fn(),
  onDeleteMember: vi.fn(),
  onDeleteObject: vi.fn(),
  onDeleteMemberGroup: vi.fn(),
  onDeleteObjectGroup: vi.fn(),
  onUpdateMemberGroupColor: vi.fn(),
  onUpdateObjectGroupColor: vi.fn(),
});

describe("RosterManagementModal", () => {
  afterEach(() => cleanup());

  const member = { id: "m", name: "太郎", color: "#000" };
  const object = { id: "tool", name: "旗1", color: "#000", type: "prop", shape: "rectangle", widthMeters: 1, heightMeters: 1, defaultX: 0, defaultY: 0, defaultRotation: 0, visible: true, locked: false, zIndex: 1 } as const;

  it.each(["members", "objects"] as const)("confirms × deletion once and restores focus and drafts on cancellation in %s", async (mode) => {
    const user = userEvent.setup();
    const props = createProps();
    let resolve!: (confirmed: boolean) => void;
    const remove = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    render(<RosterManagementModal {...props} initialMode={mode} members={[member]} objects={[object]}
      onDeleteMember={remove} onDeleteObject={remove} />);
    const cell = screen.getByRole("textbox", { name: "未所属 1行目" }) as HTMLInputElement;
    cell.focus();
    fireEvent.change(cell, { target: { value: "下書き" } });
    const button = screen.getByRole("button", { name: `${mode === "members" ? member.name : object.name}を名簿から削除` });
    await user.click(button);
    fireEvent.blur(cell); // Opening App's confirmation must not commit the draft.
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(remove).toHaveBeenCalledExactlyOnceWith(mode === "members" ? member.id : object.id);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onRenameMember).not.toHaveBeenCalled();
    expect(props.onRenameObject).not.toHaveBeenCalled();
    await act(async () => resolve(false));
    expect(document.activeElement).toBe(cell);
    expect(cell.value).toBe("下書き");
    await user.click(button);
    expect(remove).toHaveBeenCalledTimes(2);
    await act(async () => resolve(true));
    expect(cell.value).not.toBe("下書き");
  });

  it.each(["members", "objects"] as const)("restores blank existing names and ignores blank additions in %s", (mode) => {
    const props = createProps();
    render(<RosterManagementModal {...props} initialMode={mode} members={[member]} objects={[object]} />);
    const cell = screen.getByRole("textbox", { name: "未所属 1行目" }) as HTMLInputElement;
    fireEvent.change(cell, { target: { value: "  " } });
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.blur(cell);
    expect(cell.value).toBe(mode === "members" ? member.name : object.name);
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith("名前は空欄にできません。削除は×から行えます。");
    expect(screen.getByRole("status").textContent).toBe("名前は空欄にできません。削除は×から行えます。");
    expect(props.onDeleteMember).not.toHaveBeenCalled();
    expect(props.onDeleteObject).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "未所属 2行目" }), { target: { value: "  " } });
    fireEvent.blur(screen.getByRole("textbox", { name: "未所属 2行目" }));
    expect(props.onAddMember).not.toHaveBeenCalled();
    expect(props.onAddObject).not.toHaveBeenCalled();
    expect(props.onNotice).toHaveBeenCalledTimes(1);
  });

  it.each(["members", "objects"] as const)("restores a blank group name and offers a separate group × in %s", async (mode) => {
    const user = userEvent.setup();
    const props = createProps();
    const remove = vi.fn().mockResolvedValue(false);
    render(<RosterManagementModal {...props} initialMode={mode}
      onDeleteMemberGroup={remove} onDeleteObjectGroup={remove} />);
    const label = mode === "members" ? "赤組" : "旗";
    const input = screen.getByRole("textbox", { name: `${label}のグループ名` }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe(label);
    expect(props.onNotice).toHaveBeenCalledWith("名前は空欄にできません。削除は×から行えます。");
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: `${label}のグループを削除` }));
    expect(remove).toHaveBeenCalledExactlyOnceWith(mode === "members" ? "g" : "o");
    expect(document.activeElement).toBe(input);
  });

  it("keeps drafts attached to item IDs when a preceding row is deleted", () => {
    const props = createProps();
    const second = { ...member, id: "second", name: "花子" };
    const { rerender } = render(<RosterManagementModal {...props} members={[member, second]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "未所属 2行目" }), { target: { value: "花子の下書き" } });
    rerender(<RosterManagementModal {...props} members={[second]} />);
    expect((screen.getByRole("textbox", { name: "未所属 1行目" }) as HTMLInputElement).value).toBe("花子の下書き");
    expect((screen.getByRole("textbox", { name: "未所属 2行目" }) as HTMLInputElement).value).toBe("");
    fireEvent.blur(screen.getByRole("textbox", { name: "未所属 1行目" }));
    expect(props.onRenameMember).toHaveBeenCalledExactlyOnceWith("second", "花子の下書き");
  });

  it("commits once after IME blur and composition-end and never on IME Enter", () => {
    const props = createProps();
    render(<RosterManagementModal {...props} members={[member]} />);
    const input = screen.getByRole("textbox", { name: "未所属 1行目" });
    input.focus();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "変更" } });
    fireEvent.keyDown(input, { key: "Enter" });
    input.blur();
    expect(props.onRenameMember).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    expect(props.onRenameMember).toHaveBeenCalledExactlyOnceWith("m", "変更");
    fireEvent.blur(input);
    expect(props.onRenameMember).toHaveBeenCalledTimes(1);
  });

  it("shows the name/assignment switch only for tools, defaults to names, and resets it on tab changes", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<RosterManagementModal {...props} />);
    expect(screen.queryByRole("group", { name: "道具管理の表示" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "道具管理" }));
    expect(screen.getByRole("button", { name: "名前の編集" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "道具割当" }));
    expect(await screen.findByLabelText("道具名簿の割当")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "メンバー管理" }));
    expect(screen.queryByLabelText("道具名簿の割当")).toBeNull();
    expect(screen.queryByRole("group", { name: "道具管理の表示" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "道具管理" }));
    expect(screen.getByRole("button", { name: "名前の編集" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens export with a frozen source after committing a cell and blocks IME", async () => {
    const props = createProps();
    const Harness = () => {
      const [members, setMembers] = useState([member]);
      return <RosterManagementModal {...props} members={members}
        onRenameMember={(id, name) => setMembers((items) => items.map((item) => item.id === id ? { ...item, name } : item))} />;
    };
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "未所属 1行目" });
    input.focus(); fireEvent.compositionStart(input);
    fireEvent.click(screen.getByRole("button", { name: "書き出し ▾" }));
    expect(props.onNotice).toHaveBeenCalledWith("入力を確定してから書き出してください。");
    expect(screen.queryByTestId("export-probe")).toBeNull();
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "確定後" } });
    fireEvent.click(screen.getByRole("button", { name: "書き出し ▾" }));
    const probe = await screen.findByTestId("export-probe");
    expect(probe.textContent).toContain("members");
    fireEvent.click(screen.getByRole("button", { name: "snapshot probe" }));
    expect(probe.textContent).toContain("確定後");
  });

  it.each(["members", "objects"] as const)("defaults export target to the current names screen in %s", async (mode) => {
    render(<RosterManagementModal {...createProps()} initialMode={mode} />);
    fireEvent.click(screen.getByRole("button", { name: "書き出し ▾" }));
    expect((await screen.findByTestId("export-probe")).textContent).toContain(mode);
  });

  it("uses assignments as export default and hides the roster summary", async () => {
    render(<RosterManagementModal {...createProps()} initialMode="objects" />);
    fireEvent.click(screen.getByRole("button", { name: "道具割当" }));
    await screen.findByLabelText("道具名簿の割当");
    expect(screen.queryByLabelText("名簿の人数")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "書き出し ▾" }));
    expect((await screen.findByTestId("export-probe")).textContent).toContain("assignments");
  });

  it("quick-adds members to a group or ungrouped while retaining button focus after rerender", async () => {
    const user = userEvent.setup();
    const props = createProps();
    const { rerender } = render(<RosterManagementModal {...props} />);
    const button = screen.getByRole("button", { name: "赤組にメンバーを追加" });
    await user.click(button);
    expect(props.onQuickAddMember).toHaveBeenCalledExactlyOnceWith("g");
    expect(props.onAddMember).not.toHaveBeenCalled();
    rerender(<RosterManagementModal {...props}
      members={[{ id: "m", name: "赤組1", color: "#ef476f" }]}
      memberGroups={[{ ...props.memberGroups[0], memberIds: ["m"] }]}
    />);
    expect(document.activeElement).toBe(button);
    await user.click(screen.getByRole("button", { name: "未所属にメンバーを追加" }));
    expect(props.onQuickAddMember).toHaveBeenLastCalledWith(null);
  });

  it("quick-adds objects using the requested initial mode", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<RosterManagementModal {...props} initialMode="objects" />);
    await user.click(screen.getByRole("button", { name: "旗に道具を追加" }));
    await user.click(screen.getByRole("button", { name: "未所属に道具を追加" }));
    expect(props.onQuickAddObject).toHaveBeenNthCalledWith(1, "o");
    expect(props.onQuickAddObject).toHaveBeenNthCalledWith(2, null);
    expect(props.onQuickAddMember).not.toHaveBeenCalled();
  });

  it("applies initialMode only when opening and preserves a user's tab choice on rerender", async () => {
    const user = userEvent.setup();
    const props = createProps();
    const { rerender } = render(<RosterManagementModal {...props} isOpen={false} initialMode="objects" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<RosterManagementModal {...props} initialMode="objects" />);
    expect(screen.getByRole("button", { name: "旗に道具を追加" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "メンバー管理" }));
    rerender(<RosterManagementModal {...props} initialMode="objects" allowedModes={["members", "objects"]} />);
    expect(screen.getByRole("button", { name: "赤組にメンバーを追加" })).toBeTruthy();
    rerender(<RosterManagementModal {...props} initialMode="members" />);
    await user.click(screen.getByRole("button", { name: "道具管理" }));
    rerender(<RosterManagementModal {...props} initialMode="objects" />);
    expect(screen.getByRole("button", { name: "旗に道具を追加" })).toBeTruthy();
    rerender(<RosterManagementModal {...props} isOpen={false} initialMode="members" />);
    rerender(<RosterManagementModal {...props} initialMode="members" />);
    expect(screen.getByRole("button", { name: "赤組にメンバーを追加" })).toBeTruthy();
  });

  it("corrects initialMode and subsequent allowedModes to the allowed tab", () => {
    const props = createProps();
    const { rerender } = render(<RosterManagementModal {...props} initialMode="objects" allowedModes={["members"]} />);
    expect(screen.getByRole("button", { name: "赤組にメンバーを追加" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "道具管理" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<RosterManagementModal {...props} initialMode="members" allowedModes={["objects"]} />);
    expect(screen.getByRole("button", { name: "旗に道具を追加" })).toBeTruthy();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])("ignores IME Enter in cells and group names (%j)", (ime) => {
    const props = createProps();
    render(<RosterManagementModal {...props} />);
    const cell = screen.getByRole("textbox", { name: "赤組 1行目" });
    cell.focus();
    fireEvent.change(cell, { target: { value: "変換中" } });
    fireEvent.keyDown(cell, { key: "Enter", ...ime });
    expect(props.onAddMember).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cell);
    const groupName = screen.getByRole("textbox", { name: "赤組のグループ名" });
    groupName.focus();
    fireEvent.change(groupName, { target: { value: "青組" } });
    fireEvent.keyDown(groupName, { key: "Enter", ...ime });
    expect(props.onRenameMemberGroup).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(groupName);
  });

  it("retains regular typed Enter addition", () => {
    const props = createProps();
    render(<RosterManagementModal {...props} />);
    const cell = screen.getByRole("textbox", { name: "未所属 1行目" });
    fireEvent.change(cell, { target: { value: " 手入力 " } });
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(props.onAddMember).toHaveBeenCalledExactlyOnceWith(null, "手入力");
  });

  it("sets group and ungrouped color variables on roster cells", () => {
    render(<RosterManagementModal {...createProps()} />);
    expect(screen.getByRole("textbox", { name: "赤組 1行目" }).style.getPropertyValue("--roster-group-color")).toBe("#ef476f");
    expect(screen.getByRole("textbox", { name: "未所属 1行目" }).style.getPropertyValue("--roster-group-color")).toBe("#94a3b8");
  });
});

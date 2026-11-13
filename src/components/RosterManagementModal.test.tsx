/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RosterManagementModal } from "./RosterManagementModal";

vi.mock("./DocumentExportSheet", () => ({
  DocumentExportSheet: ({ initialTarget, initialFormat, getSource }: { initialTarget: string; initialFormat?: string; getSource: () => { members: { name: string }[]; memberGroups: { name: string }[]; objects: { name: string }[]; objectGroups: { name: string }[] } }) => {
    const [name, setName] = useState("");
    return <div data-testid="export-probe">{initialTarget} {initialFormat} {name}<button onClick={() => { const source = getSource(); setName([...source.members, ...source.memberGroups, ...source.objects, ...source.objectGroups].map(item => item.name).join(" ")); }}>snapshot probe</button></div>;
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

const submitName = (input: HTMLElement) => {
  const form = input.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
};

describe("RosterManagementModal", () => {
  afterEach(() => cleanup());
  it("focuses the back button, cycles Tab and returns focus when closed", () => {
    const props = createProps();
    const { rerender } = render(<><button>名簿を開く</button><RosterManagementModal {...props} isOpen={false} /></>);
    const opener = screen.getByRole("button", { name: "名簿を開く" }); opener.focus();
    rerender(<><button>名簿を開く</button><RosterManagementModal {...props} /></>);
    const back = screen.getByRole("button", { name: "隊列表へ戻る" });
    expect(document.activeElement).toBe(back);
    const controls = screen.getByRole("dialog").querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    const last = controls[controls.length - 1];
    fireEvent.keyDown(back, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" }); expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: "Escape" }); expect(props.onClose).toHaveBeenCalledOnce();
    rerender(<><button>名簿を開く</button><RosterManagementModal {...props} isOpen={false} /></>);
    expect(document.activeElement).toBe(opener);
  });

  const member = { id: "m", name: "太郎", color: "#000" };
  const object = { id: "tool", name: "旗1", color: "#000", type: "prop", shape: "rectangle", widthMeters: 1, heightMeters: 1, defaultX: 0, defaultY: 0, defaultRotation: 0, visible: true, locked: false, zIndex: 1 } as const;

  it.each(["members", "objects"] as const)("A6: Escape commits name, addition and group drafts once before close in %s", mode => {
    const props = createProps();
    render(<RosterManagementModal {...props} initialMode={mode} members={[member]} objects={[object]} />);
    const cell = screen.getByRole("textbox", { name: "未所属 1行目" });
    const addition = screen.getByRole("textbox", { name: "未所属 2行目" });
    const group = screen.getByRole("textbox", { name: `${mode === "members" ? "赤組" : "旗"}のグループ名` });
    fireEvent.change(cell, { target: { value: "改名" } });
    fireEvent.change(addition, { target: { value: "追加" } });
    fireEvent.change(group, { target: { value: "新グループ" } });
    const rename = mode === "members" ? props.onRenameMember : props.onRenameObject;
    const add = mode === "members" ? props.onAddMember : props.onAddObject;
    const renameGroup = mode === "members" ? props.onRenameMemberGroup : props.onRenameObjectGroup;
    (props.onClose as ReturnType<typeof vi.fn>).mockImplementation(() => {
      expect(rename).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledOnce(); expect(renameGroup).toHaveBeenCalledOnce();
    });
    fireEvent.keyDown(cell, { key: "Escape", isComposing: true });
    fireEvent.keyDown(cell, { key: "Escape", keyCode: 229 });
    fireEvent.compositionStart(cell); fireEvent.keyDown(cell, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
    fireEvent.compositionEnd(cell);
    fireEvent.keyDown(cell, { key: "Escape" });
    fireEvent.blur(cell); fireEvent.blur(addition); fireEvent.blur(group);
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledExactlyOnceWith(mode === "members" ? "m" : "tool", "改名");
    expect(add).toHaveBeenCalledExactlyOnceWith(null, "追加");
    expect(renameGroup).toHaveBeenCalledExactlyOnceWith(mode === "members" ? "g" : "o", "新グループ");
  });

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
    submitName(cell);
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
    submitName(input);
    expect(input.value).toBe(label);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: `${label} 1行目` }));
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
    expect(screen.getByRole("button", { name: "道具の追加・編集" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "道具割当" }));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(await screen.findByLabelText("道具名簿の割当")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "メンバー管理" }));
    expect(screen.queryByLabelText("道具名簿の割当")).toBeNull();
    expect(screen.queryByRole("group", { name: "道具管理の表示" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "道具管理" }));
    expect(screen.getByRole("button", { name: "道具の追加・編集" }).getAttribute("aria-pressed")).toBe("true");
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
    fireEvent.click(screen.getByRole("menuitem", { name: "画像・PDF" }));
    const probe = await screen.findByTestId("export-probe");
    expect(probe.textContent).toContain("members");
    fireEvent.click(screen.getByRole("button", { name: "snapshot probe" }));
    expect(probe.textContent).toContain("確定後");
  });

  it("offers Excel and commits unfocused cell, new-row and group drafts from both tabs before snapshot", async () => {
    const props = createProps();
    const Harness = () => {
      const [members, setMembers] = useState([member]);
      const [groups, setGroups] = useState(props.memberGroups);
      const [objects, setObjects] = useState<ComponentProps<typeof RosterManagementModal>["objects"]>([object]);
      const [objectGroups, setObjectGroups] = useState(props.objectGroups);
      return <RosterManagementModal {...props} members={members} memberGroups={groups} objects={objects} objectGroups={objectGroups}
        onRenameMember={(id, name) => setMembers(items => items.map(item => item.id === id ? { ...item, name } : item))}
        onAddMember={(_groupId, name) => setMembers(items => [...items, { ...member, id: "new", name }])}
        onRenameMemberGroup={(id, name) => setGroups(items => items.map(item => item.id === id ? { ...item, name } : item))}
        onRenameObject={(id, name) => setObjects(items => items.map(item => item.id === id ? { ...item, name } : item))}
        onRenameObjectGroup={(id, name) => setObjectGroups(items => items.map(item => item.id === id ? { ...item, name } : item))} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "道具管理" }));
    fireEvent.change(screen.getByRole("textbox", { name: "未所属 1行目" }), { target: { value: "道具草稿" } });
    fireEvent.change(screen.getByRole("textbox", { name: "旗のグループ名" }), { target: { value: "道具組草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "メンバー管理" }));
    fireEvent.change(screen.getByRole("textbox", { name: "未所属 1行目" }), { target: { value: "名前草稿" } });
    fireEvent.change(screen.getByRole("textbox", { name: "未所属 2行目" }), { target: { value: "追加草稿" } });
    fireEvent.change(screen.getByRole("textbox", { name: "赤組のグループ名" }), { target: { value: "組草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "書き出し ▾" }));
    const excel = screen.getByRole("menuitem", { name: "Excel（.xlsx）" });
    fireEvent.compositionStart(screen.getByRole("textbox", { name: "未所属 1行目" }));
    fireEvent.click(excel); expect(screen.queryByTestId("export-probe")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.compositionEnd(screen.getByRole("textbox", { name: "未所属 1行目" }));
    fireEvent.click(screen.getByRole("button", { name: "書き出し ▾" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel（.xlsx）" }));
    const probe = await screen.findByTestId("export-probe");
    fireEvent.click(screen.getByRole("button", { name: "snapshot probe" }));
    expect(probe.textContent).toContain("xlsx");
    for (const name of ["名前草稿", "追加草稿", "組草稿", "道具草稿", "道具組草稿"]) expect(probe.textContent).toContain(name);
  });

  it("offers export only for members and keeps tool management and assignment screens", async () => {
    render(<RosterManagementModal {...createProps()} />);
    expect(screen.getByRole("button", { name: "書き出し ▾" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "道具管理" }));
    expect(screen.queryByRole("button", { name: "書き出し ▾" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "道具割当" }));
    await act(async () => { await vi.dynamicImportSettled(); });
    const view = await screen.findByLabelText("道具名簿の割当");
    const toolbar = screen.getByRole("group", { name: "道具割当の操作" });
    expect(toolbar.closest(".roster-manager-topbar")).not.toBeNull();
    expect(toolbar.closest('[role="dialog"]')).toBe(view.closest('[role="dialog"]'));
    expect(view.contains(toolbar)).toBe(false);
    expect(screen.queryByLabelText("名簿の人数")).toBeNull();
    expect(screen.queryByRole("button", { name: "書き出し ▾" })).toBeNull();
  });

  it("toggles the anchored menu, closes on outside taps and Escape, and closes when leaving the member tab", () => {
    const props = createProps();
    render(<RosterManagementModal {...props} />);
    const trigger = screen.getByRole("button", { name: "書き出し ▾" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.parentElement?.contains(screen.getByRole("menu"))).toBe(true);
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "書き出し ▾" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "赤組 1行目" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "画像・PDF" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "道具管理" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "メンバー管理" }));
    expect(screen.getByRole("button", { name: "書き出し ▾" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("supports arrows, Home/End, Tab and native keyboard selection", async () => {
    const user = userEvent.setup();
    render(<RosterManagementModal {...createProps()} />);
    const trigger = screen.getByRole("button", { name: "書き出し ▾" });
    trigger.focus(); await user.keyboard("{ArrowUp}");
    const image = screen.getByRole("menuitem", { name: "画像・PDF" });
    const excel = screen.getByRole("menuitem", { name: "Excel（.xlsx）" });
    expect(document.activeElement).toBe(excel);
    await user.keyboard("{ArrowDown}"); expect(document.activeElement).toBe(image);
    await user.keyboard("{ArrowUp}"); expect(document.activeElement).toBe(excel);
    await user.keyboard("{Home}"); expect(document.activeElement).toBe(image);
    await user.keyboard("{End}"); expect(document.activeElement).toBe(excel);
    await user.tab(); expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "メンバー管理" }));
    trigger.focus(); await user.keyboard("{ArrowDown}"); await user.tab({ shift: true });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "隊列表へ戻る" }));
    trigger.focus(); await user.keyboard("{ArrowDown}{Enter}");
    expect((await screen.findByTestId("export-probe")).textContent).toContain("png");
    expect(screen.queryByRole("menu")).toBeNull();
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

  // Enter keydown is left to the browser (iOS reports keyCode 229 even for the real return key);
  // navigation happens only on submit, and a submit that arrives mid-composition is ignored.
  it("ignores IME Enter keydown and any submit during composition in cells and group names", () => {
    const props = createProps();
    render(<RosterManagementModal {...props} />);
    const cell = screen.getByRole("textbox", { name: "赤組 1行目" });
    cell.focus();
    fireEvent.change(cell, { target: { value: "変換中" } });
    fireEvent.keyDown(cell, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.compositionStart(cell);
    submitName(cell);
    expect(props.onAddMember).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cell);
    fireEvent.compositionEnd(cell);
    const groupName = screen.getByRole("textbox", { name: "赤組のグループ名" });
    groupName.focus();
    fireEvent.change(groupName, { target: { value: "青組" } });
    fireEvent.keyDown(groupName, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.compositionStart(groupName);
    submitName(groupName);
    expect(props.onRenameMemberGroup).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(groupName);
    fireEvent.compositionEnd(groupName);
  });

  it("retains regular typed addition via submit", () => {
    const props = createProps();
    render(<RosterManagementModal {...props} />);
    const cell = screen.getByRole("textbox", { name: "未所属 1行目" });
    fireEvent.change(cell, { target: { value: " 手入力 " } });
    submitName(cell);
    expect(props.onAddMember).toHaveBeenCalledExactlyOnceWith(null, "手入力");
  });

  it.each(["members", "objects"] as const)("submits once to the next row and from the last row to addition synchronously in %s", mode => {
    const props = createProps();
    render(<RosterManagementModal {...props} initialMode={mode}
      members={[member, { ...member, id: "m2", name: "花子" }]}
      objects={[object, { ...object, id: "tool2", name: "旗2" }]} />);
    const first = screen.getByRole("textbox", { name: "未所属 1行目" });
    const second = screen.getByRole("textbox", { name: "未所属 2行目" });
    const addition = screen.getByRole("textbox", { name: "未所属 3行目" });
    first.focus();
    fireEvent.change(first, { target: { value: " 改名 " } });
    // keydown alone must not commit or navigate; native implicit submit is the entry point.
    fireEvent.keyDown(first, { key: "Enter" });
    expect(document.activeElement).toBe(first);
    const rename = mode === "members" ? props.onRenameMember : props.onRenameObject;
    expect(rename).not.toHaveBeenCalled();
    submitName(first);
    expect(document.activeElement).toBe(second);
    fireEvent.blur(first);
    expect(rename).toHaveBeenCalledExactlyOnceWith(mode === "members" ? "m" : "tool", "改名");
    submitName(second);
    expect(document.activeElement).toBe(addition);
    expect(rename).toHaveBeenCalledTimes(1);
    const forms = screen.getByRole("table").querySelectorAll("form");
    for (const form of forms) {
      expect(form.querySelectorAll("input")).toHaveLength(1);
      expect(form.querySelector("form")).toBeNull();
      expect(form.querySelector("input")?.getAttribute("enterkeyhint")).toBe("next");
    }
  });

  it.each(["members", "objects"] as const)("adds three names and focuses each newly mounted addition synchronously in %s", mode => {
    const props = createProps();
    const add = vi.fn();
    const Harness = () => {
      const [members, setMembers] = useState(props.members);
      const [objects, setObjects] = useState(props.objects);
      return <RosterManagementModal {...props} initialMode={mode} members={members} objects={objects}
        onAddMember={(groupId, name) => { add(groupId, name); setMembers(items => [...items, { ...member, id: `m${items.length}`, name }]); }}
        onAddObject={(groupId, name) => { add(groupId, name); setObjects(items => [...items, { ...object, id: `o${items.length}`, name }]); }} />;
    };
    render(<Harness />);
    for (let row = 1; row <= 3; row++) {
      const input = screen.getByRole("textbox", { name: `未所属 ${row}行目` });
      input.focus();
      fireEvent.change(input, { target: { value: ` 追加${row} ` } });
      submitName(input);
      const next = screen.getByRole("textbox", { name: `未所属 ${row + 1}行目` }) as HTMLInputElement;
      expect(document.activeElement).toBe(next);
      expect(next.value).toBe("");
      expect(input.isConnected).toBe(false);
      expect((screen.getByRole("textbox", { name: `未所属 ${row}行目` }) as HTMLInputElement).value).toBe(`追加${row}`);
      expect(add).toHaveBeenCalledTimes(row);
      expect(add).toHaveBeenLastCalledWith(null, `追加${row}`);
    }
  });

  it.each(["members", "objects"] as const)("keeps focus and adds nothing on an empty addition submit in %s", mode => {
    const props = createProps();
    render(<RosterManagementModal {...props} initialMode={mode} />);
    const input = screen.getByRole("textbox", { name: "未所属 1行目" }) as HTMLInputElement;
    input.focus();
    submitName(input);
    fireEvent.change(input, { target: { value: "  " } });
    submitName(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
    expect(props.onAddMember).not.toHaveBeenCalled();
    expect(props.onAddObject).not.toHaveBeenCalled();
  });

  it.each(["members", "objects"] as const)("commits group name once and focuses its first row synchronously in %s", mode => {
    const props = createProps();
    render(<RosterManagementModal {...props} initialMode={mode}
      members={[member]} memberGroups={[{ ...props.memberGroups[0], memberIds: [member.id] }]}
      objects={[object]} objectGroups={[{ ...props.objectGroups[0], objectIds: [object.id] }]} />);
    const label = mode === "members" ? "赤組" : "旗";
    const input = screen.getByRole("textbox", { name: `${label}のグループ名` });
    input.focus();
    fireEvent.change(input, { target: { value: " 新グループ " } });
    submitName(input);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: `${label} 1行目` }));
    fireEvent.blur(input);
    expect(mode === "members" ? props.onRenameMemberGroup : props.onRenameObjectGroup)
      .toHaveBeenCalledExactlyOnceWith(mode === "members" ? "g" : "o", "新グループ");
  });

  it("ignores submit while composing or deleting and for read-only object names", async () => {
    const props = createProps();
    let resolve!: (deleted: boolean) => void;
    const remove = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    const { rerender } = render(<RosterManagementModal {...props} members={[member]} onDeleteMember={remove} />);
    const input = screen.getByRole("textbox", { name: "未所属 1行目" });
    input.focus();
    fireEvent.change(input, { target: { value: "下書き" } });
    fireEvent.compositionStart(input);
    submitName(input);
    expect(document.activeElement).toBe(input);
    expect(props.onRenameMember).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.click(screen.getByRole("button", { name: "太郎を名簿から削除" }));
    submitName(input);
    expect(document.activeElement).toBe(input);
    expect(props.onRenameMember).not.toHaveBeenCalled();
    await act(async () => resolve(false));
    rerender(<RosterManagementModal {...props} initialMode="objects" allowedModes={["objects"]}
      objects={[object]} canEditObjects={false} onCommitObjectAppearance={() => null} />);
    const locked = screen.getByRole("textbox", { name: "未所属 1行目" }) as HTMLInputElement;
    expect(locked.disabled).toBe(true);
    fireEvent.change(locked, { target: { value: "不可" } });
    submitName(locked);
    expect(props.onRenameObject).not.toHaveBeenCalled();
  });

  it("sets group and ungrouped color variables on roster cells", () => {
    render(<RosterManagementModal {...createProps()} />);
    expect(screen.getByRole("textbox", { name: "赤組 1行目" }).style.getPropertyValue("--roster-group-color")).toBe("#ef476f");
    expect(screen.getByRole("textbox", { name: "未所属 1行目" }).style.getPropertyValue("--roster-group-color")).toBe("#94a3b8");
  });
});

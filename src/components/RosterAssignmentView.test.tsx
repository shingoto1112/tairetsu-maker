/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormationFrame, ObjectState, StageObject } from "../types";
import { RosterAssignmentView, type RosterAssignmentViewProps } from "./RosterAssignmentView";

const objects: StageObject[] = ["o1", "o2", "o3"].map((id, index) => ({
  id, name: ["旗", "椅子", "箱"][index], color: "#008800", type: "prop", shape: "rectangle",
  widthMeters: 1, heightMeters: 1, defaultX: 0, defaultY: 0, defaultRotation: 0, visible: true, locked: false, zIndex: 1,
}));
const state = (id: string, visible: boolean): ObjectState => ({ objectId: id, x: 0, y: 0, widthMeters: 1, heightMeters: 1, rotation: 0, zIndex: 1, visible });
const frame: FormationFrame = { id: "f1", label: "Scene 1", timeSec: 0, positions: {}, objectStates: {}, objectAssignments: { o1: ["a"], o2: ["a"] } };
const next: FormationFrame = { ...frame, id: "f2", label: "Scene 2", timeSec: 30 };
const createProps = (): RosterAssignmentViewProps => ({
  frames: [frame, next], currentFrame: frame, previousFrame: null, previousObjectStates: {},
  objectStates: { o3: state("o3", false) }, objects,
  objectGroups: [{ id: "g", name: "大道具", color: "#f00", objectIds: ["o2", "o1"] }],
  members: [{ id: "a", name: "担当", color: "#000" }, { id: "b", name: "候補", color: "#000" }],
  memberGroups: [], canEditAssignments: true, canUndo: true, onUndo: vi.fn(),
  readOnlyMessage: "共同編集中の割当は隊列表の「割当」タブで行ってください。",
  onAssignMember: vi.fn().mockReturnValue(true), onRemoveAssignment: vi.fn().mockReturnValue(true),
  onApplyPreviousAssignments: vi.fn().mockReturnValue(true), onSelectFrame: vi.fn(),
});
const selectObject = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}・`) }));
const detail = () => screen.getByLabelText("選択中の道具の割当");
const toggle = (name: string) => within(detail()).getByRole("button", { name: new RegExp(`^${name} 未所属`) });
const apply = () => fireEvent.click(screen.getByRole("button", { name: "前シーンの割当を反映" }));
const confirm = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "反映する" }));
const flush = async () => { await act(async () => {}); };

describe("RosterAssignmentView", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("lists visible tools once in group order with names and distinct totals", () => {
    render(<RosterAssignmentView {...createProps()} />);
    const list = screen.getByLabelText("道具グループ別一覧");
    expect(within(list).getAllByRole("button").map((row) => row.textContent)).toEqual(["椅子担当1人", "旗担当1人"]);
    expect(screen.getByRole("heading", { name: "大道具2個" }).style.borderLeftColor).toBe("rgb(255, 0, 0)");
    expect(screen.getByLabelText("割当の集計").textContent).toBe("表示中 2個・担当者なし 0個・担当者 1人");
    expect(screen.queryByRole("button", { name: /^箱・/ })).toBeNull();
  });
  it("shows two names and the overflow count after removing invalid and duplicate IDs", () => {
    const p = createProps();
    p.members = [...p.members, { id: "c", name: "三郎", color: "#000" }, { id: "d", name: "四郎", color: "#000" }];
    p.currentFrame = { ...frame, objectAssignments: { o1: ["a", "b", "c", "d", "a", "deleted"] } };
    render(<RosterAssignmentView {...p} />);
    const row = screen.getByRole("button", { name: "旗・4人" });
    expect(within(row).getByText("担当")).toBeTruthy(); expect(within(row).getByText("候補")).toBeTruthy();
    expect(within(row).getByText("ほか2人")).toBeTruthy();
    expect(screen.getByLabelText("割当の集計").textContent).toContain("担当者 4人");
  });
  it("chooses an unassigned visible tool first, retaining it after assignment under the filter", async () => {
    const p = createProps(); p.currentFrame = { ...frame, objectAssignments: { o2: ["a"] } };
    const { rerender } = render(<RosterAssignmentView {...p} />);
    expect(within(detail()).getByRole("heading", { name: "旗" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "道具の絞り込み" })).getByRole("button", { name: "担当者なし" }));
    fireEvent.click(toggle("候補")); await flush();
    expect(p.onAssignMember).toHaveBeenCalledExactlyOnceWith("o1", "b");
    rerender(<RosterAssignmentView {...p} currentFrame={{ ...p.currentFrame, objectAssignments: { o1: ["b"], o2: ["a"] } }} />);
    expect(screen.getByRole("button", { name: "旗・1人" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(detail()).getByRole("heading", { name: "旗" })).toBeTruthy();
  });
  it("expands hidden tools for browsing with readable assignees and no editing controls", () => {
    const p = createProps(); p.currentFrame = { ...frame, objectAssignments: { o3: ["a"] } };
    render(<RosterAssignmentView {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /このシーンで非表示の道具/ })); selectObject("箱");
    expect(within(detail()).getByText("担当")).toBeTruthy();
    expect(within(detail()).getByText(/隊列表の道具タブで表示にすると割当できます/)).toBeTruthy();
    expect(within(detail()).queryByLabelText("担当メンバー一覧")).toBeNull();
    expect(within(detail()).queryByRole("button", { name: /解除/ })).toBeNull();
    expect(p.onAssignMember).not.toHaveBeenCalled();
  });
  it("offers only one selected editor and members already assigned to other tools", () => {
    render(<RosterAssignmentView {...createProps()} />); selectObject("旗");
    expect(screen.getAllByLabelText("担当メンバー一覧")).toHaveLength(1);
    expect(toggle("担当").title).toBe("椅子も担当");
    expect(toggle("担当").getAttribute("aria-pressed")).toBe("true");
  });
  it.each(["chip", "row"])("removes via %s without restoring the member to formation", async (mode) => {
    const p = createProps(); render(<RosterAssignmentView {...p} />); selectObject("旗");
    fireEvent.click(mode === "chip" ? screen.getByRole("button", { name: "担当 の割当を解除" }) : toggle("担当"));
    await flush(); expect(p.onRemoveAssignment).toHaveBeenCalledExactlyOnceWith("o1", "a", false);
  });
  it("navigates in existing scene order, with time and disabled end buttons", () => {
    const p = createProps(); const { rerender } = render(<RosterAssignmentView {...p} />);
    expect((screen.getByRole("button", { name: "前のシーン" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("group", { name: "シーンの切り替え" }).textContent).toContain("1/2");
    fireEvent.click(screen.getByRole("button", { name: "次のシーン" })); expect(p.onSelectFrame).toHaveBeenLastCalledWith(next.id);
    rerender(<RosterAssignmentView {...p} currentFrame={next} />);
    expect((screen.getByRole("button", { name: "次のシーン" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "前のシーン" })); expect(p.onSelectFrame).toHaveBeenLastCalledWith(frame.id);
    expect(screen.getByRole("group", { name: "シーンの切り替え" }).textContent).toContain("2/2 Scene 2・0:30");
  });
  it("retains both searches across scenes and reselects an invalid selection", () => {
    const p = createProps(); const { rerender } = render(<RosterAssignmentView {...p} />); selectObject("旗");
    fireEvent.change(screen.getByRole("searchbox", { name: "道具名を検索" }), { target: { value: "旗" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "メンバー名を検索" }), { target: { value: "候補" } });
    rerender(<RosterAssignmentView {...p} currentFrame={next} objectStates={{ o1: state("o1", false), o3: state("o3", false) }} />);
    expect(within(detail()).getByRole("heading", { name: "椅子" })).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "道具名を検索" }) as HTMLInputElement).value).toBe("旗");
    expect((screen.getByRole("searchbox", { name: "メンバー名を検索" }) as HTMLInputElement).value).toBe("候補");
    rerender(<RosterAssignmentView {...p} objects={[]} />); expect(screen.getByText(/道具がありません/)).toBeTruthy();
  });
  it("keeps a valid selection when scenes change", () => {
    const p = createProps(); const { rerender } = render(<RosterAssignmentView {...p} />); selectObject("旗");
    rerender(<RosterAssignmentView {...p} currentFrame={next} />);
    expect(within(detail()).getByRole("heading", { name: "旗" })).toBeTruthy();
  });
  it("preserves member search through hidden-object browsing and an all-hidden scene", () => {
    const p = createProps(); const { rerender } = render(<RosterAssignmentView {...p} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "メンバー名を検索" }), { target: { value: "候補" } });
    fireEvent.click(screen.getByRole("button", { name: /このシーンで非表示の道具/ })); selectObject("箱");
    selectObject("旗");
    expect((screen.getByRole("searchbox", { name: "メンバー名を検索" }) as HTMLInputElement).value).toBe("候補");
    rerender(<RosterAssignmentView {...p} currentFrame={next} objectStates={Object.fromEntries(objects.map((object) => [object.id, state(object.id, false)]))} />);
    expect(screen.queryByRole("searchbox", { name: "メンバー名を検索" })).toBeNull();
    rerender(<RosterAssignmentView {...p} />);
    expect((screen.getByRole("searchbox", { name: "メンバー名を検索" }) as HTMLInputElement).value).toBe("候補");
  });
  it("does not retain an already assigned selection when initially filtering unassigned tools", () => {
    render(<RosterAssignmentView {...createProps()} />);
    fireEvent.click(within(screen.getByRole("group", { name: "道具の絞り込み" })).getByRole("button", { name: "担当者なし" }));
    expect(within(screen.getByLabelText("道具グループ別一覧")).queryAllByRole("button")).toHaveLength(0);
  });
  it("permits scene/object browsing and search but disables all mutations read-only", () => {
    const p = createProps(); render(<RosterAssignmentView {...p} canEditAssignments={false} previousFrame={{ ...next, objectAssignments: { o1: ["b"] } }} />);
    expect(screen.getByText(p.readOnlyMessage)).toBeTruthy(); selectObject("旗");
    for (const button of [toggle("担当"), toggle("候補"), screen.getByRole("button", { name: "担当 の割当を解除" }), screen.getByRole("button", { name: "前シーンの割当を反映" }), screen.getByRole("button", { name: "元に戻す" })]) {
      expect((button as HTMLButtonElement).disabled).toBe(true); fireEvent.click(button);
    }
    expect(p.onAssignMember).not.toHaveBeenCalled(); expect(p.onRemoveAssignment).not.toHaveBeenCalled(); expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled(); expect(p.onUndo).not.toHaveBeenCalled();
    // Scene browsing stays available while editing is read-only.
    expect((screen.getByRole("button", { name: "次のシーン" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("searchbox", { name: "道具名を検索" }), { target: { value: "旗" } });
    expect(screen.getByRole("button", { name: "旗・1人" })).toBeTruthy();
  });
  it.each(["no previous", "previous hidden", "current hidden", "invalid members", "empty previous", "equal sets"])("disables previous copying with %s", (reason) => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    if (reason === "no previous") p.previousFrame = null;
    if (reason === "previous hidden") p.previousObjectStates = { o1: state("o1", false) };
    if (reason === "current hidden") p.objectStates = { o1: state("o1", false) };
    if (reason === "invalid members") p.previousFrame = { ...next, objectAssignments: { o1: ["deleted"] } };
    if (reason === "empty previous") p.previousFrame = { ...next, objectAssignments: {} };
    if (reason === "equal sets") p.previousFrame = { ...next, objectAssignments: { o1: ["a", "a", "deleted"] } };
    render(<RosterAssignmentView {...p} />);
    expect((screen.getByRole("button", { name: "前シーンの割当を反映" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("confirms only changed tools with existing assignees, and permits cancellation", async () => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b", "b", "deleted"], o2: ["a"] } };
    render(<RosterAssignmentView {...p} />); apply();
    expect(screen.getByRole("dialog").textContent).toContain("1個の道具の担当が変わります");
    expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); await flush();
    expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled(); apply(); confirm(); await flush();
    expect(p.onApplyPreviousAssignments).toHaveBeenCalledOnce();
  });
  it("copies newly assigned tools without confirmation", async () => {
    const p = createProps(); p.currentFrame = { ...frame, objectAssignments: {} }; p.previousFrame = next;
    render(<RosterAssignmentView {...p} />); apply(); await flush();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(p.onApplyPreviousAssignments).toHaveBeenCalledOnce();
  });
  it("reevaluates changed data during confirmation and requests approval of the new set", async () => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    const { rerender } = render(<RosterAssignmentView {...p} />); apply();
    rerender(<RosterAssignmentView {...p} previousFrame={{ ...next, objectAssignments: { o1: ["b"], o2: ["b"] } }} />);
    confirm(); await flush(); expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain("2個の道具の担当が変わります");
    confirm(); await flush(); expect(p.onApplyPreviousAssignments).toHaveBeenCalledOnce();
  });
  it("cancels pending confirmation on a scene change", async () => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    const { rerender } = render(<RosterAssignmentView {...p} />); apply();
    rerender(<RosterAssignmentView {...p} currentFrame={next} />); await flush();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled();
  });
  it("honors edit permissions revoked while confirmation is open", async () => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    const { rerender } = render(<RosterAssignmentView {...p} />); apply();
    rerender(<RosterAssignmentView {...p} canEditAssignments={false} />); confirm(); await flush();
    expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled();
  });
  it("traps dialog focus, cancels with Escape, and restores focus without a mutation", async () => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    render(<RosterAssignmentView {...p} />); apply();
    const cancel = screen.getByRole("button", { name: "キャンセル" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "反映する" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" }); await flush();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "前シーンの割当を反映" }));
  });
  it("calls existing Undo and obeys Undo availability", async () => {
    const p = createProps(); const { rerender } = render(<RosterAssignmentView {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" })); await flush(); expect(p.onUndo).toHaveBeenCalledOnce();
    rerender(<RosterAssignmentView {...p} canUndo={false} />);
    expect((screen.getByRole("button", { name: "元に戻す" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("waits for a requested slot without an inline flash or moving focus", () => {
    const p = createProps();
    const { rerender, container } = render(<RosterAssignmentView {...p} toolbarSlot={null} />);
    const view = screen.getByLabelText("道具名簿の割当");
    expect(view.classList.contains("has-external-toolbar")).toBe(true);
    expect(screen.queryByLabelText("道具割当の操作")).toBeNull();
    const slot = document.createElement("div"); container.append(slot);
    const focused = document.activeElement;
    rerender(<RosterAssignmentView {...p} toolbarSlot={slot} />);
    expect(slot.contains(screen.getByLabelText("道具割当の操作"))).toBe(true);
    expect(within(view).queryByLabelText("道具割当の操作")).toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(screen.getAllByLabelText("割当の集計")).toHaveLength(1);
  });
  it.each(["escape", "cancel", "apply"])("traps both Tab directions and restores portaled focus after %s", async (action) => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    const slot = document.createElement("div");
    const { container } = render(<RosterAssignmentView {...p} toolbarSlot={slot} />);
    container.append(slot);
    const trigger = within(slot).getByRole("button", { name: "前シーンの割当を反映" });
    trigger.focus(); fireEvent.click(trigger);
    expect(slot.querySelector("header")?.getAttribute("aria-busy")).toBe("true");
    const cancel = screen.getByRole("button", { name: "キャンセル" });
    const accept = screen.getByRole("button", { name: "反映する" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(accept);
    fireEvent.keyDown(accept, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    if (action === "escape") fireEvent.keyDown(cancel, { key: "Escape" });
    else fireEvent.click(action === "apply" ? accept : cancel);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(p.onApplyPreviousAssignments).toHaveBeenCalledTimes(action === "apply" ? 1 : 0);
    expect(document.activeElement).toBe(trigger);
    expect(slot.querySelector("header")?.getAttribute("aria-busy")).toBe("false");
  });
  it("restores portaled focus to scene navigation or the view when apply becomes disabled", async () => {
    const p = createProps(); p.previousFrame = { ...next, objectAssignments: { o1: ["b"] } };
    const slot = document.createElement("div");
    const { container, rerender } = render(<RosterAssignmentView {...p} toolbarSlot={slot} />);
    container.append(slot); apply();
    rerender(<RosterAssignmentView {...p} toolbarSlot={slot} canEditAssignments={false} />);
    confirm(); await flush();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "次のシーン" }));
    rerender(<RosterAssignmentView {...p} toolbarSlot={slot} frames={[frame]} />);
    apply();
    rerender(<RosterAssignmentView {...p} toolbarSlot={slot} frames={[frame]} canEditAssignments={false} />);
    confirm(); await flush();
    expect(document.activeElement).toBe(screen.getByLabelText("道具名簿の割当"));
    expect(p.onApplyPreviousAssignments).not.toHaveBeenCalled();
  });
  it("renders one notice and one read-only message in the external toolbar", async () => {
    const p = createProps(); p.onUndo = vi.fn(() => { throw new Error("local test failure"); });
    const slot = document.createElement("div");
    const { container, rerender } = render(<RosterAssignmentView {...p} toolbarSlot={slot} />);
    container.append(slot);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" })); await flush();
    rerender(<RosterAssignmentView {...p} toolbarSlot={slot} canEditAssignments={false} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(within(slot).getByRole("status").textContent).toContain("変更できませんでした");
    expect(within(slot).getByText(p.readOnlyMessage)).toBeTruthy();
    expect(slot.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(within(screen.getByLabelText("道具名簿の割当")).queryByRole("status")).toBeNull();
  });
  it("uses measured width for list/detail navigation, restoring search and scroll", () => {
    let resize!: (width: number) => void;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = (width) => callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver); } observe() {} disconnect() {} });
    render(<RosterAssignmentView {...createProps()} />); act(() => resize(759));
    const list = screen.getByLabelText("道具グループ別一覧").parentElement!;
    expect(detail().hidden).toBe(true);
    fireEvent.change(screen.getByRole("searchbox", { name: "道具名を検索" }), { target: { value: "旗" } });
    list.scrollTop = 180; fireEvent.scroll(list); selectObject("旗");
    expect(list.hidden).toBe(true); expect(detail().hidden).toBe(false);
    list.scrollTop = 0;
    fireEvent.click(screen.getByRole("button", { name: "← 道具一覧" }));
    expect(list.hidden).toBe(false); expect(list.scrollTop).toBe(180);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "旗・1人" }));
    expect((screen.getByRole("searchbox", { name: "道具名を検索" }) as HTMLInputElement).value).toBe("旗");
    act(() => resize(760)); expect(detail().hidden).toBe(false);
  });
  it.each(["assign", "remove"])("blocks all duplicate mutations during pending %s", async (mode) => {
    const p = createProps(); let finish!: (value: boolean) => void;
    const callback = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    if (mode === "assign") p.onAssignMember = callback; else p.onRemoveAssignment = callback;
    render(<RosterAssignmentView {...p} />); selectObject("旗");
    const row = toggle(mode === "assign" ? "候補" : "担当"); fireEvent.click(row); fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "担当 の割当を解除" }));
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(callback).toHaveBeenCalledOnce(); expect(p.onUndo).not.toHaveBeenCalled();
    selectObject("椅子"); await act(async () => finish(true));
    expect(within(detail()).getByRole("heading", { name: "椅子" })).toBeTruthy();
  });
  it.each(["false", "throw"])("keeps search and scroll on %s and never shows success", async (reason) => {
    const p = createProps(); p.onAssignMember = reason === "false" ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error("failed"));
    render(<RosterAssignmentView {...p} />); selectObject("旗");
    fireEvent.change(screen.getByRole("searchbox", { name: "メンバー名を検索" }), { target: { value: "候補" } });
    const rows = screen.getByLabelText("担当メンバー一覧"); rows.scrollTop = 60;
    fireEvent.click(toggle("候補")); await flush();
    expect(screen.getByRole("status").textContent).toContain(reason === "false" ? "反映されませんでした" : "変更できませんでした");
    expect(toggle("候補").getAttribute("aria-pressed")).toBe("false"); expect(rows.scrollTop).toBe(60);
    expect((screen.getByRole("searchbox", { name: "メンバー名を検索" }) as HTMLInputElement).value).toBe("候補");
    expect(screen.queryByText(/割り当てました/)).toBeNull();
  });
  it("explains an all-hidden scene", () => {
    render(<RosterAssignmentView {...createProps()} objectStates={Object.fromEntries(objects.map((object) => [object.id, state(object.id, false)]))} />);
    expect(screen.getByText("このシーンで表示中の道具はありません。")).toBeTruthy();
    expect(screen.getByLabelText("割当の集計").textContent).toBe("表示中 0個・担当者なし 0個・担当者 0人");
  });
});

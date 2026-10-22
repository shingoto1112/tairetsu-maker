/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { ObjectAssignmentEditor } from "./ObjectAssignmentEditor";

const createProps = (): ComponentProps<typeof ObjectAssignmentEditor> => ({
  projectId: "p1", sceneId: "s1", objectId: "o",
  members: [{ id: "a", name: "担当", color: "#000" }, ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, name: `候補${i}`, color: "#000" }))],
  assignedMemberIds: ["a"], groupIndex: buildMemberGroupIndex([]),
  isPickerOpen: false, onPickerOpenChange: vi.fn(), onAssignMembers: vi.fn().mockReturnValue(true), onRemoveAssignment: vi.fn(),
});
const Harness = (props: ComponentProps<typeof ObjectAssignmentEditor>) => {
  const [open, setOpen] = useState(false);
  return <ObjectAssignmentEditor {...props} isPickerOpen={open} onPickerOpenChange={setOpen} />;
};
const select = (index = 0) => fireEvent.click(screen.getByRole("checkbox", { name: `候補${index} 未所属` }));
const open = () => fireEvent.click(screen.getByRole("button", { name: "人を選ぶ" }));

describe("ObjectAssignmentEditor", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);
  it("removes a chip without restoring the member to the formation", () => {
    const props = createProps(); render(<Harness {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "担当 の割当を解除" }));
    expect(props.onRemoveAssignment).toHaveBeenCalledExactlyOnceWith("o", "a", false);
  });
  it("checks five candidates without editing, then submits all five once", async () => {
    const props = createProps(); render(<Harness {...props} />); open();
    expect(screen.queryByRole("checkbox", { name: "担当 未所属" })).toBeNull();
    for (let i = 0; i < 5; i++) select(i);
    expect(props.onAssignMembers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "5人を選択中" })).toBeTruthy();
    expect(screen.getByRole("searchbox")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "割当（5人）" })));
    expect(props.onAssignMembers).toHaveBeenCalledExactlyOnceWith("o", ["b0", "b1", "b2", "b3", "b4"]);
    expect(screen.getByRole("button", { name: "人を選ぶ" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "割当（0人）" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("preserves selection and total across searches, ordering, close and Escape", () => {
    render(<Harness {...createProps()} />); open(); select();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "候補1" } }); select(1);
    fireEvent.click(screen.getByRole("button", { name: "名前順" }));
    expect(screen.getByRole("button", { name: "2人を選択中" })).toBeTruthy();
    expect(screen.getByText(/2人を選択中（検索/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "2人を選択中" }));
    expect((screen.getByRole("checkbox", { name: "候補0 未所属" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "候補1 未所属" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "2人を選択中" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "割当（2人）" })).toBeTruthy();
  });
  it.each(["false", "throw"])("keeps the draft and search on %s and permits retry", async (failure) => {
    const props = createProps();
    props.onAssignMembers = vi.fn().mockImplementationOnce(() => failure === "false" ? false : Promise.reject(new Error("failed"))).mockReturnValue(true);
    render(<Harness {...props} />); open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "候補0" } }); select();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "割当（1人）" })));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("候補0");
    expect((screen.getByRole("checkbox", { name: "候補0 未所属" }) as HTMLInputElement).checked).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "割当（1人）" })));
    expect(props.onAssignMembers).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("blocks duplicate pending requests and shows progress", async () => {
    const props = createProps(); let finish!: (applied: boolean) => void;
    props.onAssignMembers = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<Harness {...props} />); open(); select();
    const assign = screen.getByRole("button", { name: "割当（1人）" });
    fireEvent.click(assign); fireEvent.click(assign);
    expect(props.onAssignMembers).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "割当中…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(false));
    expect((screen.getByRole("button", { name: "割当（1人）" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each(["sceneId", "objectId", "projectId", "disabled"] as const)("discards drafts on %s change and ignores late completion", async (field) => {
    const props = createProps(); let finish!: (applied: boolean) => void;
    props.onAssignMembers = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = render(<Harness {...props} />); open(); select();
    fireEvent.click(screen.getByRole("button", { name: "割当（1人）" }));
    const next = { ...props, [field]: field === "disabled" ? true : "other" };
    rerender(<Harness {...next} />);
    expect(screen.getByRole("button", { name: "割当（0人）" })).toBeTruthy();
    if (field !== "disabled") select(1);
    await act(async () => finish(true));
    if (field !== "disabled") {
      expect(screen.getByRole("button", { name: "割当（1人）" })).toBeTruthy();
      expect((screen.getByRole("checkbox", { name: "候補1 未所属" }) as HTMLInputElement).checked).toBe(true);
    }
  });
  it("re-evaluates deleted members and newly assigned members", () => {
    const props = createProps(); const { rerender } = render(<Harness {...props} />); open(); select(); select(1); select(2);
    rerender(<Harness {...props} members={props.members.filter((m) => m.id !== "b0")} assignedMemberIds={["a", "b1"]} />);
    expect(screen.getByRole("button", { name: "1人を選択中" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "候補1 未所属" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "候補2 未所属" }) as HTMLInputElement).checked).toBe(true);
  });
  it("disables removal, picker and confirmation when read-only or playing", () => {
    const props = createProps(); render(<Harness {...props} disabled readOnlyMessage="閲覧のみ・再生中" />);
    for (const name of ["担当 の割当を解除", "人を選ぶ", "割当（0人）"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true); expect(button.title).toBe("閲覧のみ・再生中"); fireEvent.click(button);
    }
    expect(props.onAssignMembers).not.toHaveBeenCalled(); expect(props.onRemoveAssignment).not.toHaveBeenCalled();
  });
});

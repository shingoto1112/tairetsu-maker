/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { ObjectAssignmentEditor } from "./ObjectAssignmentEditor";
import { runSavedAssignmentUpdate } from "../utils/assignmentUpdate";

const createProps = (): ComponentProps<typeof ObjectAssignmentEditor> => ({
  objectId: "o", members: [{ id: "a", name: "担当", color: "#000" }, { id: "b", name: "候補", color: "#000" }],
  assignedMemberIds: ["a"], groupIndex: buildMemberGroupIndex([{ id: "g", name: "赤組", color: "#f00", memberIds: ["a", "b"] }]),
  isPickerOpen: false, onPickerOpenChange: vi.fn(), onAssignMember: vi.fn().mockReturnValue(true), onRemoveAssignment: vi.fn(),
});
const Harness = (props: ComponentProps<typeof ObjectAssignmentEditor>) => {
  const [open, setOpen] = useState(false);
  return <ObjectAssignmentEditor {...props} isPickerOpen={open} onPickerOpenChange={setOpen} />;
};
describe("ObjectAssignmentEditor", () => {
  it.each(["false", "throw"])("keeps the draft and search after cloud %s, including an optimistic assignment", async (failure) => {
    const props = createProps();
    props.onAssignMember = () => runSavedAssignmentUpdate(
      failure === "false" ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error("save failed")), () => true);
    const { rerender } = render(<Harness {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "メンバーを選択" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "候補" } });
    fireEvent.click(screen.getByRole("button", { name: "候補 赤組" }));
    fireEvent.click(screen.getByRole("button", { name: "候補" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "候補" } });
    fireEvent.click(screen.getByRole("button", { name: "割当" }));
    rerender(<Harness {...props} assignedMemberIds={["a", "b"]} />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "候補" })).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("候補");
    expect((screen.getByRole("button", { name: "割当" }) as HTMLButtonElement).disabled).toBe(false);
  });
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);
  it("removes a chip without restoring the member to the formation", () => {
    const props = createProps();
    render(<Harness {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "担当 の割当を解除" }));
    expect(props.onRemoveAssignment).toHaveBeenCalledExactlyOnceWith("o", "a", false);
    expect(screen.getByRole("button", { name: "担当 の割当を解除" }).parentElement?.querySelector<HTMLElement>(".assignment-chip__dot")?.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });
  it("selects a candidate and only assigns on confirmation, then clears the draft", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<Harness {...props} />);
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    expect(screen.queryByRole("button", { name: "担当 赤組" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "候補 赤組" }));
    expect(props.onAssignMember).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "割当" }));
    expect(props.onAssignMember).toHaveBeenCalledExactlyOnceWith("o", "b");
    expect(screen.getByRole("button", { name: "メンバーを選択" })).toBeTruthy();
  });
  it("preserves a rejected draft, blocks duplicate pending requests, and permits retry", async () => {
    const user = userEvent.setup();
    const props = createProps();
    let finish!: (applied: boolean) => void;
    props.onAssignMember = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; })).mockReturnValue(true);
    render(<Harness {...props} />);
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    await user.click(screen.getByRole("button", { name: "候補 赤組" }));
    const assign = screen.getByRole("button", { name: "割当" }) as HTMLButtonElement;
    fireEvent.click(assign);
    fireEvent.click(assign);
    expect(props.onAssignMember).toHaveBeenCalledTimes(1);
    expect(assign.disabled).toBe(true);
    await act(async () => finish(false));
    expect(screen.getByRole("button", { name: "候補" })).toBeTruthy();
    expect(assign.disabled).toBe(false);
    await user.click(assign);
    expect(props.onAssignMember).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "メンバーを選択" })).toBeTruthy();
  });
  it("disables removal, picker and assignment when read-only", async () => {
    const props = createProps();
    render(<Harness {...props} disabled readOnlyMessage="閲覧のみ" />);
    for (const name of ["担当 の割当を解除", "メンバーを選択", "割当"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe("閲覧のみ");
      fireEvent.click(button);
    }
    expect(props.onAssignMember).not.toHaveBeenCalled();
    expect(props.onRemoveAssignment).not.toHaveBeenCalled();
  });
});

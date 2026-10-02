/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { MEMBER_PICKER_ORDER_KEY } from "../hooks/useMemberPickerOrder";
import { MemberPicker } from "./MemberPicker";
import { MemberToggleList } from "./MemberToggleList";
import type { StageObject } from "../types";

const members = [
  { id: "a", name: "メンバー10", color: "#000" },
  { id: "b", name: "メンバー2", color: "#000" },
  { id: "c", name: "メンバー1", color: "#000" },
];
const groupIndex = buildMemberGroupIndex([{ id: "g", name: "赤組", memberIds: ["b", "a"], color: "#f00" }]);
const props = () => ({ members, groupIndex, assignedIds: new Set(["a"]),
  otherObjectsByMember: new Map([["a", [{ id: "flag", name: "旗" }, { id: "box", name: "箱" }] as StageObject[]]]), onToggle: vi.fn() });
const names = () => within(screen.getByLabelText("担当メンバー一覧")).getAllByRole("button").map((row) => row.querySelector(".member-toggle-list__name")?.firstChild?.textContent);
describe("MemberToggleList", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("toggles by tap and Space, exposing pressed state and neutral concurrent assignments", async () => {
    const p = props(); const user = userEvent.setup(); render(<MemberToggleList {...p} />);
    const row = screen.getByRole("button", { name: "メンバー10 赤組・旗、箱も担当" });
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(row.title).toBe("旗、箱も担当");
    expect(within(row).getByText("旗ほか1件も担当")).toBeTruthy();
    expect(screen.getByRole("button", { name: "メンバー2 赤組" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(row); await user.keyboard(" ");
    expect(p.onToggle.mock.calls).toEqual([["a"], ["a"]]);
  });
  it("uses headed group order and global numeric name order with membership labels", () => {
    render(<MemberToggleList {...props()} />);
    expect(names()).toEqual(["メンバー2", "メンバー10", "メンバー1"]);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["赤組", "未所属"]);
    fireEvent.click(screen.getByRole("button", { name: "名前順" }));
    expect(names()).toEqual(["メンバー1", "メンバー2", "メンバー10"]);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "メンバー2 赤組" }).querySelector("small")?.textContent).toBe("赤組");
  });
  it("filters without saving names or search text", () => {
    render(<MemberToggleList {...props()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "2" } });
    expect(names()).toEqual(["メンバー2"]); expect(localStorage.length).toBe(0);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不在" } });
    expect(screen.getByText("該当するメンバーはいません。")).toBeTruthy();
  });
  it("shares saved ordering with a simultaneously mounted MemberPicker in both directions", () => {
    render(<><MemberToggleList {...props()} /><MemberPicker members={members} groupIndex={groupIndex} selectedMemberId="" isOpen onOpenChange={vi.fn()} onSelect={vi.fn()} /></>);
    const orders = screen.getAllByRole("group", { name: "候補の並び順" });
    fireEvent.click(within(orders[0]).getByRole("button", { name: "名前順" }));
    expect(localStorage.getItem(MEMBER_PICKER_ORDER_KEY)).toBe("name");
    expect(within(orders[1]).getByRole("button", { name: "名前順" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(orders[1]).getByRole("button", { name: "グループ順" }));
    expect(names()).toEqual(["メンバー2", "メンバー10", "メンバー1"]);
  });
  it("restores saved name order", () => {
    localStorage.setItem(MEMBER_PICKER_ORDER_KEY, "name"); render(<MemberToggleList {...props()} />);
    expect(names()).toEqual(["メンバー1", "メンバー2", "メンバー10"]);
  });
  it("allows search and ordering while disabling edits", () => {
    const p = props(); render(<MemberToggleList {...p} disabled />);
    const row = screen.getByRole("button", { name: "メンバー2 赤組" }) as HTMLButtonElement;
    expect(row.disabled).toBe(true); fireEvent.click(row); expect(p.onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "名前順" })); expect(names()[0]).toBe("メンバー1");
  });
});

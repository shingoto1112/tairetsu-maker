/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Member } from "../types";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { MemberPicker } from "./MemberPicker";

const key = "tairetsu-maker:member-picker-order";
const members: Member[] = [
  { id: "u", name: "メンバー10", color: "#000000" },
  { id: "b", name: "メンバー2", color: "#000000" },
  { id: "a", name: "メンバー1", color: "#000000" },
];
const groupIndex = buildMemberGroupIndex([
  { id: "g", name: "赤組", color: "#ef476f", memberIds: ["b", "a"] },
]);

const renderPicker = (options: { members?: Member[]; disabled?: boolean } = {}) => {
  const onSelect = vi.fn();
  const Harness = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [selected, setSelected] = useState("");
    return <MemberPicker
      members={options.members ?? members}
      groupIndex={groupIndex}
      selectedMemberId={selected}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onSelect={(id) => { onSelect(id); setSelected(id); }}
      disabled={options.disabled}
      title={options.disabled ? "閲覧のみ" : undefined}
    />;
  };
  render(<Harness />);
  return onSelect;
};
const candidateNames = () => within(screen.getByLabelText("メンバー候補"))
  .getAllByRole("button").map((button) => button.querySelector("span")?.textContent);

describe("MemberPicker", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("expands inline, leaves focus on the trigger, and unmounts candidates on close", async () => {
    const user = userEvent.setup();
    renderPicker();
    const trigger = screen.getByRole("button", { name: "メンバーを選択" });
    expect(screen.queryByLabelText("メンバー候補")).toBeNull();
    await user.click(trigger);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(candidateNames()).toEqual(["メンバー2", "メンバー1", "メンバー10"]);
    expect(screen.getByText("2人")).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByLabelText("メンバー候補")).toBeNull();
  });

  it("offers two orders and stores only the enumeration value", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    await user.click(screen.getByRole("button", { name: "名前順" }));
    expect(candidateNames()).toEqual(["メンバー1", "メンバー2", "メンバー10"]);
    expect(screen.getByRole("button", { name: "名前順" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(key)).toBe("name");
    expect(within(screen.getByRole("group", { name: "候補の並び順" })).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "元の順" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "グループ順" }));
    expect(candidateNames()).toEqual(["メンバー2", "メンバー1", "メンバー10"]);
    expect(localStorage.length).toBe(1);
  });

  it("restores a valid saved order", async () => {
    localStorage.setItem(key, "name");
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    expect(candidateNames()).toEqual(["メンバー1", "メンバー2", "メンバー10"]);
  });

  it("filters by a name substring without persisting the search", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    await user.type(screen.getByRole("searchbox"), "2");
    expect(candidateNames()).toEqual(["メンバー2"]);
    expect(screen.getByText("1人")).toBeTruthy();
    expect(localStorage.length).toBe(0);
    await user.type(screen.getByRole("searchbox"), "見つからない");
    expect(screen.getByText("該当するメンバーはいません。")).toBeTruthy();
  });

  it("shows group color bands and labels, selects without assigning, and closes", async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker();
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    const candidate = screen.getByRole("button", { name: "メンバー2 赤組" });
    expect(candidate.style.boxShadow).toBe("inset 4px 0 0 #ef476f");
    expect(screen.getByRole("button", { name: "メンバー10 未所属" }).style.boxShadow).toBe("inset 4px 0 0 #94a3b8");
    expect(screen.queryByRole("button", { name: "割当" })).toBeNull();
    await user.click(candidate);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
    expect(screen.queryByLabelText("メンバー候補")).toBeNull();
    const trigger = screen.getByRole("button", { name: "メンバー2" });
    expect(trigger.style.borderColor).toBe("rgb(239, 71, 111)");
    expect(document.activeElement).toBe(trigger);
  });

  it.each(["unknown", "original"])("falls back to group order for saved %s", async (value) => {
    localStorage.setItem(key, value);
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    expect(candidateNames()).toEqual(["メンバー2", "メンバー1", "メンバー10"]);
  });

  it("handles storage read and write exceptions with in-memory selection", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "メンバーを選択" }));
    expect(candidateNames()).toEqual(["メンバー2", "メンバー1", "メンバー10"]);
    await user.click(screen.getByRole("button", { name: "名前順" }));
    expect(candidateNames()).toEqual(["メンバー1", "メンバー2", "メンバー10"]);
  });

  it("closes with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    renderPicker();
    const trigger = screen.getByRole("button", { name: "メンバーを選択" });
    await user.click(trigger);
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("メンバー候補")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("disables an empty or read-only picker", () => {
    renderPicker({ members: [] });
    expect((screen.getByRole("button", { name: "割当できるメンバーなし" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderPicker({ disabled: true });
    const trigger = screen.getByRole("button", { name: "メンバーを選択" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.title).toBe("閲覧のみ");
  });
});

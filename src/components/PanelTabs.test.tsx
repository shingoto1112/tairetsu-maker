/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelTabs, type PanelTabId } from "./PanelTabs";

const Harness = () => {
  const [tab, setTab] = useState<PanelTabId>("members");
  const [open, setOpen] = useState(true);
  return <PanelTabs activeTab={tab} isOpen={open} onChange={setTab} onToggleOpen={() => setOpen(!open)} onOpenRosterManager={() => {}}>
    <div className="panel-section"><div>{tab}</div></div>
  </PanelTabs>;
};
afterEach(cleanup);

describe("vertical editor tabs", () => {
  it("places the ordinary roster action immediately before the six-tab tablist", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "編集パネル" });
    const roster = screen.getByRole("button", { name: "全体名簿を開く" });
    expect(list.children).toHaveLength(6);
    expect(within(list).getAllByRole("tab")).toHaveLength(6);
    expect(list.previousElementSibling).toBe(roster);
    expect(roster.textContent).toBe("名簿");
    expect(roster.getAttribute("type")).toBe("button");
    expect(roster.getAttribute("aria-haspopup")).toBe("dialog");
    expect(roster.querySelector("svg")).not.toBeNull();
    for (const attribute of ["role", "aria-selected", "aria-pressed"]) expect(roster.hasAttribute(attribute)).toBe(false);
    expect(roster.classList.contains("is-active")).toBe(false);
  });

  // Access follows the roster entrance, independently of project/scene edit permissions in the content.
  it.each(["timeline", "members", "objects", "assignments", "audio", "stage"] as const)("uses the shared access prop and only opens the roster from %s", async activeTab => {
    const user = userEvent.setup();
    const onOpenRosterManager = vi.fn(), onChange = vi.fn(), onToggleOpen = vi.fn();
    const props = { activeTab, isOpen: false, onOpenRosterManager, onChange, onToggleOpen };
    const view = render(<PanelTabs {...props}><button disabled>編集不可</button></PanelTabs>);
    const button = screen.getByRole("button", { name: "全体名簿を開く" }) as HTMLButtonElement;
    expect(button.title).toBe("全体名簿を開く");
    await user.click(button);
    expect(onOpenRosterManager).toHaveBeenCalledExactlyOnceWith();
    expect(document.activeElement).toBe(button);
    expect(onChange).not.toHaveBeenCalled(); expect(onToggleOpen).not.toHaveBeenCalled();
    onOpenRosterManager.mockClear();
    view.rerender(<PanelTabs {...props} canOpenRosterManager={false}><button disabled>編集不可</button></PanelTabs>);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("名簿の編集はownerのみ可能です。");
    await user.click(button);
    expect(onOpenRosterManager).not.toHaveBeenCalled();
  });

  it.each(["{Enter}", " "])("opens the roster with %s without changing tabs or panel visibility", async key => {
    const user = userEvent.setup();
    const onOpenRosterManager = vi.fn(), onChange = vi.fn(), onToggleOpen = vi.fn();
    render(<PanelTabs activeTab="objects" isOpen onOpenRosterManager={onOpenRosterManager} onChange={onChange} onToggleOpen={onToggleOpen}>道具の編集</PanelTabs>);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "全体名簿を開く" }));
    await user.keyboard(key);
    expect(onOpenRosterManager).toHaveBeenCalledExactlyOnceWith();
    expect(onChange).not.toHaveBeenCalled(); expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it("saves and restores an independent scrollTop for each tab", () => {
    const { container } = render(<Harness />);
    const content = () => container.querySelector<HTMLElement>(".tab-panel__content")!;
    content().scrollTop = 240;
    content().scrollLeft = 99;
    fireEvent.scroll(content());
    fireEvent.click(screen.getByRole("tab", { name: "道具" }));
    expect(content().scrollTop).toBe(0);
    content().scrollTop = 80;
    fireEvent.scroll(content());
    fireEvent.click(screen.getByRole("tab", { name: "メンバー" }));
    expect(content().scrollTop).toBe(240);
    fireEvent.click(screen.getByRole("tab", { name: "道具" }));
    expect(content().scrollTop).toBe(80);
  });
  it("keeps the toggle outside the tablist and restores scroll after reopening", () => {
    const { container } = render(<Harness />);
    const content = container.querySelector<HTMLElement>(".tab-panel__content")!;
    content.scrollTop = 170;
    fireEvent.click(screen.getByRole("button", { name: "編集パネルを閉じる" }));
    // シーン・メンバー・道具・割当・音源・ステージ (詳細 and メモ were folded into other tabs).
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["シーン", "メンバー", "道具", "割当", "音源", "ステージ"]);
    expect(screen.queryByRole("tab", { name: "詳細" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "編集パネルを開く" });
    expect(screen.getByRole("tablist").contains(toggle)).toBe(false);
    expect(screen.getByRole("tab", { name: "メンバー" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(toggle);
    expect(container.querySelector<HTMLElement>(".tab-panel__content")!.scrollTop).toBe(170);
  });
  it("does not decorate cards or add horizontal scroll shadows", () => {
    const { container } = render(<Harness />);
    fireEvent.scroll(container.querySelector(".tab-panel__content")!);
    expect(container.querySelector(".is-current-portrait-card, .has-scroll-before, .has-scroll-after")).toBeNull();
  });
});

/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelTabs, type PanelTabId } from "./PanelTabs";

const Harness = () => {
  const [tab, setTab] = useState<PanelTabId>("members");
  const [open, setOpen] = useState(true);
  return <PanelTabs activeTab={tab} isOpen={open} onChange={setTab} onToggleOpen={() => setOpen(!open)}>
    <div className="panel-section"><div>{tab}</div></div>
  </PanelTabs>;
};
afterEach(cleanup);

describe("vertical editor tabs", () => {
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

/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneVisibilityPicker } from "./SceneVisibilityPicker";
import { createVisibilityMemory, type VisibilityItem } from "../utils/sceneVisibility";

const items: VisibilityItem[] = [
  { id: "a", name: "ＡＢＣえび", color: "#000", visible: false, selected: true, status: "全シーン非表示・割当: 旗＋1・色変更あり", fullStatus: "全シーン非表示・割当: 旗、椅子・色変更あり", detailCount: 4 },
  { id: "b", name: "他", color: "#000", visible: true, selected: false, status: "表示", fullStatus: "表示" },
];
const props = () => ({ title: "メンバー", portrait: true, items, groups: [{ id: "g", name: "1年", ids: ["a", "b"] }],
  visibilityTab: "visible" as const, onVisibilityTab: vi.fn(), onSelect: vi.fn(), onVisibility: vi.fn(), onAll: vi.fn() });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("scene visibility picker", () => {
  it("keeps orientation scroll memory independent and suspends portrait search in landscape", () => {
    const memory = createVisibilityMemory(); memory.scrollLeft = 120; memory.scrollTop = 75; memory.query = "えび";
    const callbacks = props();
    const view = render(<SceneVisibilityPicker {...callbacks} memory={memory} />);
    const owner = document.querySelector<HTMLElement>(".scene-visibility-picker__scroll")!;
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(owner.scrollLeft).toBe(120);
    view.rerender(<SceneVisibilityPicker {...callbacks} memory={memory} portrait={false} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(owner.scrollTop).toBe(75);
    owner.scrollTop = 140; fireEvent.scroll(owner);
    expect(memory.scrollTop).toBe(140); expect(memory.scrollLeft).toBe(120);
    fireEvent.click(screen.getByRole("button", { name: "すべて非表示" }));
    expect(callbacks.onAll).toHaveBeenCalledWith(false);
    view.rerender(<SceneVisibilityPicker {...callbacks} memory={memory} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(owner.scrollLeft).toBe(120);
  });
  it.each([false, true])("compacts status in portrait=%s, keeping complete descriptions", (portrait) => {
    render(<SceneVisibilityPicker {...props()} portrait={portrait} />);
    const chips = Array.from(document.querySelectorAll<HTMLElement>(".scene-visibility-chip"));
    expect(chips[0].querySelector(".scene-visibility-chip__text small")).toBeNull();
    expect(chips[0].querySelector(".scene-visibility-chip__badge")?.textContent).toBe("＋4");
    expect(chips[1].querySelector(".scene-visibility-chip__badge")).toBeNull();
    const name = within(chips[0]).getByRole("button", { name: items[0].name });
    expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toBe(items[0].fullStatus);
    expect(document.querySelector(".scene-visibility-picker__info")?.textContent).toContain(items[0].fullStatus);
  });
  it("keeps the unselected information to one short instruction and management controls outside the header", () => {
    render(<SceneVisibilityPicker {...props()} items={items.map(item => ({ ...item, selected: false }))} />);
    expect(document.querySelector(".scene-visibility-picker__info")?.textContent).toBe("☑で表示切替・名前タップで選択");
    expect(document.querySelector(".portrait-panel-header")?.textContent).not.toContain("管理欄の対象");
    expect(screen.getByRole("heading", { name: "メンバー 表示1／非表示1" })).toBeTruthy();
  });
  it.each([false, true])("separates check and name with the same DOM; portrait=%s", async (portrait) => {
    const user = userEvent.setup(); const callbacks = props();
    render(<SceneVisibilityPicker {...callbacks} portrait={portrait} />);
    const checkbox = screen.getByRole("checkbox", { name: "ＡＢＣえびをこのシーンに表示" });
    const name = screen.getByRole("button", { name: /ＡＢＣえび/ });
    expect(checkbox.closest("label")?.childElementCount).toBe(1);
    expect(name.getAttribute("aria-pressed")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe(checkbox.getAttribute("aria-describedby"));
    await user.click(name);
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith("a"); expect(callbacks.onVisibility).not.toHaveBeenCalled();
    callbacks.onSelect.mockClear();
    await user.click(checkbox);
    expect(callbacks.onVisibility).toHaveBeenCalledExactlyOnceWith("a", true); expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(Array.from(document.querySelectorAll('input[type="checkbox"], .scene-visibility-chip__name')).map((node) => node.tagName)).toEqual(["INPUT", "BUTTON", "INPUT", "BUTTON"]);
  });
  it("commits IME only at composition end, shows match counts/empty/selection guidance, restores horizontal position", () => {
    const callbacks = props(); const memory = createVisibilityMemory();
    const view = render(<SceneVisibilityPicker {...callbacks} memory={memory} />);
    const owner = document.querySelector<HTMLElement>(".scene-visibility-picker__scroll")!;
    owner.scrollLeft = 240; fireEvent.scroll(owner);
    const input = screen.getByRole("searchbox");
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: "bcエビ" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.compositionEnd(input, { data: "bcエビ" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(/1年 1／2人/)).toBeTruthy(); expect(owner.scrollLeft).toBe(0);
    fireEvent.change(input, { target: { value: "不存在" } });
    expect(screen.getByText("一致する名前がありません")).toBeTruthy();
    expect(screen.getByRole("button", { name: "選択対象を表示（検索解除）" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "クリア" }));
    expect(owner.scrollLeft).toBe(240);
    expect(callbacks.onSelect).not.toHaveBeenCalled(); expect(callbacks.onVisibility).not.toHaveBeenCalled();
    expect(document.querySelector(".scene-visibility-picker__info")?.textContent).toContain("旗、椅子");
    fireEvent.change(input, { target: { value: "えび" } }); view.unmount();
    render(<SceneVisibilityPicker {...callbacks} memory={memory} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("えび");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "すべて非表示" })); expect(callbacks.onAll).toHaveBeenCalledWith(false);
  });
  it("keeps searching and selection usable when scene edits are disabled", async () => {
    const callbacks = props(); const user = userEvent.setup();
    render(<SceneVisibilityPicker {...callbacks} disabled items={items.map((item) => ({ ...item, disabled: true }))} />);
    await user.type(screen.getByRole("searchbox"), "えび");
    await user.click(screen.getByRole("button", { name: /ＡＢＣえび/ }));
    expect(callbacks.onSelect).toHaveBeenCalledWith("a"); expect(callbacks.onVisibility).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
  it("reveals stage selection and keyboard focus horizontally, without replaying an old stage target on name selection", () => {
    const callbacks = props();
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      return this.dataset.visibilityId === "a" ? rect(400, 548) : rect(0, 300);
    });
    const view = render(<SceneVisibilityPicker {...callbacks} />);
    const owner = document.querySelector<HTMLElement>(".scene-visibility-picker__scroll")!;
    view.rerender(<SceneVisibilityPicker {...callbacks} scrollTarget={{ id: "a", token: 1 }} />);
    expect(owner.scrollLeft).toBe(248);
    owner.scrollLeft = 0;
    fireEvent.focus(screen.getByRole("button", { name: "ＡＢＣえび" })); expect(owner.scrollLeft).toBe(248);
    owner.scrollLeft = 90;
    const target = { id: "a", token: 2 };
    view.rerender(<SceneVisibilityPicker {...callbacks} scrollTarget={target} />);
    owner.scrollLeft = 90;
    view.rerender(<SceneVisibilityPicker {...callbacks} scrollTarget={target} items={items.map((item) => ({ ...item, selected: item.id === "b" }))} />);
    expect(owner.scrollLeft).toBe(90);
  });
  it("measures panel/header instead of population and anchors columns without moving the vertical owner", () => {
    let resize = () => {};
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) { return this.classList.contains("portrait-panel-header") ? 100 : 30; });
    const view = render(<div className="tab-panel__content"><SceneVisibilityPicker {...props()} /></div>);
    const owner = document.querySelector<HTMLElement>(".scene-visibility-picker__scroll")!;
    expect(owner.dataset.rows).toBe("6");
    const panel = document.querySelector<HTMLElement>(".tab-panel__content")!; panel.scrollTop = 90;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(220);
    act(() => resize()); expect(owner.dataset.rows).toBe("1"); expect(panel.scrollTop).toBe(90);
    expect(document.querySelector(".portrait-panel-header")?.classList.contains("is-low")).toBe(true);
    view.rerender(<div className="tab-panel__content"><SceneVisibilityPicker {...props()} items={[...items, ...Array.from({ length: 100 }, (_, i) => ({ ...items[1], id: `id${i}` }))]} /></div>);
    expect(owner.dataset.rows).toBe("1");
  });
  it.each([146, 300])("renders %s entries without virtualization and keeps every name selectable", (count) => {
    const data = Array.from({ length: count }, (_, i) => ({ ...items[1], id: `id${i}`, name: `名前${i}` }));
    const start = performance.now(); render(<SceneVisibilityPicker {...props()} items={data} />);
    const renderTime = performance.now() - start;
    expect(screen.getAllByRole("checkbox")).toHaveLength(count);
    expect(screen.getByRole("button", { name: `名前${count - 1}` })).toBeTruthy();
    console.info(`visibility ${count} render: ${renderTime.toFixed(1)}ms (jsdom)`);
  });
});

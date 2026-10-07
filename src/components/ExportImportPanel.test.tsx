/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotice } from "../hooks/useNotice";
import { ExportImportPanel } from "./ExportImportPanel";

const Harness = ({ warnings = [], initial = null }: { warnings?: string[]; initial?: string | null }) => {
  const { notification, setNotice, dismissNotice } = useNotice(initial);
  return <>
    <button onClick={() => setNotice("道具を追加しました。", "success")}>成功</button>
    <button onClick={() => setNotice("保存に失敗しました。")}>エラー</button>
    <button onClick={() => setNotice("編集ロックを取得してください。")}>条件</button>
    <button onClick={() => setNotice("保存しましたが、同期に失敗しました。")}>部分成功</button>
    <button onClick={() => setNotice("処理が終わりました。", "success")}>別の成功</button>
    <div className="stage-fullscreen-host">
      <div className="stage-fit-area" data-testid="export-dom" />
      <ExportImportPanel notice={notification} warnings={warnings} onDismissNotice={dismissNotice} />
    </div>
  </>;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("overlay notices", () => {
  it("announces a success outside the export DOM and clears it after three seconds", () => {
    render(<Harness />);
    const status = screen.getAllByRole("status")[0];
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByText("成功"));
    expect(status.textContent).toBe("道具を追加しました。");
    expect(screen.getByTestId("export-dom").contains(status)).toBe(false);
    act(() => vi.advanceTimersByTime(2999));
    expect(status.textContent).toBe("道具を追加しました。");
    act(() => vi.advanceTimersByTime(1));
    expect(status.textContent).toBe("");
    expect(screen.queryByLabelText("お知らせを閉じる")).toBeNull();
  });

  it.each(["エラー", "条件", "部分成功"])("keeps %s until its accessible close button is pressed", (label) => {
    render(<Harness />);
    fireEvent.click(screen.getByText(label));
    const message = screen.getAllByRole("status")[0].textContent;
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getAllByRole("status")[0].textContent).toBe(message);
    fireEvent.click(screen.getByRole("button", { name: "お知らせを閉じる" }));
    expect(screen.getAllByRole("status")[0].textContent).toBe("");
  });

  it("replaces duplicate notices, refreshes the announcement node and restarts the timer", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("成功"));
    const first = screen.getByText("道具を追加しました。");
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByText("成功"));
    expect(screen.getAllByText("道具を追加しました。")).toHaveLength(1);
    expect(screen.getByText("道具を追加しました。")).not.toBe(first);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("道具を追加しました。")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText("道具を追加しました。")).toBeNull();
  });

  it("cancels the previous success timer when replaced by a persistent notice or another success", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("成功"));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByText("エラー"));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText("保存に失敗しました。")).toBeTruthy();
    fireEvent.click(screen.getByText("成功"));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByText("別の成功"));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("処理が終わりました。")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText("処理が終わりました。")).toBeNull();
  });

  it("keeps initial errors and clears timers on unmount", () => {
    const view = render(<Harness initial="読み込めませんでした。" />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText("読み込めませんでした。")).toBeTruthy();
    fireEvent.click(screen.getByText("成功"));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps warnings collapsed with a count, expands a list, and retains them after a success expires", () => {
    render(<Harness warnings={["時刻が重複しています。", "範囲外です。"]} />);
    const toggle = screen.getByRole("button", { name: /警告2件/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("list").id).toBe(toggle.getAttribute("aria-controls"));
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByText("成功"));
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole("button", { name: /警告2件/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "お知らせを閉じる" }));
    expect(screen.queryByRole("button", { name: /警告2件/ })).toBeNull();
  });

  it("preserves dismissal for identical warnings and shows changed or recurring warnings collapsed", () => {
    const view = render(<Harness warnings={["範囲外です。"]} />);
    fireEvent.click(screen.getByRole("button", { name: "お知らせを閉じる" }));
    view.rerender(<Harness warnings={["範囲外です。"]} />);
    expect(screen.queryByRole("button", { name: /警告1件/ })).toBeNull();
    view.rerender(<Harness warnings={["時刻が重複しています。"]} />);
    expect(screen.getByRole("button", { name: /警告1件/ }).getAttribute("aria-expanded")).toBe("false");
    view.rerender(<Harness warnings={[]} />);
    view.rerender(<Harness warnings={["範囲外です。"]} />);
    expect(screen.getByRole("button", { name: /警告1件/ })).toBeTruthy();
  });

  it("keeps the close control's area when a native keyboard leaves an empty canvas", () => {
    vi.stubGlobal("visualViewport", Object.assign(new EventTarget(), { height: 460, offsetTop: 0 }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("stage-fit-area")
        ? { top: 253, bottom: 253, height: 0 } as DOMRect
        : { top: 187, bottom: 253, height: 66 } as DOMRect;
    });
    render(<Harness initial="閉じられるお知らせ" />);
    const overlay = screen.getByRole("region", { name: "お知らせ" });
    expect(overlay.style.getPropertyValue("--status-top")).toBe("0px");
    expect(overlay.style.getPropertyValue("--status-height")).toBe("66px");
    fireEvent.click(screen.getByRole("button", { name: "お知らせを閉じる" }));
    expect(screen.queryByText("閉じられるお知らせ")).toBeNull();
  });

  it("follows visual viewport keyboard resize and pan, then removes viewport listeners on unmount", () => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 600, offsetTop: 0 });
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains("stage-fit-area") ? 160 : 100;
      return { top, bottom: 700, height: 700 - top } as DOMRect;
    });
    const remove = vi.spyOn(viewport, "removeEventListener");
    const view = render(<Harness />);
    const overlay = screen.getByRole("region", { name: "お知らせ" });
    expect(overlay.style.getPropertyValue("--status-top")).toBe("60px");
    expect(overlay.style.getPropertyValue("--status-height")).toBe("440px");
    Object.assign(viewport, { height: 300, offsetTop: 220 });
    act(() => { viewport.dispatchEvent(new Event("resize")); });
    expect(overlay.style.getPropertyValue("--status-top")).toBe("120px");
    expect(overlay.style.getPropertyValue("--status-height")).toBe("300px");
    Object.assign(viewport, { offsetTop: 260 });
    act(() => { viewport.dispatchEvent(new Event("scroll")); });
    expect(overlay.style.getPropertyValue("--status-top")).toBe("160px");
    view.unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});

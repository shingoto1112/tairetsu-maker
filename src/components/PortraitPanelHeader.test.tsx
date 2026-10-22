// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PortraitPanelHeader } from "./PortraitPanelHeader";

afterEach(cleanup);

it.each(["メンバー", "道具"])("%s uses explicit visible/hidden counts, including three digits", title => {
  const props = { title, headerRef: createRef<HTMLDivElement>(), visibleCount: 6, hiddenCount: 0,
    query: "", onQuery: vi.fn(), onCompositionStart: vi.fn(), onCompositionEnd: vi.fn(),
    onAll: vi.fn(), low: false, actions: <button type="button">追加</button> };
  const view = render(<PortraitPanelHeader {...props} />);
  expect(screen.getByRole("heading", { name: `${title} 表示 6・非表示 0` })).toBeTruthy();
  view.rerender(<PortraitPanelHeader {...props} visibleCount={146} hiddenCount={12} />);
  const count = screen.getByText("表示 146・非表示 12");
  expect(count.tagName).toBe("SMALL");
  expect(screen.getByRole("heading", { name: `${title} 表示 146・非表示 12` }).contains(count)).toBe(true);
  expect(screen.getByRole("button", { name: "追加" }).closest("h2")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "検索" } });
  expect(props.onQuery).toHaveBeenCalledExactlyOnceWith("検索");
  fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
  fireEvent.click(screen.getByRole("button", { name: "すべて非表示" }));
  expect(props.onAll.mock.calls).toEqual([[true], [false]]);
});

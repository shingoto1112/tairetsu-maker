// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemberDiameterPicker } from "./MemberDiameterPicker";
import { applyMemberDiameterAction, type MemberDiameterAction } from "../utils/memberDiameter";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const plus = () => screen.getByRole<HTMLButtonElement>("button", { name: "丸の直径を0.05m大きくする" });
const minus = () => screen.getByRole<HTMLButtonElement>("button", { name: "丸の直径を0.05m小さくする" });
function setup(initial: number, disabled = false) {
  const changed = vi.fn();
  const Harness = () => {
    const [value, setValue] = useState(initial);
    return <MemberDiameterPicker value={value} disabled={disabled} onChange={action => {
      changed(action); setValue(current => applyMemberDiameterAction(current, action));
    }} />;
  };
  const view = render(<Harness />);
  return { changed, view };
}
it("selects presets, preserves two decimal display and skips the same selection", () => {
  const { changed } = setup(.75);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "0.75m" }).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "0.75m" }));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(plus()); expect(screen.getByText("今の値 0.80m")).toBeTruthy();
  expect(screen.getAllByRole<HTMLInputElement>("radio").every(input => !input.checked)).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "1.0m" }));
  expect(screen.getByText("今の値 1.00m")).toBeTruthy(); expect(plus().disabled).toBe(true);
  fireEvent.click(minus()); expect(screen.getByText("今の値 0.95m")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "0.5m" }));
  expect(minus().disabled).toBe(true); fireEvent.click(minus());
  expect(changed).toHaveBeenCalledTimes(4);
});
it.each([.3, .65])("retains %s on render, uses plus and preset only on explicit action", value => {
  const { changed } = setup(value);
  expect(screen.getByText(`今の値 ${value.toFixed(2)}m`)).toBeTruthy();
  expect(screen.getAllByRole<HTMLInputElement>("radio").every(input => !input.checked)).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  if (value === .3) {
    expect(screen.getByText(/0.5m未満は新しく選べません/)).toBeTruthy();
    expect(minus().disabled).toBe(true);
  }
  fireEvent.click(plus());
  expect(screen.getByText(`今の値 ${value === .3 ? "0.50" : "0.70"}m`)).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "0.75m" }));
  expect(screen.getByText("今の値 0.75m")).toBeTruthy();
});
it("receives new values without emitting updates and keeps the ruler scale fixed", () => {
  const onChange = vi.fn(); const view = render(<MemberDiameterPicker value={.3} onChange={onChange} />);
  const ruler = view.container.querySelector("svg path")!.getAttribute("d");
  view.rerender(<MemberDiameterPicker value={.65} onChange={onChange} />);
  expect(screen.getByText("今の値 0.65m")).toBeTruthy();
  expect(view.container.querySelector("circle")!.getAttribute("r")).toBe(String(.65 * 64 / 2));
  expect(view.container.querySelector("svg path")!.getAttribute("d")).toBe(ruler);
  expect(onChange).not.toHaveBeenCalled();
});
it.each([.3, .65])("chooses a preset directly from %s", value => {
  setup(value);
  fireEvent.click(screen.getByRole("radio", { name: "0.75m" }));
  expect(screen.getByText("今の値 0.75m")).toBeTruthy();
});
it("disables all interaction", async () => {
  const { changed } = setup(.65, true);
  for (const input of screen.getAllByRole("radio")) await userEvent.click(input);
  await userEvent.click(plus()); await userEvent.click(minus());
  expect(changed).not.toHaveBeenCalled();
});
it("keeps native keyboard radio navigation", async () => {
  vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`) });
  setup(.75);
  screen.getByRole("radio", { name: "0.75m" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "1.0m" }).checked).toBe(true);
});
it.each([NaN, Infinity, -.1, .3, 1.1])("rejects an invalid selected value %s", value => {
  expect(applyMemberDiameterAction(.65, { type: "select", value })).toBe(.65);
});
it("clamps steps and does not accumulate decimal errors", () => {
  let value = .5; const action: MemberDiameterAction = { type: "step", direction: 1 };
  for (let i = 0; i < 20; i++) value = applyMemberDiameterAction(value, action);
  expect(value).toBe(1);
  expect(applyMemberDiameterAction(.3, { type: "step", direction: -1 })).toBe(.3);
  expect(applyMemberDiameterAction(.65, { type: "step", direction: -1 })).toBe(.6);
});

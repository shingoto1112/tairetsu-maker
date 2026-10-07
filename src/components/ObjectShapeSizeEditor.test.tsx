/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { applyObjectAppearance } from "../project/objectAppearance";
import { ObjectShapeSizeEditor } from "./ObjectShapeSizeEditor";
import { ObjectShapeButtons } from "./ObjectShapeButtons";
import type { ComponentProps } from "react";

const props = (): ComponentProps<typeof ObjectShapeSizeEditor> => ({ project: createSampleProject(), objectId: "o_chair", canEdit: true,
  readOnlyMessage: "閲覧のみです", totalCount: 2, onCommit: vi.fn(() => null) });
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("専用の形・寸法編集欄", () => {
  it("legacy rectangle display remains pressable and converts only on explicit click", () => {
    const change = vi.fn();
    render(<ObjectShapeButtons shape="curtain" onChange={change} />);
    const rectangle = screen.getByRole("button", { name: "□ 四角形" });
    expect(rectangle.getAttribute("aria-pressed")).toBe("true");
    expect(change).not.toHaveBeenCalled(); fireEvent.click(rectangle); expect(change).toHaveBeenCalledWith("rectangle");
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
  it("shows grid spacing and precise measurements; numeric Enter, cancel, Escape and invalid draft", () => {
    const p = props(); render(<ObjectShapeSizeEditor {...p} />);
    expect(screen.getByText("1マス 0.5m")).toBeTruthy();
    expect(screen.getByText("椅子（未所属）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /幅 .*を入力/ }));
    const input = screen.getByRole("textbox", { name: "幅（m）" });
    fireEvent.change(input, { target: { value: "1.23" } }); fireEvent.submit(input.closest("form")!);
    expect(p.onCommit).toHaveBeenLastCalledWith("o_chair", { widthMeters: 1.23 });
    fireEvent.click(screen.getByRole("button", { name: /高さ .*を入力/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "0.001" } }); fireEvent.click(screen.getByRole("button", { name: "確定" }));
    expect(screen.getByRole("alert").textContent).toContain("小数2桁");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" }); expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /高さ .*を入力/ })); fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(p.onCommit).toHaveBeenCalledTimes(1);
  });
  it("step buttons preserve hundredths, commit once each, and do nothing at a limit", () => {
    let current = createSampleProject(); current.stageObjects[1].widthMeters = 1.23;
    current.frames.forEach(frame => { frame.objectStates.o_chair.widthMeters = 1.23; });
    const commit = vi.fn();
    function Harness() {
      const [project, setProject] = useState(current);
      return <ObjectShapeSizeEditor {...props()} project={project} onCommit={(id, patch) => {
        commit(patch); current = applyObjectAppearance(current, id, patch); setProject(current); return null;
      }} />;
    }
    render(<Harness />);
    const plus = screen.getByRole("button", { name: "幅を0.10m大きくする" }); fireEvent.click(plus); fireEvent.click(plus);
    expect(commit.mock.calls).toEqual([[{ widthMeters: 1.33 }], [{ widthMeters: 1.43 }]]);
    cleanup(); const p = props(); p.project.frames.forEach(f => { f.objectStates.o_chair.widthMeters = p.project.stage.widthMeters; });
    render(<ObjectShapeSizeEditor {...p} />); fireEvent.click(screen.getByRole("button", { name: "幅を0.10m大きくする" }));
    expect(p.onCommit).not.toHaveBeenCalled();
  });
  it("remote updates retain numeric draft; only the edited axis is submitted; unchanged draft submits nothing", () => {
    const p = props(); const { rerender } = render(<ObjectShapeSizeEditor {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /幅 .*を入力/ })); fireEvent.change(screen.getByRole("textbox"), { target: { value: "1.23" } });
    const remote = structuredClone(p.project); remote.frames.forEach(f => { f.objectStates.o_chair.heightMeters = 2; });
    rerender(<ObjectShapeSizeEditor {...p} project={remote} />); expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("1.23");
    fireEvent.click(screen.getByRole("button", { name: "確定" })); expect(p.onCommit).toHaveBeenCalledWith("o_chair", { widthMeters: 1.23 });
    (p.onCommit as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /高さ .*を入力/ }));
    const remote2 = structuredClone(remote); remote2.frames.forEach(f => { f.objectStates.o_chair.heightMeters = 3; });
    rerender(<ObjectShapeSizeEditor {...p} project={remote2} />); fireEvent.click(screen.getByRole("button", { name: "確定" }));
    expect(p.onCommit).not.toHaveBeenCalled();
  });
  it.each([1.2345, .01234, 20])("confirming the initial rounded text preserves legacy dimension %s", widthMeters => {
    const p = props(); p.project.frames.forEach(f => { f.objectStates.o_chair.widthMeters = widthMeters; });
    render(<ObjectShapeSizeEditor {...p} />); fireEvent.click(screen.getByRole("button", { name: /幅 .*を入力/ }));
    fireEvent.click(screen.getByRole("button", { name: "確定" })); expect(p.onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["selection", "deleted", "permission", "resize", "orientation"])("cancels drafts on %s", cause => {
    const p = props(); const { rerender } = render(<ObjectShapeSizeEditor {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /幅 .*を入力/ })); fireEvent.change(screen.getByRole("textbox"), { target: { value: "1.23" } });
    if (cause === "selection") rerender(<ObjectShapeSizeEditor {...p} objectId="o_curtain" />);
    if (cause === "deleted") rerender(<ObjectShapeSizeEditor {...p} project={{ ...p.project, stageObjects: [] }} />);
    if (cause === "permission") rerender(<ObjectShapeSizeEditor {...p} canEdit={false} />);
    if (cause === "resize") fireEvent(window, new Event("resize"));
    if (cause === "orientation") fireEvent(window, new Event("orientationchange"));
    expect(screen.queryByRole("textbox")).toBeNull(); expect(p.onCommit).not.toHaveBeenCalled();
  });
  it("folds with optional preference storage, reopens, and describes read-only controls", () => {
    const p = props(); render(<ObjectShapeSizeEditor {...p} canEdit={false} />);
    expect(screen.getByText("閲覧のみです")).toBeTruthy();
    expect((screen.getByRole("button", { name: "⬭ 円" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "小さくする" })); expect(screen.queryByLabelText("道具と方眼の見本")).toBeNull();
    expect(localStorage.getItem("tairetsu-object-editor-collapsed")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "開く" })); expect(screen.getByLabelText("道具と方眼の見本")).toBeTruthy();
  });
  it("drag has no intermediate commits; commits one changed axis on up, discards on cancel", () => {
    const p = props(); render(<ObjectShapeSizeEditor {...p} />);
    const handle = screen.getByRole("button", { name: "幅を変えるつまみ" });
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 80, clientY: 90 });
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 80, clientY: 90 });
    expect(p.onCommit).toHaveBeenCalledTimes(1); expect(p.onCommit).toHaveBeenCalledWith("o_chair", { widthMeters: expect.any(Number) });
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 100, clientY: 50 }); fireEvent.pointerCancel(handle, { pointerId: 4 });
    expect(p.onCommit).toHaveBeenCalledTimes(1);
  });
  it("keeps drag scale fixed across remote sizes and does not commit untouched axes", () => {
    const p = props(); const { rerender } = render(<ObjectShapeSizeEditor {...p} />);
    const handle = screen.getByRole("button", { name: "幅を変えるつまみ" });
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 70, clientY: 50 });
    const preview = screen.getByLabelText("道具と方眼の見本"), text = preview.querySelector(".object-size-editor__width-label")?.textContent;
    const viewBox = preview.querySelector("svg")?.getAttribute("viewBox");
    const remote = structuredClone(p.project); remote.frames.forEach(f => { f.objectStates.o_chair.heightMeters = 4; });
    act(() => rerender(<ObjectShapeSizeEditor {...p} project={remote} />));
    expect(preview.querySelector(".object-size-editor__width-label")?.textContent).toBe(text);
    expect(preview.querySelector("svg")?.getAttribute("viewBox")).toBe(viewBox);
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 70, clientY: 50 });
    expect(p.onCommit).toHaveBeenCalledWith("o_chair", { widthMeters: expect.any(Number) });
  });
  it.each([
    ["幅を変えるつまみ", { widthMeters: 1.3 }],
    ["高さを変えるつまみ", { heightMeters: 1.2 }],
    ["幅と高さを変えるつまみ", { widthMeters: 1.3, heightMeters: 1.2 }],
  ] as const)("%s snaps to 0.1m, commits only once and cancels without saving", (label, patch) => {
    const p = props(); p.project.frames.forEach(f => { f.objectStates.o_chair.widthMeters = 1.23; f.objectStates.o_chair.heightMeters = 1.13; });
    render(<ObjectShapeSizeEditor {...p} />);
    const handle = screen.getByRole("button", { name: label });
    const preview = screen.getByLabelText("道具と方眼の見本");
    const scale = parseFloat((preview.querySelector(".object-size-editor__object") as HTMLElement).style.width) / 1.23;
    const x = 50 + .037 * scale, y = 50 + .037 * scale;
    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: x, clientY: y });
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: x, clientY: y });
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: x, clientY: y });
    expect(vi.mocked(p.onCommit).mock.calls).toEqual([["o_chair", patch]]);
    fireEvent.pointerDown(handle, { pointerId: 9, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 150, clientY: 150 });
    fireEvent.pointerCancel(handle, { pointerId: 9 });
    fireEvent.pointerUp(handle, { pointerId: 9, clientX: 150, clientY: 150 });
    expect(p.onCommit).toHaveBeenCalledTimes(1);
    expect(preview.getAttribute("data-dragging")).toBe("false");
    expect(preview.querySelector(".object-size-editor__width-label")?.textContent).toBe("1.23m");
  });
  it("refits after a successful drag; unchanged release commits nothing", () => {
    const p = props();
    function Harness() {
      const [project, setProject] = useState(p.project);
      return <ObjectShapeSizeEditor {...p} project={project} onCommit={(id, patch) => {
        p.onCommit(id, patch); setProject(current => applyObjectAppearance(current, id, patch)); return null;
      }} />;
    }
    render(<Harness />);
    const preview = screen.getByLabelText("道具と方眼の見本"), handle = screen.getByRole("button", { name: "幅と高さを変えるつまみ" });
    const box = () => preview.querySelector("svg")?.getAttribute("viewBox");
    const initial = box();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(box()).toBe(initial);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(box()).not.toBe(initial);
    expect(p.onCommit).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 0, clientY: 0 });
    expect(p.onCommit).toHaveBeenCalledTimes(1);
  });
  it("provides named, empty circular targets and keyboard steps only on the supported axes", () => {
    const p = props(); render(<ObjectShapeSizeEditor {...p} />);
    const width = screen.getByRole("button", { name: "幅を変えるつまみ" });
    const height = screen.getByRole("button", { name: "高さを変えるつまみ" });
    const both = screen.getByRole("button", { name: "幅と高さを変えるつまみ" });
    expect([width, height, both].every(el => el.textContent === "")).toBe(true);
    fireEvent.keyDown(width, { key: "ArrowDown" }); fireEvent.keyDown(height, { key: "ArrowRight" });
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(width, { key: "ArrowRight" }); fireEvent.keyDown(height, { key: "ArrowDown" });
    fireEvent.keyDown(both, { key: "ArrowLeft" }); fireEvent.keyDown(both, { key: "ArrowUp" });
    expect(vi.mocked(p.onCommit).mock.calls).toEqual([["o_chair", { widthMeters: .9 }], ["o_chair", { heightMeters: .9 }],
      ["o_chair", { widthMeters: .7 }], ["o_chair", { heightMeters: .7 }]]);
  });
  it.each([[5, .1], [.1, 5], [.1, .1], [.4, .4], [1.33, .5]])("fits %s × %s with separated 44px targets and aligned dimension lines", (widthMeters, heightMeters) => {
    const p = props(); p.project.frames.forEach(f => { f.objectStates.o_chair.widthMeters = widthMeters; f.objectStates.o_chair.heightMeters = heightMeters; });
    render(<ObjectShapeSizeEditor {...p} />);
    const preview = screen.getByLabelText("道具と方眼の見本");
    const targetSize = parseFloat(screen.getByRole("region", { name: "形と大きさ" }).style.getPropertyValue("--object-editor-touch-size"));
    expect(targetSize).toBeGreaterThanOrEqual(44);
    const rect = (selector: string) => {
      const s = (preview.querySelector(selector) as HTMLElement).style;
      return { left: parseFloat(s.left), top: parseFloat(s.top), width: parseFloat(s.width) || targetSize, height: parseFloat(s.height) || targetSize };
    };
    const targets = [".handle-width", ".handle-height", ".handle-both"].map(rect);
    targets.forEach(a => {
      expect(a.left).toBeGreaterThanOrEqual(0); expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.left + a.width).toBeLessThanOrEqual(300.001); expect(a.top + a.height).toBeLessThanOrEqual(200.001);
      targets.filter(b => b !== a).forEach(b => expect(a.left + a.width <= b.left || b.left + b.width <= a.left ||
        a.top + a.height <= b.top || b.top + b.height <= a.top).toBe(true));
    });
    const object = rect(".object-size-editor__object"), widthLine = rect(".dimension-width"), heightLine = rect(".dimension-height");
    expect(widthLine.left).toBe(object.left); expect(widthLine.width).toBe(object.width);
    expect(heightLine.top).toBe(object.top); expect(heightLine.height).toBe(object.height);
    expect(widthLine.top).toBeLessThan(object.top); expect(heightLine.left).toBeLessThan(object.left);
    expect(object.width / object.height).toBeCloseTo(widthMeters / heightMeters);
    // At a narrow 300px preview the fixed touch/label margins take priority.
    expect(Math.max(object.width / 300, object.height / 200)).toBeGreaterThanOrEqual(.53);
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ParadeCanvas } from "./components/ParadeCanvas";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createSampleProject } from "./sampleProject";
import { defaultPrintOptions } from "./utils/printLayout";
import { validateParadeA4Export } from "./utils/paradeA4Limits";

type CanvasProps = ComponentProps<typeof ParadeCanvas>;
const observed = vi.hoisted(() => ({ canvas: null as CanvasProps | null, print: vi.fn() }));
let project: ReturnType<typeof createSampleProject>;
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    const repository = new MemoryProjectRepository();
    await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-export-safety" });
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/ParadeCanvas", () => ({ ParadeCanvas: forwardRef<HTMLDivElement, CanvasProps>((p, ref) => {
  observed.canvas = p; return <div ref={ref} data-testid="canvas" />;
}) }));
vi.mock("./components/PrintPreview", async original => ({
  ...await original<typeof import("./components/PrintPreview")>(),
  PrintPreview: () => { observed.print(); return <div data-testid="print-dom" />; },
}));
import App from "./App";

beforeEach(() => {
  localStorage.clear(); observed.canvas = null; observed.print.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  project = { ...createSampleProject(), mode: "parade", id: "export-safety", title: "書き出し安全検証" };
  // Valid saved settings, but one huge dashed annotation exceeds the drawing budget.
  project.frames[0].annotationLines = { huge: { x1: 0, y1: 0, x2: 1, y2: 100000, color: "red", dash: "dashed" } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "書き出し安全検証を開く" }));
  await screen.findByTestId("canvas");
}
function expectedNotice() {
  try { validateParadeA4Export(observed.canvas!.project, [project.frames[0].id], defaultPrintOptions); }
  catch (error) { return (error as Error).message; }
  throw new Error("fixture must exceed safety budget");
}
it.each(["image", "pdf"] as const)("stops camera %s before mounting PrintPreview and displays the shared Japanese safety notice", async format => {
  await open(); const message = expectedNotice();
  act(() => observed.canvas!.onCaptureStageImage?.());
  const dialog = await screen.findByRole("dialog", { name: "ステージを書き出す" });
  if (format === "pdf") fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
  fireEvent.click(within(dialog).getByRole("button", { name: format === "image" ? "画像を作成" : "PDFを作成" }));
  expect(await screen.findByText(`ステージ画像の作成に失敗しました: ${message}`)).toBeTruthy();
  expect(observed.print).not.toHaveBeenCalled();
});
it.each(["image", "pdf"] as const)("stops A4 %s before mounting PrintPreview and displays the shared Japanese safety notice", async format => {
  await open(); const message = expectedNotice();
  fireEvent.click(screen.getByRole("button", { name: "共有と書き出し" }));
  fireEvent.click(await screen.findByRole("button", { name: /このシーンを書き出す/ }));
  const dialog = screen.getByRole("dialog", { name: "共有と書き出し" });
  if (format === "image") fireEvent.click(within(dialog).getByRole("button", { name: "画像" }));
  fireEvent.click(within(dialog).getByRole("button", { name: format === "image" ? "画像を作成" : "PDFを作成" }));
  expect(await screen.findByText(`書き出しに失敗しました: ${message}`)).toBeTruthy();
  expect(observed.print).not.toHaveBeenCalled();
});

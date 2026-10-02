// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletedExport } from "../utils/mobileExportTypes";
const environment = vi.hoisted(() => ({ native: false, apple: false, available: true, plugin: true, share: vi.fn(), save: vi.fn() }));
vi.mock("../platform/files", () => ({ isNativeExportRuntime: () => environment.native, isNativeExportShareAvailable: () => environment.plugin }));
vi.mock("../utils/exportDelivery", () => ({ canShareExportFiles: () => environment.available && (!environment.native || environment.plugin),
  isAppleTouchDevice: () => environment.apple, shareExportFiles: environment.share, saveExportFile: environment.save }));
import { ExportCompletionDialog, ExportCompletionPanel } from "./ExportCompletionPanel";
const completed = (pdf = false, count = 3): CompletedExport => ({
  files: Array.from({ length: pdf ? 1 : count }, (_, i) => new File(["data"], `${i + 1}.${pdf ? "pdf" : "png"}`, { type: pdf ? "application/pdf" : "image/png" })),
  preview: new Blob(["preview"], { type: "image/png" }), targetLabel: "隊列表", scopeLabel: "全シーン", pageCount: count,
});
beforeEach(() => {
  Object.assign(environment, { native: false, apple: false, available: true, plugin: true });
  environment.share.mockReset().mockResolvedValue("shared"); environment.save.mockReset().mockResolvedValue("saved");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("export completion delivery", () => {
  it.each([false, true])("native uses one share/save button and the correct destination hint (PDF=%s)", (pdf) => {
    environment.native = true;
    render(<ExportCompletionPanel result={completed(pdf)} />);
    expect(screen.getByRole("button", { name: "共有・保存" })).toBeTruthy();
    expect(screen.getByText(pdf ? "LINE・AirDrop・ファイルへの保存など" : "LINE・AirDrop・写真への保存など")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ファイルに保存" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存する" })).toBeNull();
    expect(environment.share).not.toHaveBeenCalled(); expect(environment.save).not.toHaveBeenCalled();
  });
  it("Apple Safari gives share priority and a separate file download", async () => {
    environment.apple = true; const result = completed(true);
    render(<ExportCompletionPanel result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "ファイルに保存" }));
    await waitFor(() => expect(environment.save).toHaveBeenCalledExactlyOnceWith(result.files[0]));
    expect(screen.getByRole("button", { name: "共有・保存" })).toBeTruthy(); expect(environment.share).not.toHaveBeenCalled();
  });
  it.each([false, true])("PC gives save priority and only offers capable sharing (%s)", (available) => {
    environment.available = available; render(<ExportCompletionPanel result={completed()} />);
    expect(screen.getByRole("button", { name: "保存する" })).toBeTruthy();
    expect(Boolean(screen.queryByRole("button", { name: "共有する" }))).toBe(available);
  });
  it("Apple without file sharing still permits saving", () => {
    environment.apple = true; environment.available = false; render(<ExportCompletionPanel result={completed()} />);
    expect(screen.getByRole("button", { name: "保存する" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "共有・保存" })).toBeNull();
  });
  it("retains ordered files through cancellation, error and explicit retries without automatic saving", async () => {
    environment.native = true;
    environment.share.mockResolvedValueOnce("cancelled").mockRejectedValueOnce(new Error("LINE unavailable"));
    const result = completed(); render(<ExportCompletionPanel result={result} />);
    const share = screen.getByRole("button", { name: "共有・保存" });
    fireEvent.click(share); expect(environment.share).toHaveBeenCalledTimes(1);
    await screen.findByText(/取り消しました。/);
    fireEvent.click(share); await screen.findByText(/LINE unavailable/);
    fireEvent.click(share); await screen.findByText("共有先への受け渡しが完了しました。");
    expect(environment.share.mock.calls.map(([files]) => files)).toEqual([result.files, result.files, result.files]);
    expect(environment.share.mock.calls[2][0]).toBe(result.files); expect(environment.save).not.toHaveBeenCalled();
  });
  it("blocks duplicate taps and closing during delivery, then restores the controls", async () => {
    environment.native = true; let finish!: (status: string) => void;
    environment.share.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn(); render(<ExportCompletionDialog result={completed()} onClose={close} />);
    const share = screen.getByRole("button", { name: "共有・保存" });
    fireEvent.click(share); fireEvent.click(share);
    expect(environment.share).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "閉じる" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(close).not.toHaveBeenCalled();
    finish("cancelled"); await screen.findByText(/取り消しました。/);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" })); expect(close).toHaveBeenCalledTimes(1);
  });
  it("shows plugin absence explicitly without offering the legacy native share", () => {
    environment.native = true; environment.plugin = false; render(<ExportCompletionPanel result={completed()} />);
    expect(screen.getByRole("alert").textContent).toContain("アプリを更新");
    expect((screen.getByRole("button", { name: "共有・保存" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "保存する" })).toBeNull();
  });
  it("copies a PC screenshot only on its own explicit button", async () => {
    const copy = vi.fn().mockResolvedValue(true); render(<ExportCompletionPanel result={completed(false, 1)} onCopyImage={copy} />);
    expect(copy).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "画像をコピー" }));
    await screen.findByText("画像をクリップボードにコピーしました。");
    expect(copy).toHaveBeenCalledTimes(1); expect(environment.share).not.toHaveBeenCalled(); expect(environment.save).not.toHaveBeenCalled();
  });
  it("releases the preview on replacement and close and describes ZIP without Photos", () => {
    const { rerender, unmount } = render(<ExportCompletionPanel result={completed()} />);
    environment.native = true;
    rerender(<ExportCompletionPanel result={{ ...completed(), preview: null, files: [new File(["zip"], "project.zip", { type: "application/zip" })] }} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.getByText("LINE・AirDrop・ファイルへの保存など")).toBeTruthy();
    unmount();
  });
});

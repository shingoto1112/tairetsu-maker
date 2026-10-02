// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareExportModal } from "./ShareExportModal";
import { formationExportFixture } from "../utils/formationExportFixture";

vi.mock("./DocumentExportSheet", () => ({ DocumentExportSheet: ({ initialTarget, initialFormat, onClose }: { initialTarget: string; initialFormat: string; onClose: () => void }) =>
  <div role="dialog" aria-label="スマホ書き出し">{initialTarget}:{initialFormat}<button onClick={onClose}>戻る</button></div> }));
afterEach(cleanup);
describe("ShareExportModal mobile and A4 coexistence", () => {
  it("focuses on open, cycles Tab, permits input/Escape and restores the opener", () => {
    const onClose = vi.fn();
    const props = { projectTitle: "練習用", currentSceneLabel: "1", onClose, onExport: vi.fn() };
    const { rerender } = render(<><button>開く</button><ShareExportModal {...props} isOpen={false} /></>);
    screen.getByRole("button", { name: "開く" }).focus();
    rerender(<><button>開く</button><ShareExportModal {...props} isOpen /></>);
    const close = screen.getByRole("button", { name: "共有と書き出しを閉じる" });
    expect(document.activeElement).toBe(close);
    const controls = screen.getByRole("dialog").querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(controls[controls.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "任意の名前" } });
    expect((input as HTMLInputElement).value).toBe("任意の名前");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<><button>開く</button><ShareExportModal {...props} isOpen={false} /></>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "開く" }));
  });
  it("opens the common sheet for images and PDF and retains the A4 export", async () => {
    const project = formationExportFixture(), onExport = vi.fn();
    render(<ShareExportModal isOpen projectTitle="練習用" currentSceneLabel="シーン1" onClose={vi.fn()} onExport={onExport}
      getMobileExportSource={() => ({ project, projectTitle: project.title, members: [], memberGroups: [], objects: [], objectGroups: [], frames: [], currentFrame: project.frames[0], objectStates: {} })} />);
    expect(screen.getByText("スマホで見る（LINE向け）")).toBeTruthy();
    expect(screen.getByText("印刷・PDF（A4）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^隊列表の画像/ }));
    expect(await screen.findByText("formation:png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    fireEvent.click(screen.getByRole("button", { name: /^隊列表のPDF/ }));
    expect(await screen.findByText("formation:pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scope: "current", format: "pdf", options: expect.objectContaining({ includeAssignments: false, includeSceneTime: false }) }));
  });
});

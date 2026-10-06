// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareExportModal } from "./ShareExportModal";
import { formationExportFixture } from "../utils/formationExportFixture";

vi.mock("./DocumentExportSheet", () => ({ DocumentExportSheet: ({ initialTarget, initialFormat, onClose }: { initialTarget: string; initialFormat: string; onClose: () => void }) =>
  <div role="dialog" aria-label="スマホ書き出し">{initialTarget}:{initialFormat}<button onClick={onClose}>戻る</button></div> }));
afterEach(cleanup);
describe("ShareExportModal mobile and A4 coexistence", () => {
  it("passes the chosen A4 origin, resets on reopen, and hides it for parade", async () => {
    const onExport = vi.fn(), props = { projectTitle: "確認", currentSceneLabel: "1", onClose: vi.fn(), onExport };
    const { rerender } = render(<ShareExportModal {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect((screen.getByRole("radio", { name: "上を0mにする" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "下を0mにする" }));
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ verticalOrigin: "bottom" }) }));
    rerender(<ShareExportModal {...props} isOpen={false} />);
    rerender(<ShareExportModal {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect((screen.getByRole("radio", { name: "上を0mにする" }) as HTMLInputElement).checked).toBe(true);
    rerender(<ShareExportModal {...props} isOpen isParade />);
    expect(screen.queryByRole("radio")).toBeNull();
  });
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
  it("opens roster and assignment sheets from the share dialog and keeps the original A4 export", async () => {
    const project = formationExportFixture(), onExport = vi.fn();
    render(<ShareExportModal isOpen projectTitle="練習用" currentSceneLabel="シーン1" onClose={vi.fn()} onExport={onExport}
      getMobileExportSource={() => ({ project, projectTitle: project.title, members: [], memberGroups: [], objects: [], objectGroups: [], frames: [], currentFrame: project.frames[0], objectStates: {} })} />);
    expect(screen.queryByText("スマホで見る（LINE向け）")).toBeNull();
    expect(screen.getByText("印刷・PDF")).toBeTruthy();
    for (const [label, target] of [["メンバー名簿", "members"], ["道具名簿", "objects"], ["道具割当表", "assignments"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      expect(await screen.findByText(`${target}:${target === "members" ? "png" : "pdf"}`)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    }
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scope: "current", format: "pdf", options: expect.objectContaining({ includeAssignments: false, includeSceneTime: false }) }));
  });
});

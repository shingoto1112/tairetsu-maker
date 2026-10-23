// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareExportModal } from "./ShareExportModal";
import { formationExportFixture } from "../utils/formationExportFixture";

vi.mock("./DocumentExportSheet", () => ({ DocumentExportSheet: ({ initialTarget, initialFormat, onClose }: { initialTarget: string; initialFormat: string; onClose: () => void }) =>
  <div role="dialog" aria-label="スマホ書き出し">{initialTarget}:{initialFormat}<button onClick={onClose}>戻る</button></div> }));
afterEach(cleanup);
describe("ShareExportModal mobile and A4 coexistence", () => {
  it.each(["current", "all"] as const)("offers both formats and preserves assignments for %s A4 export", async scope => {
    const onExport = vi.fn();
    render(<ShareExportModal stage={formationExportFixture().stage} isOpen projectTitle="演目" currentSceneLabel="1" onClose={vi.fn()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: scope === "current" ? /^このシーンを書き出す/ : /^すべてのシーンを書き出す/ }));
    expect(screen.getByRole("button", { name: "PDF" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "画像" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /道具割当も右側に表示する/ }));
    fireEvent.click(screen.getByRole("button", { name: "画像を作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scope, format: "image", fileName: expect.stringMatching(/^演目_隊列表_/), options: expect.objectContaining({ includeAssignments: true }) }));
  });
  it.each(["top", "bottom"] as const)("%s: initializes from the current view, keeps selection local, resets on reopen, and hides it for parade", async frontDirection => {
    const onExport = vi.fn(), props = { projectTitle: "確認", currentSceneLabel: "1", onClose: vi.fn(), onExport, viewerPerspective: "performer" as const };
    const stage = { ...formationExportFixture().stage, frontDirection };
    const { rerender } = render(<ShareExportModal stage={stage} {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect(screen.queryByText(/縦の目盛りの0m/)).toBeNull();
    expect(screen.getByRole("group", { name: "書き出す向き" }).querySelectorAll(".counting-card")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "踊る人側から見た向き" }).closest("label")?.textContent).toContain("0m（客席側）が上");
    expect(screen.getByRole("radio", { name: "観客側から見た向き" }).closest("label")?.textContent).toContain("0m（客席側）が下");
    expect((screen.getByRole("radio", { name: "踊る人側から見た向き" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "観客側から見た向き" }));
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ viewerPerspective: "audience" }) }));
    rerender(<ShareExportModal stage={stage} {...props} isOpen={false} />);
    rerender(<ShareExportModal stage={stage} {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect((screen.getByRole("radio", { name: "踊る人側から見た向き" }) as HTMLInputElement).checked).toBe(true);
    rerender(<ShareExportModal stage={stage} {...props} isOpen isParade />);
    expect(screen.queryByRole("radio")).toBeNull();
  });
  it("offers embedding fonts only as a small PDF option that starts off on every open", () => {
    const onExport = vi.fn(), props = { projectTitle: "演目", currentSceneLabel: "1", onClose: vi.fn(), onExport };
    const { rerender } = render(<ShareExportModal stage={formationExportFixture().stage} {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    const option = () => screen.queryByRole("checkbox", { name: /フォントを入れて作る/ }) as HTMLInputElement | null;
    expect(option()?.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport.mock.calls[0][0].options.embedPdfFonts).toBeUndefined();
    fireEvent.click(option()!);
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport.mock.calls[1][0].options.embedPdfFonts).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "画像" }));
    expect(option()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "画像を作成" }));
    expect(onExport.mock.calls[2][0].options.embedPdfFonts).toBeUndefined();
    rerender(<ShareExportModal stage={formationExportFixture().stage} {...props} isOpen={false} />);
    rerender(<ShareExportModal stage={formationExportFixture().stage} {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect(option()?.checked).toBe(false);
  });
  it("focuses on open, cycles Tab, permits input/Escape and restores the opener", () => {
    const onClose = vi.fn();
    const props = { projectTitle: "練習用", currentSceneLabel: "1", onClose, onExport: vi.fn() };
    const { rerender } = render(<><button>開く</button><ShareExportModal stage={formationExportFixture().stage} {...props} isOpen={false} /></>);
    screen.getByRole("button", { name: "開く" }).focus();
    rerender(<><button>開く</button><ShareExportModal stage={formationExportFixture().stage} {...props} isOpen /></>);
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
    rerender(<><button>開く</button><ShareExportModal stage={formationExportFixture().stage} {...props} isOpen={false} /></>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "開く" }));
  });
  it("opens only the member sheet from the share dialog and keeps the original A4 export", async () => {
    const project = formationExportFixture(), onExport = vi.fn();
    render(<ShareExportModal stage={formationExportFixture().stage} isOpen projectTitle="練習用" currentSceneLabel="シーン1" onClose={vi.fn()} onExport={onExport}
      getMobileExportSource={() => ({ project, projectTitle: project.title, members: [], memberGroups: [], objects: [], objectGroups: [], frames: [], currentFrame: project.frames[0], objectStates: {} })} />);
    expect(screen.queryByText("スマホで見る（LINE向け）")).toBeNull();
    expect(screen.queryByText("道具名簿")).toBeNull();
    expect(screen.queryByText("道具割当表")).toBeNull();
    expect(screen.getByText("隊列表（A4）")).toBeTruthy();
    for (const [label, target] of [["メンバー名簿", "members"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      expect(await screen.findByText(`${target}:${target === "members" ? "png" : "pdf"}`)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    }
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scope: "current", format: "pdf", options: expect.objectContaining({ includeAssignments: false, includeSceneTime: false }) }));
  });
});

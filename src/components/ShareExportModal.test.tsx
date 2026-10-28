// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareExportModal } from "./ShareExportModal";
import { formationExportFixture } from "../utils/formationExportFixture";
import { hasReducedPrintMemberLabels } from "../utils/printLayout";

vi.mock("./DocumentExportSheet", () => ({ DocumentExportSheet: ({ initialTarget, initialFormat, onClose }: { initialTarget: string; initialFormat: string; onClose: () => void }) =>
  <div role="dialog" aria-label="スマホ書き出し">{initialTarget}:{initialFormat}<button onClick={onClose}>戻る</button></div> }));
afterEach(cleanup);
describe("ShareExportModal mobile and A4 coexistence", () => {
  it("shows the non-blocking notice only for the selected scope, layout and visible names", () => {
    const project = formationExportFixture(); project.stage.widthMeters = 29; project.stage.depthMeters = 23.5;
    project.stage.memberDiameterMeters = 1;
    project.members = [{ id: "m0", name: "あおい", color: "#0d8b78" }]; project.stageObjects = [];
    project.frames = project.frames.slice(0, 2);
    project.frames[0].memberVisibility = { m0: false };
    const onExport = vi.fn(), props = { stage: project.stage, project, selectedFrameId: "s0", isOpen: true,
      projectTitle: "検証", currentSceneLabel: "1", onClose: vi.fn(), onExport };
    const { rerender } = render(<ShareExportModal {...props} />);
    const notice = () => screen.queryByText(/^名前を丸の中に収めるため/);
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect(notice()).toBeNull();
    const tiny = { ...project, stage: { ...project.stage, memberDiameterMeters: .5 } };
    rerender(<ShareExportModal {...props} project={tiny} stage={tiny.stage} />);
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    fireEvent.click(screen.getByRole("button", { name: /^すべてのシーンを書き出す/ }));
    expect(notice()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "画像" }));
    expect(notice()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "画像を作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scope: "all", format: "image" }));
    rerender(<ShareExportModal {...props} selectedFrameId="s1" />);
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /道具割当も右側に表示する/ }));
    expect(notice()).toBeNull(); // agreed 29m / 1m kana example fits even with assignments
    rerender(<ShareExportModal {...props} project={tiny} stage={tiny.stage} selectedFrameId="s1" />);
    expect(notice()).toBeTruthy();
  });
  it("suggests only the remedies still available for the circle size and side column", () => {
    const p = formationExportFixture(); p.stage.widthMeters = 29; p.stage.depthMeters = 23.5; p.stage.memberDiameterMeters = .5;
    p.members = [{ id: "m0", name: "あおい", color: "#0d8b78" }]; p.frames = [p.frames[0]];
    const props = { project: p, stage: p.stage, selectedFrameId: "s0", isOpen: true, projectTitle: "検証", currentSceneLabel: "1", onClose: vi.fn(), onExport: vi.fn() };
    const { rerender } = render(<ShareExportModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    const notice = () => screen.getByText(/^名前を丸の中に収めるため/).textContent;
    expect(notice()).toBe("名前を丸の中に収めるため、文字を小さくしています。丸を大きくすると大きく表示できます。");
    fireEvent.click(screen.getByRole("checkbox", { name: /道具割当も右側に表示する/ }));
    expect(notice()).toBe("名前を丸の中に収めるため、文字を小さくしています。丸を大きくするか、道具割当欄を外すと大きく表示できます。");
    const largest = { ...p, members: [{ id: "m0", name: "WWWWWWWWWWWW", color: "#0d8b78" }], stage: { ...p.stage, widthMeters: 36, depthMeters: 20, memberDiameterMeters: 1 } };
    rerender(<ShareExportModal {...props} project={largest} stage={largest.stage} />);
    expect(notice()).toBe("名前を丸の中に収めるため、文字を小さくしています。道具割当欄を外すと大きく表示できます。");
    fireEvent.click(screen.getByRole("checkbox", { name: /道具割当も右側に表示する/ }));
    expect(notice()).toBe("名前を丸の中に収めるため、文字を小さくしています。");
  });
  it("uses assignment visibility and catches reductions in assignment chips too", () => {
    const p = formationExportFixture(); p.members = [p.members[0]]; p.members[0].name = "WWWWWWWWWWWW";
    p.frames = [p.frames[0]]; p.frames[0].objectAssignments = { flag: ["m0"] };
    expect(hasReducedPrintMemberLabels(p, ["s0"])).toBe(false);
    expect(hasReducedPrintMemberLabels(p, ["s0"], { includeAssignments: true })).toBe(true);
    p.frames[0].objectStates.flag = { objectId: "flag", x: 4, y: 3, widthMeters: 3, heightMeters: 1, rotation: 0, visible: false, zIndex: 0 };
    expect(hasReducedPrintMemberLabels(p, ["s0"], { includeAssignments: true })).toBe(false);
    expect(hasReducedPrintMemberLabels(p, [])).toBe(false);
  });
  it("updates the notice when assignment layout alone makes the name smaller", () => {
    const p = formationExportFixture(); p.stage.widthMeters = 29; p.stage.depthMeters = 23.5; p.stage.memberDiameterMeters = .75;
    p.members = [{ id: "m0", name: "あおい", color: "#0d8b78" }]; p.frames = [p.frames[0]];
    render(<ShareExportModal stage={p.stage} project={p} selectedFrameId="s0" isOpen projectTitle="検証" currentSceneLabel="1" onClose={vi.fn()} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    expect(screen.queryByText(/^名前を丸の中に収めるため/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /道具割当も右側に表示する/ }));
    expect(screen.queryByText(/^名前を丸の中に収めるため/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /道具割当も右側に表示する/ }));
    expect(screen.queryByText(/^名前を丸の中に収めるため/)).toBeNull();
  });
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

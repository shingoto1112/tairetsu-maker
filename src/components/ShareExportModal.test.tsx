// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareExportModal } from "./ShareExportModal";
import { formationExportFixture } from "../utils/formationExportFixture";

vi.mock("./DocumentExportSheet", () => ({ DocumentExportSheet: ({ initialTarget, initialFormat, onClose }: { initialTarget: string; initialFormat: string; onClose: () => void }) =>
  <div role="dialog" aria-label="スマホ書き出し">{initialTarget}:{initialFormat}<button onClick={onClose}>戻る</button></div> }));
afterEach(cleanup);
describe("ShareExportModal mobile and A4 coexistence", () => {
  it("opens the common sheet for images and PDF and retains the A4 export", async () => {
    const project = formationExportFixture(), onExport = vi.fn();
    render(<ShareExportModal isOpen projectTitle="練習用" currentSceneLabel="シーン1" onClose={vi.fn()} onExport={onExport}
      getMobileExportSource={() => ({ project, projectTitle: project.title, members: [], memberGroups: [], objects: [], objectGroups: [], frames: [], currentFrame: project.frames[0], objectStates: {} })} />);
    expect(screen.getByText("スマホで見る（LINE向け）")).toBeTruthy();
    expect(screen.getByText("印刷・PDF（A4）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "隊列表の画像" }));
    expect(await screen.findByText("formation:png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "隊列表のPDF" }));
    expect(await screen.findByText("formation:pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    fireEvent.click(screen.getByRole("button", { name: /^このシーンを書き出す/ }));
    fireEvent.click(screen.getByRole("button", { name: "PDFを作成" }));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scope: "current", format: "pdf", options: expect.objectContaining({ includeAssignments: false, includeSceneTime: false }) }));
  });
});

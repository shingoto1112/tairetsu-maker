// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentExportSheet } from "./DocumentExportSheet";
import { generateDocumentExport } from "../utils/mobileExport";
import { shareExportFiles, saveExportFile } from "../utils/exportDelivery";
import type { ExportSource, GeneratedExport } from "../utils/mobileExportTypes";
import { formationExportFixture } from "../utils/formationExportFixture";
import { prepareFormationPages } from "../utils/formationExport";
import { prepareMemberMobilePlan } from "../utils/memberMobileExport";
vi.mock("../utils/memberMobileExport", () => ({ prepareMemberMobilePlan: vi.fn() }));

vi.mock("../utils/mobileExport", () => ({
  exportTargets: Object.fromEntries(["formation", "members", "objects", "assignments"].map((target) => [target, { snapshot: (source: ExportSource) => ({ target, data: source }) }])),
  generateDocumentExport: vi.fn(),
}));
vi.mock("../utils/formationExport", () => ({ prepareFormationPages: vi.fn(async () => [{}, {}]) }));
vi.mock("../utils/exportDelivery", () => ({ canShareExportFiles: () => true, isAppleTouchDevice: () => false, shareExportFiles: vi.fn(), saveExportFile: vi.fn() }));
vi.mock("../platform/files", () => ({ isNativeExportRuntime: () => false, isNativeExportShareAvailable: () => false }));
const source: ExportSource = { projectTitle: "演目", members: [], memberGroups: [], objects: [], objectGroups: [], frames: [], currentFrame: null, objectStates: {} };
const completed = (): GeneratedExport => ({
  files: [1, 2, 3].map((i) => new File(["image"], `演目_${i}.png`, { type: "image/png" })),
  preview: new Blob(["preview"], { type: "image/png" }), targetLabel: "道具割当表", scopeLabel: "全シーン", pageCount: 3,
});
describe("DocumentExportSheet", () => {
  beforeEach(() => {
    vi.mocked(generateDocumentExport).mockReset().mockResolvedValue(completed());
    vi.mocked(prepareMemberMobilePlan).mockReset().mockResolvedValue({ width: 1536, height: 2048, columns: 5, fontSize: 32 } as Awaited<ReturnType<typeof prepareMemberMobilePlan>>);
    vi.mocked(shareExportFiles).mockReset().mockResolvedValue("shared");
    vi.mocked(saveExportFile).mockReset().mockResolvedValue("saved");
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn(); });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("tracks the initial target and exposes explicit action labels and supported purposes", async () => {
    const props = { getSource: () => structuredClone(source), onClose: vi.fn() };
    const { rerender } = render(<DocumentExportSheet {...props} initialTarget="members" initialFormat="pdf" />);
    expect(screen.getByRole("button", { name: "メンバー名簿の画像を作成" })).toBeTruthy();
    await screen.findByText("1枚・1536×2048px・5列・名前32px");
    expect(screen.getByRole("button", { name: "画像" }).getAttribute("aria-pressed")).toBe("true");
    rerender(<DocumentExportSheet {...props} initialTarget="assignments" />);
    expect(screen.getByRole("button", { name: "道具割当表の画像を作成" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "印刷向け（A4）" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(screen.getByRole("button", { name: "道具割当表のPDFを作成" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "このシーン" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("preflights member mobile output and presents the below-24px choice before creation, defaulting to one page", async () => {
    vi.mocked(prepareMemberMobilePlan).mockResolvedValue(null);
    render(<DocumentExportSheet initialTarget="members" getSource={() => source} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "スマホで見る（LINE向け）" }));
    expect(screen.getByRole("button", { name: "メンバー名簿の画像を作成" }).hasAttribute("disabled")).toBe(true);
    const single = await screen.findByRole("button", { name: "全員を1枚にする（文字が小さくなります）" });
    expect(single.getAttribute("aria-pressed")).toBe("true");
    expect(generateDocumentExport).not.toHaveBeenCalled();
    expect(screen.getByText("全員を1枚にまとめます。名前は拡大して確認できます")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "読みやすさを優先して分ける（複数枚）" }));
    fireEvent.click(screen.getByRole("button", { name: "メンバー名簿の画像を作成" }));
    await screen.findByRole("button", { name: "共有する" });
    expect(generateDocumentExport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ memberOverflow: "readable", purpose: "mobile" }), expect.anything());
  });
  it("shows a one-page estimate for members while A4 and objects retain their existing options", async () => {
    render(<DocumentExportSheet initialTarget="members" getSource={() => source} onClose={vi.fn()} />);
    expect(screen.getByText("1枚の名簿")).toBeTruthy();
    expect(screen.getByRole("button", { name: "スマホで見る（LINE向け）" }).getAttribute("aria-pressed")).toBe("true");
    await screen.findByText("1枚・1536×2048px・5列・名前32px");
    expect(screen.queryByRole("button", { name: "読みやすさを優先して分ける（複数枚）" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "道具名簿" }));
    expect(screen.queryByText("1枚の名簿")).toBeNull();
  });
  it("retains completed files on cancellation, failure and successful sharing without regenerating", async () => {
    const getSource = vi.fn(() => structuredClone(source));
    render(<DocumentExportSheet initialTarget="assignments" getSource={getSource} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "全シーン" }));
    fireEvent.click(screen.getByRole("button", { name: "道具割当表の画像を作成" }));
    const share = await screen.findByRole("button", { name: "共有する" });
    expect(shareExportFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/3枚の画像・合計/)).toBeTruthy();
    expect(screen.getByAltText("道具割当表の先頭ページ")).toBeTruthy();
    expect(generateDocumentExport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ target: "assignments", scope: "all", purpose: "mobile" }), expect.anything());
    vi.mocked(shareExportFiles).mockResolvedValueOnce("cancelled").mockRejectedValueOnce(new Error("share failed")).mockResolvedValue("shared");
    fireEvent.click(share); await screen.findByText(/取り消しました。作成済み/);
    fireEvent.click(share); await screen.findByText(/受け渡しに失敗/);
    fireEvent.click(share); await screen.findByText("共有先への受け渡しが完了しました。");
    expect(screen.getByRole("button", { name: "共有する" })).toBeTruthy();
    expect(generateDocumentExport).toHaveBeenCalledTimes(1); expect(getSource).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(shareExportFiles).mock.calls;
    expect(calls[0][0]).toBe(calls[2][0]);
    expect(saveExportFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    expect(saveExportFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "2枚目を保存" }));
    await waitFor(() => expect(saveExportFile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveExportFile).mock.calls[0][0].name).toBe("演目_2.png");
  });
  it("cancels generation without exposing partial files and permits retry", async () => {
    vi.mocked(generateDocumentExport).mockImplementationOnce((_snapshot, _request, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancel", "AbortError")))));
    render(<DocumentExportSheet initialTarget="members" getSource={() => source} onClose={vi.fn()} />);
    const create = screen.getByRole("button", { name: "メンバー名簿の画像を作成" });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(generateDocumentExport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "作成を取り消す" }));
    await screen.findByText("作成を取り消しました。");
    expect(screen.queryByRole("button", { name: "共有する" })).toBeNull();
    fireEvent.click(create); await screen.findByRole("button", { name: "共有する" });
    expect(generateDocumentExport).toHaveBeenCalledTimes(2);
  });
  it("aborts work on unmount and releases previews on close", async () => {
    const { unmount } = render(<DocumentExportSheet initialTarget="objects" getSource={() => source} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "道具名簿の画像を作成" }));
    await screen.findByRole("button", { name: "共有する" });
    await act(async () => unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
  it("defaults formation to all scenes, details off, estimates pages and preserves the chosen entry format", async () => {
    const project = formationExportFixture();
    render(<DocumentExportSheet initialTarget="formation" initialFormat="pdf" supportsFormation
      getSource={() => ({ ...source, project, currentFrame: project.frames[0] })} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "全シーン" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "拡大図も付ける" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "印刷向け（A4）" })).toBeNull();
    await screen.findByText("予想 2ページ");
    vi.mocked(prepareFormationPages).mockResolvedValueOnce(Array.from({ length: 8 }, () => ({})) as Awaited<ReturnType<typeof prepareFormationPages>>);
    fireEvent.click(screen.getByRole("checkbox", { name: "拡大図も付ける" }));
    await screen.findByText("予想 8ページ（全体図 → 拡大図・左から右）");
    expect(prepareFormationPages).toHaveBeenLastCalledWith(expect.anything(), true, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "隊列表のPDFを作成" }));
    await screen.findByRole("button", { name: "共有する" });
    expect(generateDocumentExport).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ target: "formation", scope: "all", includeDetails: true, format: "pdf" }), expect.anything());
  });
});

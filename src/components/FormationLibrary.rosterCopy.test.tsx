// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormationLibrary, type NewFormationInput } from "./FormationLibrary";
import { createSampleProject } from "../sampleProject";
import type { ProjectSummary } from "../repositories/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const summary: ProjectSummary = { id: "source", title: "去年の大会", mode: "parade", memberCount: 3, sceneCount: 3,
  createdAt: "2026-01-01", updatedAt: "2026-10-14", repositoryRevision: "1", syncStatus: "local" };
function setup(hasTools = true) {
  const source = createSampleProject(); source.id = "source";
  if (!hasTools) source.stageObjects = [];
  else source.frames.forEach(f => { f.objectStates.o_curtain.widthMeters = 20; });
  const onLoadRosterSource = vi.fn().mockResolvedValue(source), onCreate = vi.fn();
  render(<FormationLibrary projects={[summary]} onLoadRosterSource={onLoadRosterSource} onCreate={onCreate}
    onOpenProject={vi.fn()} onRenameProject={vi.fn()} onDuplicateProject={vi.fn()} onExportProject={vi.fn()}
    onImportProjectFile={vi.fn()} onDeleteProject={vi.fn()} />);
  return { source, onLoadRosterSource, onCreate };
}
async function open(mode = "stage") {
  fireEvent.click(screen.getByRole("button", { name: /追加/ })); fireEvent.click(screen.getByRole("button", { name: /新しく作る/ }));
  fireEvent.click(screen.getByRole("button", { name: mode === "stage" ? /ステージ隊列/ : /パレード隊列/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "隊列表名" }), { target: { value: "新大会" } });
}
async function selectSource() {
  fireEvent.change(screen.getByRole("combobox", { name: "名簿をコピー（任意）" }), { target: { value: "source" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "作成する" }).hasAttribute("disabled")).toBe(false));
}
it.each(["stage", "parade"])("shows optional copying outside advanced settings with device title/date/count in %s", async mode => {
  setup(); await open(mode);
  const select = screen.getByRole("combobox", { name: "名簿をコピー（任意）" }) as HTMLSelectElement;
  expect(select.value).toBe(""); expect(select.closest("details")).toBeNull();
  expect(select.options[1].text).toMatch(/去年の大会.*2026.*3人/);
  expect(screen.getByText(/この端末に保存された内容/)).toBeTruthy();
  await selectSource(); expect((screen.getByRole("checkbox", { name: "道具もコピーする" }) as HTMLInputElement).checked).toBe(true);
});
it("opens the card shortcut with source mode and permits changing it", async () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: "去年の大会のメニュー" }));
  fireEvent.click(screen.getByRole("button", { name: "この名簿で新しく作る" }));
  await waitFor(() => expect((screen.getByRole("combobox", { name: "名簿をコピー（任意）" }) as HTMLSelectElement).value).toBe("source"));
  expect((screen.getByRole("combobox", { name: "作成タイプ" }) as HTMLSelectElement).value).toBe("parade");
  fireEvent.change(screen.getByRole("combobox", { name: "作成タイプ" }), { target: { value: "stage" } });
  expect(screen.getByRole("spinbutton", { name: "縦幅" })).toBeTruthy();
});
it("disables copying tools when the source has none", async () => {
  const { onCreate } = setup(false); await open(); await selectSource();
  expect(screen.getByRole("checkbox", { name: "道具もコピーする" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  expect(onCreate.mock.calls[0][0].rosterCopy.includeObjects).toBe(false);
});
it("keeps input on source read failure and retries with the device snapshot", async () => {
  const { onLoadRosterSource, onCreate } = setup(false); await open(); await selectSource();
  onLoadRosterSource.mockRejectedValueOnce(new Error("failed"));
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await screen.findByText(/コピー元の名簿を読み込めませんでした/);
  expect(onCreate).not.toHaveBeenCalled(); expect((screen.getByRole("textbox", { name: "隊列表名" }) as HTMLInputElement).value).toBe("新大会");
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
});
it.each(["shrink", "exclude", "back"])("asks about oversized tools and handles %s while preserving form input", async choice => {
  const { onCreate } = setup(); await open(); await selectSource(); fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  const dialog = await screen.findByRole("dialog", { name: "ステージに入らない道具があります" });
  expect(dialog.textContent).toContain("移動幕：幅20m"); expect(dialog.textContent).toContain("幅12m・奥行き8m"); expect(onCreate).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: choice === "back" ? "戻ってステージの大きさを変える"
    : choice === "shrink" ? "ステージに入る大きさに縮めてコピー" : "入らない道具はコピーしない" }));
  if (choice === "back") {
    expect(onCreate).not.toHaveBeenCalled(); expect((screen.getByRole("textbox", { name: "隊列表名" }) as HTMLInputElement).value).toBe("新大会");
    expect((screen.getByRole("combobox", { name: "名簿をコピー（任意）" }) as HTMLSelectElement).value).toBe("source");
  } else {
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect((onCreate.mock.calls[0][0] as NewFormationInput).rosterCopy?.oversizedPolicy).toBe(choice);
  }
});
it("omits tools when unchecked and prevents duplicate creates during a pending save", async () => {
  const { onCreate } = setup(); await open(); await selectSource();
  fireEvent.click(screen.getByRole("checkbox", { name: "道具もコピーする" }));
  let resolve!: () => void; onCreate.mockReturnValue(new Promise<void>(r => { resolve = r; }));
  fireEvent.submit(screen.getByRole("dialog", { name: "新しい隊列表を作成" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  fireEvent.submit(screen.getByRole("dialog", { name: "新しい隊列表を作成" }));
  expect(onCreate).toHaveBeenCalledOnce(); expect(onCreate.mock.calls[0][0].rosterCopy.includeObjects).toBe(false);
  resolve(); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormationLibrary, type NewFormationInput } from "./FormationLibrary";
import * as diameter from "../utils/memberDiameter";
import { createEmptyFormationProject } from "../project/createEmptyFormationProject";
import { copyRosterToNewProject } from "../project/rosterCopy";
import { createSampleProject } from "../sampleProject";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() {
  const source = createSampleProject(); source.id = "source"; source.stage.memberDiameterMeters = .3;
  const onCreate = vi.fn();
  render(<FormationLibrary projects={[{ id: "source", title: "元の名簿", mode: "stage", memberCount: source.members.length,
    sceneCount: source.frames.length, createdAt: "2026-01-01", updatedAt: "2026-01-01", repositoryRevision: "1", syncStatus: "local" }]}
    onCreate={onCreate} onLoadRosterSource={async () => source} onOpenProject={vi.fn()} onRenameProject={vi.fn()}
    onDuplicateProject={vi.fn()} onExportProject={vi.fn()} onImportProjectFile={vi.fn()} onDeleteProject={vi.fn()} />);
  return { source, onCreate };
}
function open(mode: "stage" | "parade") {
  fireEvent.click(screen.getByRole("button", { name: /追加/ }));
  fireEvent.click(screen.getByRole("button", { name: /新しく作る/ }));
  fireEvent.click(screen.getByRole("radio", { name: mode === "stage" ? /^ステージ隊列/ : /^パレード隊列/ }));
}
it.each(["stage", "parade"] as const)("%s resets to .75 and creates a Project with the chosen form diameter", async mode => {
  const { onCreate } = setup(); open(mode);
  expect(screen.getByText("今の値 0.75m")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "1.0m" }));
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); open(mode);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "0.75m" }).checked).toBe(true);
  fireEvent.submit(screen.getByRole("dialog"));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  const input = onCreate.mock.calls[0][0] as NewFormationInput;
  expect(createEmptyFormationProject(input.title, input, null).stage.memberDiameterMeters).toBe(.75);
});
it.each([.75, .8])("roster copy uses form value %s rather than source .3", async value => {
  const { onCreate, source } = setup(); open("parade");
  if (value === .8) fireEvent.click(screen.getByRole("button", { name: "丸の直径を0.05m大きくする" }));
  fireEvent.change(screen.getByRole("combobox", { name: "名簿をコピー（任意）" }), { target: { value: "source" } });
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "作成する" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("checkbox", { name: "道具もコピーする" }));
  fireEvent.submit(screen.getByRole("dialog"));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  const input = onCreate.mock.calls[0][0] as NewFormationInput;
  let serial = 0;
  const copied = copyRosterToNewProject(createEmptyFormationProject(input.title, input, null), input.rosterCopy!.source,
    { includeObjects: false }, prefix => `${prefix}_${++serial}`).project;
  expect(copied.stage.memberDiameterMeters).toBe(value); expect(source.stage.memberDiameterMeters).toBe(.3);
});
it.each([NaN, Infinity, .3, 1.1])("explicitly validates malformed state %s even without a numeric DOM input", async value => {
  const { onCreate } = setup(); open("stage");
  // Fault injection: a future input regression must not bypass state validation.
  const apply = vi.spyOn(diameter, "applyMemberDiameterAction").mockReturnValue(value);
  fireEvent.click(screen.getByRole("button", { name: "丸の直径を0.05m大きくする" }));
  apply.mockRestore();
  fireEvent.submit(screen.getByRole("dialog"));
  expect(onCreate).not.toHaveBeenCalled();
  await screen.findByRole("alert");
  await waitFor(() => expect(document.querySelector<HTMLDetailsElement>("details")!.open).toBe(true));
  expect(screen.getByRole("group", { name: "メンバーの丸の大きさ（直径）" }).getAttribute("aria-invalid")).toBe("true");
});

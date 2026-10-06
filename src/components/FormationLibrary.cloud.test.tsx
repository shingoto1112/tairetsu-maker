/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormationLibrary } from "./FormationLibrary";
import { createSampleProject } from "../sampleProject";
import { createProjectSummary } from "../project/codec";

afterEach(cleanup);
it.each(["disabled-feature", "local", "shared", "busy"])("home cloud-save menu visibility and fixed ID; %s", variant => {
  const onSaveToCloud = vi.fn();
  const summary = createProjectSummary({ ...createSampleProject(), id: "fixed", title: "架空隊列" }, "1");
  if (variant === "shared") summary.sharing = { documentId: "shared" };
  render(<FormationLibrary projects={[summary]} onCreate={vi.fn()} onOpenProject={vi.fn()}
    onRenameProject={vi.fn()} onDuplicateProject={vi.fn()} onExportProject={vi.fn()} onImportProjectFile={vi.fn()} onDeleteProject={vi.fn()}
    onSaveToCloud={variant === "disabled-feature" ? undefined : onSaveToCloud} cloudSaveBusy={variant === "busy"} />);
  fireEvent.click(screen.getByRole("button", { name: "架空隊列のメニュー" }));
  const button = screen.queryByRole("button", { name: "クラウドに保存" });
  if (variant === "shared" || variant === "disabled-feature") expect(button).toBeNull();
  else if (variant === "busy") expect((button as HTMLButtonElement).disabled).toBe(true);
  else { fireEvent.click(button!); expect(onSaveToCloud).toHaveBeenCalledExactlyOnceWith("fixed"); }
});

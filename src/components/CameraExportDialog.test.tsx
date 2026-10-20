// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CameraExportDialog } from "./CameraExportDialog";
import { formationExportFixture } from "../utils/formationExportFixture";

afterEach(cleanup);
it("offers camera PNG and one-page PDF and closes with Escape", () => {
  const onExport = vi.fn(), onClose = vi.fn();
  render(<CameraExportDialog stage={{ ...formationExportFixture().stage, frontDirection: "top" }} viewerPerspective="performer" onExport={onExport} onClose={onClose} />);
  expect((screen.getByRole("radio", { name: "踊る人側から見た向き" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText(/0mにする/)).toBeNull();
  expect(screen.getByRole("group", { name: "書き出す向き" }).querySelectorAll(".counting-card")).toHaveLength(2);
  expect(screen.getByRole("radio", { name: "踊る人側から見た向き" }).closest("label")?.textContent).toContain("0m（客席側）が下");
  fireEvent.click(screen.getByRole("button", { name: "画像を作成" })); expect(onExport).toHaveBeenLastCalledWith("image", "performer");
  fireEvent.click(screen.getByRole("radio", { name: "観客側から見た向き" }));
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  fireEvent.click(screen.getByRole("button", { name: "PDFを作成" })); expect(onExport).toHaveBeenLastCalledWith("pdf", "audience");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(onClose).toHaveBeenCalledOnce();
});

it("resets to the editor view on remount and leaves parade without direction cards", () => {
  const props = { stage: formationExportFixture().stage, onExport: vi.fn(), onClose: vi.fn() };
  const { unmount } = render(<CameraExportDialog {...props} />);
  expect((screen.getByRole("radio", { name: "観客側から見た向き" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "踊る人側から見た向き" }));
  unmount();
  const { rerender } = render(<CameraExportDialog {...props} />);
  expect((screen.getByRole("radio", { name: "観客側から見た向き" }) as HTMLInputElement).checked).toBe(true);
  rerender(<CameraExportDialog {...props} isParade viewerPerspective="performer" />);
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "画像を作成" }));
  expect(props.onExport).toHaveBeenLastCalledWith("image", "audience");
});

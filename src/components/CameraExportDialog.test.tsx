// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CameraExportDialog } from "./CameraExportDialog";
afterEach(cleanup);
it("offers camera PNG and one-page PDF and closes with Escape", () => {
  const onExport = vi.fn(), onClose = vi.fn();
  render(<CameraExportDialog onExport={onExport} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "画像を作成" })); expect(onExport).toHaveBeenLastCalledWith("image");
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  fireEvent.click(screen.getByRole("button", { name: "PDFを作成" })); expect(onExport).toHaveBeenLastCalledWith("pdf");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(onClose).toHaveBeenCalledOnce();
});

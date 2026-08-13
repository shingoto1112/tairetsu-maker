/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudPasswordModal } from "./CloudPasswordModal";

describe("CloudPasswordModal", () => {
  afterEach(() => cleanup());

  it("validates and submits a recovered password", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({
      message: "変更しました。",
      success: true,
    });

    render(
      <CloudPasswordModal
        isBusy={false}
        mode="recovery"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText("新しいパスワード"), "newpass123");
    await user.type(
      screen.getByLabelText("新しいパスワード（確認）"),
      "different",
    );
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    expect(screen.getByText("新しいパスワードが一致していません。")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("新しいパスワード（確認）"));
    await user.type(
      screen.getByLabelText("新しいパスワード（確認）"),
      "newpass123",
    );
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    expect(onSubmit).toHaveBeenCalledWith("", "newpass123");
  });
});

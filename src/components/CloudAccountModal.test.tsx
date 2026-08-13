/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAccountModal } from "./CloudAccountModal";

describe("CloudAccountModal", () => {
  afterEach(() => cleanup());

  it("requires the current password and an explicit Japanese confirmation", async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn().mockResolvedValue({
      message: "削除しました。",
      success: true,
    });

    render(
      <CloudAccountModal
        displayName="テストユーザー"
        email="test@example.com"
        isBusy={false}
        onClose={vi.fn()}
        onDeleteAccount={onDeleteAccount}
      />,
    );

    const deleteButton = screen.getByRole("button", {
      name: "アカウントを削除",
    });
    expect(deleteButton).toHaveProperty("disabled", true);
    expect(screen.getByText(/ローカル隊列表は削除されません/)).toBeTruthy();

    await user.type(screen.getByLabelText("現在のパスワード"), "password123");
    await user.type(screen.getByLabelText("確認のため「削除」と入力"), "削除");
    expect(deleteButton).toHaveProperty("disabled", false);

    await user.click(deleteButton);
    expect(onDeleteAccount).toHaveBeenCalledWith("password123");
  });
});

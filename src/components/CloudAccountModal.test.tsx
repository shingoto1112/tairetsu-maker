/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAccountModal } from "./CloudAccountModal";

describe("CloudAccountModal", () => {
  afterEach(() => cleanup());

  it("requires the current password and a final confirmation dialog", async () => {
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
    expect(deleteButton).toHaveProperty("disabled", false);

    await user.click(deleteButton);
    expect(onDeleteAccount).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "アカウント削除の確認" }),
    ).toBeTruthy();
    expect(screen.getByText("本当に削除しますか？")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(onDeleteAccount).toHaveBeenCalledWith("password123");
  });
});

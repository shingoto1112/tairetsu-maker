/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_LINKS } from "../config/publicLinks";
import { Toolbar } from "./Toolbar";

type ToolbarRenderOptions = {
  canOpenRosterManager?: boolean;
  canEditProject?: boolean;
  canEditScene?: boolean;
  canSaveProject?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
};

const createHandlers = () => ({
  onBackToLibrary: vi.fn(),
  onClearSelection: vi.fn(),
  onCreateGroup: vi.fn(),
  onMirrorSelection: vi.fn(),
  onOpenMemberTools: vi.fn(),
  onOpenRosterManager: vi.fn(),
  onOpenShareExport: vi.fn(),
  onSaveProject: vi.fn(),
  onTitleChange: vi.fn(),
});

const renderToolbar = (options: ToolbarRenderOptions = {}) => {
  const handlers = createHandlers();

  render(
    <Toolbar
      title="テスト隊列"
      canOpenRosterManager={options.canOpenRosterManager}
      canEditProject={options.canEditProject}
      canEditScene={options.canEditScene}
      canSaveProject={options.canSaveProject}
      isDirty={options.isDirty}
      isSaving={options.isSaving}
      {...handlers}
    />,
  );

  return handlers;
};

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  const menuButton = screen.getByRole("button", { name: "メニューを開く" });

  await user.click(menuButton);

  return menuButton;
};

describe("Toolbar", () => {
  afterEach(() => cleanup());

  it("opens the app menu and focuses the first enabled item", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const menuButton = await openMenu(user);
    const firstItem = screen.getByRole("button", { name: "メンバー/道具の管理" });

    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("メニュー")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(firstItem));
  });

  it("closes the app menu with Escape and returns focus to the menu button", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const menuButton = await openMenu(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByLabelText("メニュー")).toBeNull());
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(menuButton));
  });

  it("closes the app menu when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const menuButton = await openMenu(user);
    const backdrop = document.querySelector<HTMLElement>(".app-menu-backdrop");

    expect(backdrop).toBeTruthy();
    await user.click(backdrop as HTMLElement);

    await waitFor(() => expect(screen.queryByLabelText("メニュー")).toBeNull());
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("runs each menu item handler once and closes the app menu", async () => {
    const user = userEvent.setup();
    const handlers = renderToolbar();
    const items = [
      ["メンバー/道具の管理", handlers.onOpenRosterManager],
      ["隊列表を保存", handlers.onSaveProject],
      ["共有と書き出し", handlers.onOpenShareExport],
      ["選択解除", handlers.onClearSelection],
      ["左右反転", handlers.onMirrorSelection],
      ["グループ作成", handlers.onCreateGroup],
      ["隊列テンプレート", handlers.onOpenMemberTools],
    ] as const;

    for (const [label, handler] of items) {
      await openMenu(user);
      await user.click(screen.getByRole("button", { name: label }));

      expect(handler).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByLabelText("メニュー")).toBeNull());
    }
  });

  it("disables edit and save items when permissions are false", async () => {
    const user = userEvent.setup();
    renderToolbar({
      canOpenRosterManager: false,
      canEditProject: false,
      canEditScene: false,
      canSaveProject: false,
    });

    await openMenu(user);

    const rosterButton = screen.getByRole("button", { name: "メンバー/道具の管理" });
    const saveButton = screen.getAllByRole("button", { name: "隊列表を保存" })[0];
    const mirrorButton = screen.getByRole("button", { name: "左右反転" });
    const groupButton = screen.getByRole("button", { name: "グループ作成" });
    const templateButton = screen.getByRole("button", { name: "隊列テンプレート" });

    expect((rosterButton as HTMLButtonElement).disabled).toBe(true);
    expect(rosterButton.title).toBe("名簿の編集はownerのみ可能です。");
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect((mirrorButton as HTMLButtonElement).disabled).toBe(true);
    expect((groupButton as HTMLButtonElement).disabled).toBe(true);
    expect((templateButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("allows roster access independently of other project editing permissions", async () => {
    const user = userEvent.setup();
    const handlers = renderToolbar({ canEditProject: false });
    await openMenu(user);
    const rosterButton = screen.getByRole("button", { name: "メンバー/道具の管理" });
    expect((rosterButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(rosterButton);
    expect(handlers.onOpenRosterManager).toHaveBeenCalledTimes(1);
  });

  it("renders external support links with safe new-tab attributes", async () => {
    const user = userEvent.setup();
    renderToolbar();

    await openMenu(user);

    const privacyLink = screen.getByRole("link", { name: "プライバシー（新しいタブで開く）" });
    const termsLink = screen.getByRole("link", { name: "利用規約（新しいタブで開く）" });
    const supportLink = screen.getByRole("link", { name: "サポート（新しいタブで開く）" });

    expect(privacyLink.getAttribute("href")).toBe(PUBLIC_LINKS.privacy);
    expect(termsLink.getAttribute("href")).toBe(PUBLIC_LINKS.terms);
    expect(supportLink.getAttribute("href")).toBe(PUBLIC_LINKS.support);

    for (const link of [privacyLink, termsLink, supportLink]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
  });
});

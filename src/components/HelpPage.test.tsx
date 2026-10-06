/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import HelpPage from "./HelpPage";
import { helpSections } from "./helpContent";
import { PUBLIC_LINKS } from "../config/publicLinks";

describe("HelpPage", () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  it.each([false, true])("toggles each section independently; V2=%s", async enabled => {
    vi.stubEnv("VITE_COLLABORATION_V2", enabled ? "1" : "0");
    const user = userEvent.setup();
    render(<HelpPage onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "使い方" });
    const sections = helpSections.filter(section => !section.collaboration || enabled);
    expect(within(dialog).queryByRole("button", { name: "みんなで同時に編集する（共同編集）" }) !== null).toBe(enabled);
    for (const section of sections) {
      const button = within(dialog).getByRole("button", { name: section.title });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      await user.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      const region = within(dialog).getByRole("region", { name: section.title });
      expect(within(region).getAllByRole("listitem")).toHaveLength(section.items.length);
      if (section.collaboration) {
        expect(section.items).toHaveLength(12);
        expect(region.textContent).toContain("現在のパスワードを忘れた場合はサポート");
        expect(region.textContent).toContain("共有先への送信と確認が済んでいます");
        expect(region.textContent).toContain("日時の行を押すと操作が出ます");
        expect(region.textContent).not.toContain("準備中");
      }
      if (section.location) expect(within(region).getByText("場所:")).toBeTruthy();
    }
    const first = within(dialog).getByRole("button", { name: sections[0].title });
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(within(dialog).getByRole("button", { name: sections[1].title }).getAttribute("aria-expanded")).toBe("true");
    expect(within(dialog).getByRole("link", { name: "「サポート」" }).getAttribute("href")).toBe(PUBLIC_LINKS.support);
    expect(dialog.textContent).not.toContain("V字");
  });
  it("focuses close, traps Tab, closes with Escape/button, and restores background and focus", async () => {
    const user = userEvent.setup();
    const launcher = document.createElement("button"); document.body.append(launcher); launcher.focus();
    const onClose = vi.fn(); const view = render(<HelpPage onClose={onClose} />);
    const close = screen.getByRole("button", { name: "使い方を閉じる" });
    expect(document.activeElement).toBe(close);
    expect(launcher.inert).toBe(true);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "困ったとき" }));
    await user.tab(); expect(document.activeElement).toBe(close);
    await user.keyboard("{Escape}"); expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(close); expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount(); expect(document.activeElement).toBe(launcher); expect(launcher.inert).not.toBe(true); launcher.remove();
  });
});

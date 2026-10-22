/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import HelpPage from "./HelpPage";
import { helpSections } from "./helpContent";
import { PUBLIC_LINKS } from "../config/publicLinks";

describe("HelpPage", () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  it.each([false, true])("groups sections under category headings and toggles each section independently; V2=%s", async enabled => {
    vi.stubEnv("VITE_COLLABORATION_V2", enabled ? "1" : "0");
    const user = userEvent.setup();
    render(<HelpPage onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "使い方" });
    const sections = helpSections.filter(section => !section.collaboration || enabled);
    expect(sections).toHaveLength(enabled ? 17 : 15);
    expect(new Set(helpSections.map(section => section.id)).size).toBe(helpSections.length);
    // Category labels (h3, not buttons) in order; the collaboration-free build calls the last one "データ".
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(
      ["準備（名簿）", "シーンと配置", "位置と表示の調整", "書き出す・渡す", enabled ? "データと共同編集" : "データ", "困ったとき"]);
    expect(within(dialog).getAllByRole("heading", { level: 4 }).map(heading => heading.textContent)).toEqual(sections.slice(0, -1).map(section => section.title));
    for (const section of sections) {
      const button = within(dialog).getByRole("button", { name: section.title });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      await user.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      const region = within(dialog).getByRole("region", { name: section.title });
      expect(within(region).getAllByRole("listitem")).toHaveLength(section.items.length);
      if (section.location) expect(within(region).getByText("場所:")).toBeTruthy();
      if (section.id === "collab-start") {
        expect(region.textContent).toContain("このコピーは以後の共同編集を受け取りません");
        expect(region.textContent).toContain("現在のパスワードを忘れた場合はサポート");
      }
      if (section.id === "collab-how") {
        expect(region.textContent).toContain("共有先への送信と確認が済んでいます");
        expect(region.textContent).toContain("日時の行を押すと操作が出ます");
        expect(region.textContent).toContain("戻す直前の状態も自動で残ります");
      }
      expect(region.textContent).not.toContain("準備中");
    }
    expect(within(dialog).queryByRole("button", { name: "共同編集を始める・招待する" }) !== null).toBe(enabled);
    const first = within(dialog).getByRole("button", { name: sections[0].title });
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(within(dialog).getByRole("button", { name: sections[1].title }).getAttribute("aria-expanded")).toBe("true");
    expect(within(dialog).getByRole("link", { name: "「サポート」" }).getAttribute("href")).toBe(PUBLIC_LINKS.support);
    // Removed or merged sections and the PC shortcut list are gone (the keys themselves still work).
    for (const title of ["ショートカット", "座標の見方", "ステージの詳細設定", "効率よく作るには", "シーンごとに色を変える", "みんなで同時に編集する（共同編集）", "名簿をまとめて作る・直す"])
      expect(within(dialog).queryByRole("button", { name: title })).toBeNull();
    for (const text of ["Ctrl/Cmd＋1", "Shift＋矢印", "V字", "「詳細」タブ", "元の小数秒"]) expect(dialog.textContent).not.toContain(text);
    const text = (id: string) => helpSections.find(section => section.id === id)!.items.join("");
    expect(text("coordinates")).toContain("後方はマイナス");
    expect(text("export-a4")).toContain("書き出す向き");
    expect(text("export-a4")).toContain("フォントを入れて作る");
    expect(text("trouble")).toContain("フォントを入れて作る");
    expect(text("export-roster")).toContain("Excel の名簿と同じ");
    expect(text("export-roster")).toContain("7文字以上の名前は2行");
    expect(text("scenes")).toContain("分と秒のダイヤル");
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

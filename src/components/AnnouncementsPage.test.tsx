/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import AnnouncementsPage from "./AnnouncementsPage";
import { useAnnouncements } from "./AnnouncementsPageLoader";
import { LibraryHeader } from "./LibraryHeader";
import { visibleItems, validateFeed } from "../announcements/contract";
import { allowedOrigins } from "../announcements/service";
import draft from "../announcements/announcements.v1.json";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it("shows dates, paragraphs, lists, safe links and new marks; reports displayed IDs", () => {
  const items = visibleItems(validateFeed(draft, allowedOrigins)!);
  items[0].links = [{ label: "安全", url: "https://apps.apple.com/x" }, { label: "危険", url: "https://evil.test" }];
  items[0].body = "段落1\n続き\n\n段落2\n・項目1\n- 項目2\n\n<script>plain</script>";
  const displayed = vi.fn(), close = vi.fn();
  render(<AnnouncementsPage items={items} unreadIds={[items[0].id]} onDisplayed={displayed} onClose={close} />);
  expect(displayed).toHaveBeenCalledWith([items[0].id]);
  expect(screen.getByText("2026年11月14日")).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText("段落2").tagName).toBe("P");
  expect(screen.getByText("<script>plain</script>")).toBeTruthy();
  expect(screen.getByText("新着")).toBeTruthy(); expect(screen.queryByText("危険")).toBeNull();
  expect(screen.getByRole("link").getAttribute("rel")).toBe("noopener noreferrer");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
});
it("shows empty state and closes by button", async () => {
  const close = vi.fn(); render(<AnnouncementsPage items={[]} unreadIds={[]} onDisplayed={vi.fn()} onClose={close} />);
  expect(screen.getByText("お知らせはありません")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "お知らせ一覧を閉じる" })); expect(close).toHaveBeenCalledOnce();
});
it("opens from bell, marks read after display, removes dot and restores focus", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("offline"); }));
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(fn, 0));
  function Home() { const a = useAnnouncements(); return <><LibraryHeader onOpenHelp={() => {}} onOpenAnnouncements={a.openAnnouncements} hasUnreadAnnouncements={a.hasUnread} />{a.announcementsPage}</>; }
  const user = userEvent.setup(); render(<Home />);
  const bell = screen.getByRole("button", { name: "お知らせ（未読あり）" });
  expect(bell.querySelector('[aria-hidden="true"].library-announcements__dot')).toBeTruthy();
  expect(bell.title).toBe("お知らせ（未読あり）");
  await user.click(bell); await screen.findByRole("dialog", { name: "お知らせ" });
  await waitFor(() => expect(bell.getAttribute("aria-label")).toBe("お知らせ"));
  expect(bell.querySelector(".library-announcements__dot")).toBeNull();
  expect(JSON.parse(localStorage.getItem("stageflow.announcements.read.v1")!)).toContain(draft.items[0].id);
  expect((document.querySelector(".library-header")?.closest("body > *") as HTMLElement).inert).toBe(true);
  await user.keyboard("{Escape}"); await waitFor(() => expect(document.activeElement).toBe(bell));
  await user.click(bell); await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "お知らせ一覧を閉じる" }));
  await waitFor(() => expect(document.activeElement).toBe(bell));
});

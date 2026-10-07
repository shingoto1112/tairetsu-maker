/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../repositories/types";
import type { SharedDocumentSummary } from "../collaboration/managementTransport";
import { cloudOnlyDocuments, libraryAccountButton, toCloudLibraryCards, cloudSharingBadge, localSharingBadge } from "../collaboration/libraryCards";
import { FormationLibrary } from "./FormationLibrary";

afterEach(cleanup);

const summary = (id: string, sharing?: ProjectSummary["sharing"]): ProjectSummary => ({
  id, title: `隊列${id}`, mode: "stage", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  memberCount: 3, sceneCount: 2, repositoryRevision: "1", syncStatus: "local", sharing,
});
const cloudDoc = (documentId: string, extra: Partial<SharedDocumentSummary> = {}): SharedDocumentSummary => ({
  documentId, title: `共有${documentId}`, createdAt: "2026-10-02T00:00:00Z", isCreator: true, memberCount: 1, documentSchema: 2, ...extra,
});
const signedIn = { status: "signed-in", userId: "u1", isGuest: false, sessionPersistence: "existing-account" } as const;

describe("cloud-only cards", () => {
  it.each([1, 2, 8, undefined, null])("uses the same badge wording locally and in the cloud: %s", count => {
    const expected = count && count >= 2 ? `共有中・${count}人` : "クラウド";
    expect(cloudSharingBadge(count)).toBe(expected);
    const documents = count == null ? [] : [cloudDoc("d1", { memberCount: count })];
    expect(localSharingBadge(summary("a", { accountId: "u1", documentId: "d1" }), documents, signedIn)).toBe(expected);
    if (documents.length) expect(toCloudLibraryCards(documents, [], signedIn)[0].badge).toBe(expected);
    expect(localSharingBadge(summary("a", { accountId: "u1", documentId: "different" }), documents, signedIn)).toBe("クラウド");
    expect(localSharingBadge(summary("a", { accountId: "u1", documentId: "d1" }), documents, signedIn, false)).toBe("クラウド");
    if (documents.length) expect(toCloudLibraryCards(documents, [], signedIn, false)[0].badge).toBe("クラウド");
  });
  it("hides documents this account already stores on the device, by account and documentId", () => {
    const summaries = [summary("a", { documentId: "d1", accountId: "u1" }), summary("b", { documentId: "d2", accountId: "other" })];
    expect(cloudOnlyDocuments([cloudDoc("d1"), cloudDoc("d2"), cloudDoc("d3")], summaries, "u1").map((item) => item.documentId))
      .toEqual(["d2", "d3"]);
  });

  it("builds metadata-only cards and marks other schemas as not openable", () => {
    const cards = toCloudLibraryCards([cloudDoc("d1"), cloudDoc("d2", { memberCount: 3, isCreator: false, documentSchema: 1 })], [], signedIn);
    expect(cards[0]).toMatchObject({ badge: "クラウド", openable: true, note: "この端末に取り込んで開く" });
    expect(cards[0].detail).toContain("自分が作成");
    expect(cards[1]).toMatchObject({ badge: "共有中・3人", openable: false, note: "このアプリでは開けない形式です" });
    expect(cards[1].detail).toContain("参加中");
    expect(toCloudLibraryCards([cloudDoc("d1")], [], { status: "signed-out", guestRecovery: "new-invite-required" })).toEqual([]);
  });

  it("keeps the account button neutral until sign-in is known", () => {
    expect(libraryAccountButton(undefined)).toEqual({ label: "アカウント", pending: true });
    expect(libraryAccountButton({ status: "restoring" })).toEqual({ label: "アカウント", pending: true });
    expect(libraryAccountButton(undefined, true)).toEqual({ label: "アカウント", pending: false });
    expect(libraryAccountButton(signedIn)).toEqual({ label: "アカウント", pending: false });
    expect(libraryAccountButton({ status: "signed-out", guestRecovery: "new-invite-required" })).toEqual({ label: "ログイン", pending: false });
  });
});

const baseProps = () => ({
  projects: [summary("a"), summary("b")],
  onCreate: vi.fn(), onOpenProject: vi.fn(), onRenameProject: vi.fn(), onDuplicateProject: vi.fn(),
  onExportProject: vi.fn(), onImportProjectFile: vi.fn(), onDeleteProject: vi.fn(),
});

describe("home layout", () => {
  it("puts 使い方, account and a … popover in the header; Escape closes it and returns focus", async () => {
    const onOpenHelp = vi.fn(), onAccount = vi.fn(), onOpenStorageManager = vi.fn(), onRefreshCloud = vi.fn();
    render(<FormationLibrary {...baseProps()} onOpenHelp={onOpenHelp} account={{ label: "ログイン", pending: false, onClick: onAccount }}
      onOpenStorageManager={onOpenStorageManager} onRefreshCloud={onRefreshCloud} />);
    const header = screen.getByRole("banner");
    await userEvent.click(within(header).getByRole("button", { name: "使い方" }));
    await userEvent.click(within(header).getByRole("button", { name: "ログイン" }));
    expect(onOpenHelp).toHaveBeenCalledTimes(1); expect(onAccount).toHaveBeenCalledTimes(1);
    const more = within(header).getByRole("button", { name: "ホームのその他の操作" });
    await userEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["プライバシー", "利用規約", "サポート"]) expect(within(header).getByRole("link", { name })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
    await userEvent.click(more);
    await userEvent.click(within(header).getByRole("button", { name: "保存データの管理" }));
    expect(onOpenStorageManager).toHaveBeenCalledTimes(1);
    await userEvent.click(more);
    await userEvent.click(within(header).getByRole("button", { name: "クラウドの一覧を更新" }));
    expect(onRefreshCloud).toHaveBeenCalledTimes(1);
    // 使い方 lives in the header, so the footer keeps only the policy links.
    expect(within(screen.getByRole("navigation", { name: "規約とサポート" })).queryByRole("button", { name: "使い方" })).toBeNull();
  });

  it("shows a pending account button as disabled", () => {
    render(<FormationLibrary {...baseProps()} account={{ label: "アカウント", pending: true, onClick: vi.fn() }} />);
    expect((screen.getByRole("button", { name: "アカウント" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps open and … as sibling buttons and draws the preview slot", async () => {
    const props = baseProps();
    render(<FormationLibrary {...props} renderProjectPreview={(project) => <svg data-testid={`preview-${project.id}`} />} />);
    const open = screen.getByRole("button", { name: "隊列aを開く" });
    const menu = screen.getByRole("button", { name: "隊列aのメニュー" });
    expect(open.contains(menu)).toBe(false);
    expect(within(open).getByTestId("preview-a")).toBeTruthy();
    fireEvent.keyDown(menu, { key: "Enter" });
    await userEvent.click(menu);
    expect(props.onOpenProject).not.toHaveBeenCalled();
    await userEvent.click(open);
    expect(props.onOpenProject).toHaveBeenCalledWith("a");
  });

  it("lists cloud-only formations after local ones and opens them from the card", async () => {
    const onOpenCloudProject = vi.fn(), onLoadMoreCloud = vi.fn();
    const cloudProjects = toCloudLibraryCards([cloudDoc("d1"), cloudDoc("d2", { documentSchema: 1 })], [], signedIn);
    render(<FormationLibrary {...baseProps()} cloudProjects={cloudProjects} onOpenCloudProject={onOpenCloudProject} onLoadMoreCloud={onLoadMoreCloud} />);
    const grid = screen.getByRole("region", { name: "隊列表一覧" });
    const names = within(grid).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names.indexOf("共有d1をクラウドから開く")).toBeGreaterThan(names.indexOf("隊列bを開く"));
    const cloudCard = within(grid).getByRole("button", { name: "共有d1をクラウドから開く" });
    expect(document.getElementById(cloudCard.getAttribute("aria-describedby")!)?.textContent).toContain("この端末に取り込んで開く");
    await userEvent.click(cloudCard);
    expect(onOpenCloudProject).toHaveBeenCalledWith("d1");
    expect((within(grid).getByRole("button", { name: "共有d2をクラウドから開く" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "クラウドの続きを表示" }));
    expect(onLoadMoreCloud).toHaveBeenCalledTimes(1);
  });
});

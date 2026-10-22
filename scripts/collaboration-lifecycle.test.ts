import { describe, it, expect, vi } from "vitest";
import projects from "../src/repositories/contract/fixtures/commitProjects.json";
import type { Project } from "../src/types";
import type { CloudAuthSession } from "../src/cloud/auth";
import { MemoryProjectRepository } from "../src/repositories/contract/testing/MemoryProjectRepository";
import { RepositoryError } from "../src/repositories/types";
import { SaveCoordinator } from "../src/storage/saveCoordinator";
import { SharedProjectEditor } from "../src/collaboration/editorSession";
import { CollaborationLifecycle } from "../src/collaboration/lifecycle";
import { createParticipantAuth } from "../src/collaboration/guestAuth";
import { createManagementTransport, parseMembershipReceipt, parseAccessStatus } from "../src/collaboration/managementTransport";
import { createHttpTransport } from "../src/collaboration/supabaseTransport";
import { invitationLink, invitationToken, invitationEntry, takeInvitationLink } from "../src/collaboration/invitations";
import { createCollaborationAccountApi } from "../src/collaboration/account";
import { createHandler, RpcError } from "../supabase/functions/collab-ingest/handler";
import { MockCollabBackend, actors, documentId } from "./testing/mock-collab-server.mjs";

const signal = () => new AbortController().signal;
const config = { url: "http://127.0.0.1:9999", anonKey: "mock-public" };
function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), key: n => [...values.keys()][n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
async function setup() {
  const backend = new MockCollabBackend(null, RpcError, { fresh: true }), edge = createHandler(backend, []);
  const calls: { path: string; body: Record<string, unknown>; actor: string }[] = [];
  const fetcher = (async (url, init) => {
    const request = new Request(String(url), init), path = new URL(request.url).pathname, body = JSON.parse(init!.body as string);
    const actor = request.headers.get("Authorization")!.slice(7); calls.push({ path, body, actor });
    if (path === "/auth/v1/signup") return Response.json(backend.guest((body.data as { display_name: string }).display_name));
    if (!await backend.authenticate(actor)) return Response.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    if (path.includes("collab-ingest")) return edge(request);
    try { return Response.json(await backend.rpc(path.split("/").at(-1), { ...body, p_actor: actor })); }
    catch (error) { const e = error as RpcError; return Response.json({ message: e.message, code: e.code }, { status: e.code === "42501" ? 403 : 400 }); }
  }) as typeof fetch;
  const repository = new MemoryProjectRepository(); await repository.initialize();
  await repository.commit({ project: projects.stage as Project, expectedRepositoryRevision: null, localRevision: "1", operationId: "seed" });
  const management = createManagementTransport(config, fetcher);
  const client = (actor: string | null, platform: "web" | "ipad" = "web", guest = false) => {
    let current: CloudAuthSession | null = actor ? { accessToken: actor, refreshToken: "mock-refresh", expiresAt: Date.now() + 3600000,
      tokenType: "bearer", user: { id: actor, displayName: "通常利用者" } } : null;
    const guestStorage = storage();
    const auth = createParticipantAuth(config, platform, { fetcher, storage: guestStorage, read: () => current, save: value => { current = value; }, clear: () => { current = null; } });
    const transport = createHttpTransport(config, auth.credential, async () => () => {}, fetcher);
    const lifecycle = new CollaborationLifecycle(repository, management, transport, { invitationBaseUrl: "https://app.example.invalid/", allowedOrigins: ["https://app.example.invalid"], platform, ...(guest ? { auth } : {}) });
    return { lifecycle, auth, transport, storage: guestStorage, session: () => current, forgetSession: () => { current = null; } };
  };
  return { backend, repository, calls, client, creator: client(actors[0]) };
}

describe("sharing lifecycle API", () => {
  it.each(['DOCUMENT_QUOTA_EXCEEDED','PROJECT_QUOTA_EXCEEDED','QUOTA_EXCEEDED'])("keeps durable creation bytes and unsent edits across %s without automatic retry", async code => {
    const s = await setup(), rpc = s.backend.rpc.bind(s.backend);
    const requests: unknown[] = [];
    vi.spyOn(s.backend, 'rpc').mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'collab_v2_create_document') { requests.push(structuredClone(args)); throw new RpcError('54000', code); }
      return rpc(name, args);
    });
    await expect(s.creator.lifecycle.startSharing('project_a', '作成者')).rejects.toMatchObject({ code });
    expect(requests).toHaveLength(1);
    const first = (await s.repository.get('project_a'))!;
    expect(first.collaboration?.base).toBeTruthy();
    // Restart the lifecycle owner; the repository retains the fixed Y.Doc.
    await expect(s.client(actors[0]).lifecycle.startSharing('project_a', '作成者')).rejects.toMatchObject({ code });
    expect(requests[1]).toEqual(requests[0]);
    expect((await s.repository.get('project_a'))?.collaboration).toEqual(first.collaboration);
    const coordinator = new SaveCoordinator(s.repository, () => {}); coordinator.activate(first);
    const editor = await SharedProjectEditor.create(coordinator, first.project, () => {}, () => {});
    editor.edit(p => ({ ...p, title: '容量拒否後の端末編集' })); await coordinator.flush(); editor.destroy();
    const edited = (await s.repository.get('project_a'))!;
    await expect(s.creator.lifecycle.startSharing('project_a', '作成者')).rejects.toMatchObject({ code });
    expect((await s.repository.get('project_a'))?.collaboration).toEqual(edited.collaboration);
    expect((await s.repository.get('project_a'))?.project.title).toBe('容量拒否後の端末編集');
    expect(edited.collaboration?.outbox.length).toBeGreaterThan(0);
    expect(edited.collaboration?.base).toEqual(first.collaboration?.base);
    expect(requests).toHaveLength(3);
  });
  it("uses one 7-day link for multiple people and replays only the current membership after expiry/revocation", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const link = await s.creator.lifecycle.createInvite(documentId);
    const invite = [...s.backend.invites.values()].find(i => i.inviteId === link.inviteId)!;
    expect(invite.multiUse).toBe(true); expect(invite.expiresAt - invite.issuedAt).toBe(7 * 86400000);
    const a = s.client(actors[1]), b = s.client(s.backend.guest("二人目").user.id);
    const [first, second] = await Promise.all([a.lifecycle.prepareJoin(link.link,"一人目"),b.lifecycle.prepareJoin(link.link,"二人目")]);
    expect(first.collaboration).not.toBeNull(); expect(second.collaboration).not.toBeNull();
    expect(invite.uses.size).toBe(2); expect(s.backend.members.size).toBe(3);
    const acl = s.backend.acl;
    await a.lifecycle.prepareJoin(link.link,"変更しない名前");
    expect(invite.uses.size).toBe(2); expect(s.backend.acl).toBe(acl);
    expect(s.backend.details.get(actors[1]).displayName).toBe("一人目");
    invite.expiresAt = Date.now()-1; invite.revoked = true;
    expect((await a.lifecycle.prepareJoin(link.link,"再送")).collaboration?.transportBinding)
      .toEqual(first.collaboration?.transportBinding);
    expect(s.backend.acl).toBe(acl);
    await s.creator.lifecycle.removeMember(documentId,actors[1]);
    await expect(a.lifecycle.prepareJoin(link.link,"再参加")).rejects.toMatchObject({code:"INVALID_INVITE"});
    const next = await s.creator.lifecycle.createInvite(documentId);
    await a.lifecycle.prepareJoin(next.link,"新しい資格");
    await expect(a.lifecycle.prepareJoin(link.link,"古いリンク")).rejects.toMatchObject({code:"INVALID_INVITE"});
  });
  it("lists lightweight current membership and resumes exact local attachments without consuming invitations", async () => {
    const s = await setup(); const record = await s.creator.lifecycle.startSharing("project_a", "作成者");
    expect((await s.creator.lifecycle.listMyDocuments()).items[0]).toMatchObject({ documentId, isCreator: true, memberCount: 1, title: record.project.title });
    const coordinator = new SaveCoordinator(s.repository, () => {}); coordinator.activate(record);
    const editor = await SharedProjectEditor.create(coordinator, record.project, () => {}, () => {});
    editor.edit(p => ({ ...p, title: "まだ送信していない題名" })); await coordinator.flush(); editor.destroy();
    const before = s.calls.filter(c => c.path.endsWith("collab_v2_join")).length;
    const resumed = await s.creator.lifecycle.openExisting(documentId);
    expect("record" in resumed && resumed.record.project.title).toBe("まだ送信していない題名");
    expect(s.calls.filter(c => c.path.endsWith("collab_v2_join"))).toHaveLength(before);
    expect(await s.client(actors[1]).lifecycle.listMyDocuments()).toMatchObject({ items: [] });
    await expect(s.client(actors[1]).lifecycle.openExisting(documentId)).rejects.toMatchObject({ code: "NOT_MEMBER" });
  });
  it("creates a new fixed alias on a new device and holds it across commit failure", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const repository = new MemoryProjectRepository(); await repository.initialize();
    const management = createManagementTransport(config, (async (url, init) => {
      const body = JSON.parse(init!.body as string); return Response.json(await s.backend.rpc(new URL(String(url)).pathname.split('/').at(-1), { ...body, p_actor: actors[0] }));
    }) as typeof fetch);
    const lifecycle = new CollaborationLifecycle(repository, management, s.creator.transport, { platform: "web", invitationBaseUrl: "https://app.example.invalid", allowedOrigins: ["https://app.example.invalid"] });
    const prepared = await lifecycle.openExisting(documentId); if (!("request" in prepared)) throw new Error("Expected request");
    const fixed = prepared.request; expect(fixed.project.id).not.toBe("project_a");
    const commit = vi.spyOn(repository, "commit").mockRejectedValueOnce(new RepositoryError("IO_ERROR"));
    await expect(lifecycle.saveJoinedProject(fixed)).rejects.toMatchObject({ code: "IO_ERROR" });
    const saved = await lifecycle.saveJoinedProject(fixed); expect(commit.mock.calls[0][0]).toEqual(commit.mock.calls[1][0]);
    expect(await lifecycle.openExisting(documentId)).toMatchObject({ record: { project: { id: saved.project.id } } });
    expect(s.backend.managementCalls.filter(n => n === "collab_v2_join")).toHaveLength(0);
  });
  it("rejects removal, account replacement and generation changes during existing-document retrieval", async () => {
    for (const change of ["removed", "membership", "generation", "account"] as const) {
      const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
      const repository = new MemoryProjectRepository(); await repository.initialize();
      const transport = { ...s.creator.transport, pull: async (...args: Parameters<typeof s.creator.transport.pull>) => {
        const page = await s.creator.transport.pull(...args);
        if (change === "removed") s.backend.members.delete(actors[0]);
        if (change === "membership") s.backend.rotate(actors[0], true);
        if (change === "generation") s.backend.generation = "2";
        if (change === "account") s.creator.forgetSession();
        return page;
      } };
      const management = createManagementTransport(config, (async (url, init) => {
        const body = JSON.parse(init!.body as string);
        try { return Response.json(await s.backend.rpc(new URL(String(url)).pathname.split('/').at(-1), { ...body, p_actor: actors[0] })); }
        catch { return Response.json({message:'NOT_MEMBER'}, {status:403}); }
      }) as typeof fetch);
      const lifecycle = new CollaborationLifecycle(repository, management, transport, { platform: "web", invitationBaseUrl: "https://app.example.invalid", allowedOrigins: ["https://app.example.invalid"] });
      await expect(lifecycle.openExisting(documentId)).rejects.toBeInstanceOf(Error); expect((await repository.list({limit:100})).items).toEqual([]);
    }
  });
  it("creates through validated Edge, durably binds, reuses initial bytes after a lost reply", async () => {
    const s = await setup(), create = s.creator.lifecycle.startSharing("project_a", "作成者");
    const record = await create;
    expect(record.collaboration).toMatchObject({ sharedDocumentId: documentId, transportBinding: { accountId: actors[0] } });
    expect(s.calls[0].path).toBe("/functions/v1/collab-ingest");
    await expect(s.creator.lifecycle.startSharing("project_a", "作成者")).rejects.toMatchObject({ code: "ALREADY_SHARED" });
    const retry = await setup(), real = retry.creator.transport;
    const management = createManagementTransport(config, (async () => { throw new Error("reply lost"); }) as typeof fetch);
    const failing = new CollaborationLifecycle(retry.repository, management, real, { platform: "web", allowedOrigins: [], invitationBaseUrl: "https://app.example.invalid" });
    await expect(failing.startSharing("project_a", "作成者")).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    const before = (await retry.repository.get("project_a"))!.collaboration!.base;
    expect((await retry.creator.lifecycle.startSharing("project_a", "作成者")).collaboration!.base).toBe(before);
  });
  it("joins as Web guest, stores a fresh local alias, edits without changing creator CRDT IDs", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const invite = await s.creator.lifecycle.createInvite(documentId), guest = s.client(null, "web", true);
    const pending = await guest.lifecycle.prepareJoin(invite.link, "ゲスト");
    expect(pending.project.id).not.toBe("project_a"); expect(pending.project.audio).toBeUndefined();
    expect(pending.collaboration?.outbox).toEqual([]);
    const record = await guest.lifecycle.saveJoinedProject(pending);
    const coordinator = new SaveCoordinator(s.repository, () => {}); coordinator.activate(record);
    const editor = await SharedProjectEditor.create(coordinator, record.project, () => {}, () => {});
    editor.edit(p => ({ ...p, title: "参加者が編集" })); await coordinator.flush(); editor.destroy();
    expect((await s.repository.get(record.project.id!))!.project.title).toBe("参加者が編集");
    expect((await guest.lifecycle.members(documentId)).find(m => m.isGuest)?.displayName).toBe("ゲスト");
    expect(s.calls.filter(c => c.path === "/auth/v1/signup")).toHaveLength(1);
  });
  it("retains a fixed participation commit across storage failure and can retry the consumed invite", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const invite = await s.creator.lifecycle.createInvite(documentId), participant = s.client(actors[1]);
    const request = await participant.lifecycle.prepareJoin(invite.link, "参加者");
    const failing = vi.spyOn(s.repository, "commit").mockRejectedValueOnce(new RepositoryError("NO_SPACE"));
    await expect(participant.lifecycle.saveJoinedProject(request)).rejects.toMatchObject({ code: "NO_SPACE" });
    const saved = await participant.lifecycle.saveJoinedProject(request); failing.mockRestore();
    expect(saved.collaboration).toEqual(request.collaboration);
    expect((await participant.lifecycle.prepareJoin(invite.link, "参加者")).collaboration?.transportBinding).toEqual(request.collaboration?.transportBinding);
    expect(s.backend.members.size).toBe(2);
  });
  it("protects creator, lets any member manage/leave, preserves copies and old outbox on rejoin", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const participant = s.client(actors[1]), invite = await s.creator.lifecycle.createInvite(documentId);
    const old = await participant.lifecycle.saveJoinedProject(await participant.lifecycle.prepareJoin(invite.link, "参加者"));
    const coordinator = new SaveCoordinator(s.repository, () => {}); coordinator.activate(old);
    const editor = await SharedProjectEditor.create(coordinator, old.project, () => {}, () => {});
    editor.edit(p => ({ ...p, title: "未送信" })); await coordinator.flush(); editor.destroy();
    const issued = await participant.lifecycle.createInvite(documentId);
    await expect(participant.lifecycle.removeMember(documentId, actors[0])).rejects.toMatchObject({ code: "CREATOR_PROTECTED" });
    await expect(s.creator.lifecycle.leave(documentId)).rejects.toMatchObject({ code: "CREATOR_PROTECTED" });
    await expect(participant.lifecycle.deleteSharedDocument(documentId)).rejects.toMatchObject({ code: "CREATOR_ONLY" });
    await participant.lifecycle.leave(documentId);
    expect((await participant.lifecycle.state(old.project.id!)).status).toBe("removed");
    const outsider = s.client(s.backend.guest("別人").user.id);
    await expect(outsider.lifecycle.prepareJoin(issued.link, "別人")).rejects.toMatchObject({ code: "INVALID_INVITE" });
    const rescue = await participant.lifecycle.prepareIndependentCopy(old.project.id!); await s.repository.commit(rescue);
    expect(rescue.project.title).toBe("未送信"); expect(rescue.collaboration).toBeNull();
    const again = await participant.lifecycle.saveJoinedProject(await participant.lifecycle.prepareJoin((await s.creator.lifecycle.createInvite(documentId)).link, "参加者"));
    expect(again.project.id).not.toBe(old.project.id);
    expect((await participant.lifecycle.state(old.project.id!)).status).toBe("membership-changed");
    expect((await s.repository.get(old.project.id!))!.collaboration!.outbox[0].status).toBe("pending");
    expect(again.collaboration!.outbox).toEqual([]);
    await s.creator.lifecycle.deleteSharedDocument(documentId);
    expect((await participant.lifecycle.state(again.project.id!)).message).toContain("共有が終了しました。この端末のコピーは残っています");
    expect(await s.repository.get(again.project.id!)).not.toBeNull();
    await participant.lifecycle.removeLocalCopy(again.project.id!, again.repositoryRevision, crypto.randomUUID());
    expect(await s.repository.get(old.project.id!)).not.toBeNull();
  });
  it("creator account deletion ends sharing and rejects the deleted user's old token", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const participant = s.client(actors[1]), request = await participant.lifecycle.prepareJoin((await s.creator.lifecycle.createInvite(documentId)).link, "参加者");
    const record = await participant.lifecycle.saveJoinedProject(request);
    s.backend.deleteAccount(actors[0]);
    expect((await participant.lifecycle.state(record.project.id!)).status).toBe("ended");
    await expect(s.creator.lifecycle.members(documentId)).rejects.toMatchObject({ kind: "auth" });
  });
  it("account API requires confirmation and fresh password login, then deletes via existing RPC without touching local copies", async () => {
    const s = await setup(); const shared = await s.creator.lifecycle.startSharing("project_a", "作成者");
    let current = { ...s.creator.session()!, user: { id: actors[0], email: "owner@example.invalid" } } as CloudAuthSession | null;
    const reauthenticate = vi.fn(async () => ({ ...current!, accessToken: "fresh-token" }));
    const deleted = vi.fn(async token => { expect(token).toBe("fresh-token"); s.backend.deleteAccount(actors[0]); return { success: true, reason: "ok", deleted_project_count: 0, transferred_project_count: 0 }; });
    const api = createCollaborationAccountApi(config, { read: () => current, save: value => { current = value; }, clear: () => { current = null; }, reauthenticate, deleteCurrentAccount: deleted });
    await expect(api.deleteAccountWithPassword("password", null as unknown as "DELETE_MY_ACCOUNT")).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(reauthenticate).not.toHaveBeenCalled();
    expect((await api.deleteAccountWithPassword("password", "DELETE_MY_ACCOUNT")).localCopiesRetained).toBe(true);
    expect(current).toBeNull(); expect(await s.repository.get(shared.project.id!)).not.toBeNull();
  });
  it("iPad paste requires an account; signed-in participation never starts guest auth", async () => {
    const s = await setup(); await s.creator.lifecycle.startSharing("project_a", "作成者");
    const invite = await s.creator.lifecycle.createInvite(documentId);
    await expect(s.client(null, "ipad", true).lifecycle.prepareJoin(invite.link, "参加者")).rejects.toMatchObject({ code: "IPAD_ACCOUNT_REQUIRED" });
    await s.client(actors[1], "ipad", true).lifecycle.prepareJoin(invite.link, "参加者");
    expect(s.calls.some(c => c.path === "/auth/v1/signup")).toBe(false);
  });
});

describe("invitation and guest boundaries", () => {
  const token = "a".repeat(64), link = `https://app.example.invalid/#invite=${token}`, origins = ["https://app.example.invalid"];
  it("accepts fragment-only links and provides a content-free Web/iPad route description", () => {
    expect(invitationLink("https://app.example.invalid/?tracking=1", token)).toBe(link);
    expect(invitationToken(link, origins)).toBe(token);
    expect(invitationEntry(link, origins, "ipad", false).action).toBe("sign-in");
    expect(invitationEntry(link, origins, "web", false).action).toBe("guest-name");
    const replaceState = vi.fn();
    expect(takeInvitationLink(origins, { location: { href: link }, history: { state: null, replaceState } } as unknown as Pick<Window, "location" | "history">)).toBe(link);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://app.example.invalid/");
  });
  it.each([`https://evil.invalid/#invite=${token}`, `https://app.example.invalid/?invite=${token}`, `${link}&invite=${token}`, `https://u:p@app.example.invalid/#invite=${token}`, "javascript:alert(1)"])("rejects unsafe/malformed link %s", value => {
    expect(() => invitationToken(value, origins)).toThrow("INVALID_INVITE_LINK");
  });
  it("rejects malformed management data rather than assuming permissions", () => {
    expect(() => parseMembershipReceipt({ documentId })).toThrow();
    expect(() => parseAccessStatus({ status: "active", membershipGeneration: "bad" })).toThrow();
    expect(() => parseAccessStatus({ status: "missing" })).toThrow();
  });
  it("persists Web guest across restart, shares refresh, preserves display name, and reports lost browser identity", async () => {
    const persisted = storage(); let current: CloudAuthSession | null = null;
    const actor = actors[1], fetcher = vi.fn(async () => Response.json({ access_token: actor, refresh_token: "guest-refresh", expires_in: 3600,
      user: { id: actor, is_anonymous: true } })) as unknown as typeof fetch;
    const refresh = vi.fn(async () => ({ ...current!, accessToken: "new-token", expiresAt: Date.now() + 3600000, user: { id: actor } }));
    const options = { storage: persisted, fetcher, read: () => current, save: (value: CloudAuthSession) => { current = value; }, refresh };
    const first = createParticipantAuth(config, "web", options); await first.beginGuest("ゲスト", signal(), "captcha-value");
    expect(JSON.parse((fetcher as ReturnType<typeof vi.fn>).mock.calls[0][1].body).gotrue_meta_security.captcha_token).toBe("captcha-value");
    current = null; const restarted = createParticipantAuth(config, "web", options);
    expect(restarted.state()).toMatchObject({ isGuest: true, sessionPersistence: "browser-data", displayName: "ゲスト" });
    current!.expiresAt = 0;
    await Promise.all([restarted.credential(signal()), restarted.credential(signal())]);
    expect(refresh).toHaveBeenCalledTimes(1); expect(restarted.state()).toMatchObject({ isGuest: true });
    current = null; persisted.clear(); expect(restarted.state()).toMatchObject({ status: "signed-out", guestRecovery: "new-invite-required" });
    await expect(createParticipantAuth(config, "ipad", options).beginGuest("ゲスト", signal())).rejects.toMatchObject({ code: "IPAD_ACCOUNT_REQUIRED" });
  });
});

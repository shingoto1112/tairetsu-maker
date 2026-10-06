// DEV-only, imported by an inert Playwright route. Never imported by App.
import projects from "../../repositories/contract/fixtures/commitProjects.json";
import type { Project } from "../../types";
import type { AnnotationLine } from "../../types";
import { IndexedDbProjectRepository } from "../../repositories/indexedDbRepository";
import { SaveCoordinator } from "../../storage/saveCoordinator";
import { readCloudAuthSession, saveCloudAuthSession } from "../../cloud/session";
import { createParticipantAuth } from "../guestAuth";
import { createManagementTransport } from "../managementTransport";
import { createHttpTransport } from "../supabaseTransport";
import { CollaborationLifecycle } from "../lifecycle";
import { CollaborationProvider } from "../provider";
import { SharedProjectEditor } from "../editorSession";

export async function createLifecycleHarness(options: { url: string; actor?: string; dbName: string; localId?: string }) {
  if (!import.meta.env.DEV || new URL(options.url).hostname !== "127.0.0.1" || new URL(options.url).protocol !== "http:") throw new Error("Loopback DEV harness only");
  const config = { url: options.url, anonKey: "mock-public-key" };
  if (options.actor && !readCloudAuthSession()) saveCloudAuthSession({ accessToken: options.actor, refreshToken: "mock-refresh", tokenType: "bearer",
    expiresAt: Date.now() + 3600000, user: { id: options.actor, displayName: "作成者" } });
  const auth = createParticipantAuth(config, "web"), repository = new IndexedDbProjectRepository({ dbName: options.dbName });
  await repository.initialize();
  const transport = createHttpTransport(config, auth.credential, async (topic, credential, notice, status) => {
    const events = new EventSource(`${options.url}/events?topic=${encodeURIComponent(topic)}&actor=${encodeURIComponent(credential.accountId)}`);
    events.onmessage = event => notice(JSON.parse(event.data)); events.onopen = () => status(true); events.onerror = () => status(false);
    return () => events.close();
  });
  const management = createManagementTransport(config), settings = { platform: "web" as const, invitationBaseUrl: "https://app.example.invalid/", allowedOrigins: ["https://app.example.invalid"], auth };
  const lifecycle = new CollaborationLifecycle(repository, management, transport, settings);
  let coordinator: SaveCoordinator | null = null, provider: CollaborationProvider | null = null, editor: SharedProjectEditor | null = null, localId = options.localId;
  const activate = async (id: string) => {
    provider?.stop(); editor?.destroy(); localId = id;
    const record = await repository.get(id); if (!record) throw new Error("Missing test record");
    coordinator = new SaveCoordinator(repository, () => { editor?.receiveDurable(); }); coordinator.activate(record);
    editor = await SharedProjectEditor.create(coordinator, record.project, () => {}, error => { throw error; });
    const current = new CollaborationProvider(coordinator, transport, { pollMs: 150, backoffMs: 30 }); provider = current;
    // Same wiring as SharedSessionController: durable commits refresh the pending count.
    coordinator.subscribeCommits(event => { if (event.id === id) current.committedPending(event.pendingCount); });
    current.start();
  };
  if (localId) await activate(localId);
  return {
    async startSharing() {
      await repository.commit({ project: projects.stage as Project, expectedRepositoryRevision: null, localRevision: "1", operationId: crypto.randomUUID() });
      const record = await lifecycle.startSharing("project_a", "作成者"); await activate(record.project.id!); return record;
    },
    invite: (documentId: string) => lifecycle.createInvite(documentId),
    revoke: (documentId: string, inviteId: string) => lifecycle.revokeInvite(documentId, inviteId),
    async join(link: string) {
      const fixed = await lifecycle.prepareJoin(link, "Webゲスト"); const record = await lifecycle.saveJoinedProject(fixed);
      await activate(record.project.id!); return record;
    },
    async joinExtra(link: string) {
      // Separate simulated Auth identity; never replace this browser's participant.
      let session: ReturnType<typeof readCloudAuthSession> = null;
      const memory = new Map<string, string>();
      const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } } as Storage;
      const extraAuth = createParticipantAuth(config, "web", { storage, read: () => session, save: value => { session = value; } });
      const extraTransport = createHttpTransport(config, extraAuth.credential, async () => () => {});
      const extra = new CollaborationLifecycle(repository, management, extraTransport, { ...settings, auth: extraAuth });
      try { await extra.prepareJoin(link, "追加ゲスト"); return { joined: true }; }
      catch (error) { return { joined: false, code: (error as { code: string }).code }; }
    },
    auth: () => auth.state(), id: () => localId,
    members: (documentId: string) => lifecycle.members(documentId),
    remove: (documentId: string, userId: string) => lifecycle.removeMember(documentId, userId),
    leave: (documentId: string) => lifecycle.leave(documentId),
    deleteShared: (documentId: string) => lifecycle.deleteSharedDocument(documentId),
    async move(memberId: string, x: number) {
      editor!.edit(p => ({ ...p, frames: p.frames.map((f, i) => i ? f : { ...f, positions: { ...f.positions, [memberId]: { x, y: 2 } } }) }));
      if (!await coordinator!.flush()) throw new Error("Test local flush failed"); provider!.wake();
    },
    async line(id: string, line: AnnotationLine | null) {
      editor!.edit(p => ({ ...p, frames: p.frames.map((f, i) => {
        if (i) return f;
        const annotationLines = { ...f.annotationLines };
        if (line) annotationLines[id] = line; else delete annotationLines[id];
        return { ...f, annotationLines };
      }) }));
      if (!await coordinator!.flush()) throw new Error("Test local flush failed"); provider!.wake();
    },
    async undoLine() { editor!.undo(); if (!await coordinator!.flush()) throw new Error("Test undo flush failed"); provider!.wake(); },
    online: (value: boolean) => provider!.setOnline(value), state: () => provider?.snapshot,
    lifecycleState: (id = localId!) => lifecycle.state(id), read: (id = localId!) => repository.get(id),
    async rescue(id = localId!) { const request = await lifecycle.prepareIndependentCopy(id, id === localId ? coordinator?.projectProjection ?? undefined : undefined); await repository.commit(request); return request; },
    close() { provider?.stop(); editor?.destroy(); repository.close(); },
  };
}

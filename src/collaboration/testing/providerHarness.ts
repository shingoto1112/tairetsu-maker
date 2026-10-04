// Imported only by Playwright on a route-fulfilled inert page, never by App/runtime.
import * as Y from "yjs";
import projects from "../../repositories/contract/fixtures/commitProjects.json";
import fixture from "../../repositories/contract/fixtures/collaboration.json";
import type { Project } from "../../types";
import type { CollaborationData } from "../../repositories/types";
import { IndexedDbProjectRepository } from "../../repositories/indexedDbRepository";
import { SaveCoordinator } from "../../storage/saveCoordinator";
import { hydrateCollaboration, encodeUpdate } from "../persistence";
import { CollaborationCommands } from "../commands";
import { CollaborationProvider } from "../provider";
import { createHttpTransport } from "../supabaseTransport";

export async function createProviderHarness(options: { url: string; actor: string; membership: string; documentId: string; dbName: string }) {
  if (!import.meta.env.DEV) throw new Error("Development test harness only");
  const parsed = new URL(options.url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("Mock must be loopback");
  const repository = new IndexedDbProjectRepository({ dbName: options.dbName }); await repository.initialize();
  let record = await repository.get("project_a");
  if (!record) {
    await repository.commit({ project: projects.stage as Project, collaboration: { ...fixture.initial, sharedDocumentId: options.documentId,
      transportBinding: { accountId: options.actor, membershipGeneration: options.membership } } as CollaborationData,
      operationId: crypto.randomUUID(), expectedRepositoryRevision: null, localRevision: "1" });
    record = await repository.get("project_a");
  }
  const coordinator = new SaveCoordinator(repository, () => {}); coordinator.activate(record!);
  const transport = createHttpTransport({ url: options.url, anonKey: "mock-public-key" }, async () => ({ accountId: options.actor, accessToken: options.actor }),
    async (topic, auth, notice, status) => {
      const events = new EventSource(`${options.url}/events?topic=${encodeURIComponent(topic)}&actor=${encodeURIComponent(auth.accountId)}`);
      events.onmessage = event => notice(JSON.parse(event.data)); events.onopen = () => status(true); events.onerror = () => status(false);
      return () => events.close();
    });
  const provider = new CollaborationProvider(coordinator, transport, { pollMs: 200, backoffMs: 30, lifecycle: true });
  return {
    start: () => provider.start(), stop: () => provider.stop(), online: (value: boolean) => provider.setOnline(value),
    wake: () => provider.wake(), state: () => provider.snapshot,
    async move(memberId: string, x: number, commit = true) {
      const data = await coordinator.getCommittedCollaboration(); const doc = hydrateCollaboration(data!);
      const commands = new CollaborationCommands(doc), before = Y.encodeStateVector(doc);
      commands.moveMembers([{ sceneId: "f_001", memberId, position: { x, y: 2 } }]);
      const updateId = crypto.randomUUID(), bytes = encodeUpdate(Y.encodeStateAsUpdate(doc, before));
      commands.destroy(); doc.destroy();
      await coordinator.editCollaboration([{ updateId, bytes, source: "local" }]);
      if (commit) { if (!await coordinator.flush()) throw new Error("local commit failed"); provider.wake(); }
      return { updateId, bytes };
    },
    async flush() { const result = await coordinator.flush(); provider.wake(); return result; },
    async read() { return repository.get("project_a"); },
    projection: () => coordinator.projectProjection,
    close() { provider.stop(); repository.close(); },
  };
}

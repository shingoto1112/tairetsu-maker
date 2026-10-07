import { expect, it, vi } from "vitest";
import type { CollaborationTransport } from "./transport";
import type { ManagementTransport } from "./managementTransport";
import { CollaborationLifecycle } from "./lifecycle";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { createSampleProject } from "../sampleProject";
import { SaveCoordinator } from "../storage/saveCoordinator";
import { SharedProjectEditor } from "./editorSession";
import { CollaborationUiService } from "./uiService";
import type { CollaborationUiOptions } from "./uiTypes";
import { SharedSessionStore } from "../storage/sharedSessionState";
import { hydrateCollaboration, projectSharedDocument } from "./persistence";

async function setup() {
  const repository = new MemoryProjectRepository();
  await repository.commit({ project: { ...createSampleProject(), id: "target" }, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
  const receipt = { documentId: "11111111-1111-4111-8111-111111111111", generation: "1", headSeq: "0", aclGeneration: "1", topic: "topic", membershipGeneration: "22222222-2222-4222-8222-222222222222" };
  const management = { create: vi.fn().mockResolvedValue(receipt), openExisting: vi.fn().mockResolvedValue(receipt) };
  const lifecycle = new CollaborationLifecycle(repository, management as unknown as ManagementTransport,
    { credential: async () => ({ accountId: "33333333-3333-4333-8333-333333333333", accessToken: "local-fake" }) } as unknown as CollaborationTransport,
    { platform: "web", invitationBaseUrl: "https://example.invalid", allowedOrigins: [] });
  return { repository, lifecycle, management, receipt };
}
it("a failed real lifecycle keeps the initial document, and unchanged retry reuses the one independent copy", async () => {
  const { repository, lifecycle, management } = await setup();
  const operation = { localId: "target", current: () => true, prepare: async () => (await repository.get("target"))!, settle: vi.fn() };
  const service = new CollaborationUiService(() => ({ config: null, repository: () => repository, sharingOperation: () => operation,
    platform: "web", mock: true, active: () => null, summaries: () => [], store: new SharedSessionStore(), open: vi.fn(), transform: vi.fn(), localRemoved: vi.fn() } as CollaborationUiOptions));
  Object.assign(service, { auth: { state: () => ({ status: "signed-in", userId: "33333333-3333-4333-8333-333333333333", isGuest: false }) }, api: lifecycle });
  vi.spyOn(service, "initialize").mockResolvedValue(); vi.spyOn(service, "refresh").mockResolvedValue();
  management.create.mockRejectedValueOnce(new Error("通信に失敗しました"));
  await service.start("作成者");
  const initial = (await repository.get("target"))!.collaboration!;
  expect(initial.sharedDocumentId).toBeNull(); expect(service.getSnapshot().error).toContain("コピーは保存しました");
  await service.start("作成者");
  expect(service.getSnapshot().error).toBeNull();
  expect((await repository.get("target"))!.collaboration!.sharedDocumentId).toBeTruthy();
  expect((await repository.list({ limit: 100 })).items).toHaveLength(2);
  expect(management.create.mock.calls[1][0]).toBe(management.create.mock.calls[0][0]);
});
it("guards before initial bytes are staged and again before binding a delayed reply", async () => {
  const { repository, lifecycle, management, receipt } = await setup();
  const commit = vi.spyOn(repository, "commit");
  await expect(lifecycle.startSharing("target", "作成者", undefined, async () => { throw new Error("対象変更"); })).rejects.toThrow("対象変更");
  expect(commit).not.toHaveBeenCalled(); expect(management.create).not.toHaveBeenCalled();
  let allowed = true;
  management.create.mockImplementationOnce(async () => { allowed = false; return receipt; });
  await expect(lifecycle.startSharing("target", "作成者", undefined, async () => { if (!allowed) throw new Error("対象変更"); })).rejects.toThrow("対象変更");
  expect((await repository.get("target"))!.collaboration!.sharedDocumentId).toBeNull();
});
it("a retry after editing sends the durable journal without changing document identity", async () => {
  const { repository, lifecycle, management } = await setup();
  management.create.mockRejectedValueOnce(new Error("通信に失敗しました"));
  await expect(lifecycle.startSharing("target", "作成者")).rejects.toThrow();
  const record = (await repository.get("target"))!;
  const coordinator = new SaveCoordinator(repository, () => {}); coordinator.activate(record);
  const editor = await SharedProjectEditor.create(coordinator, record.project, () => {}, error => { throw error; });
  try {
    editor.edit(previous => ({ ...previous, title: "再編集した隊列" }));
    expect(editor.stagePending()).toBe(true); expect(await coordinator.flush()).toBe(true);
    await lifecycle.startSharing("target", "作成者");
    const saved = (await repository.get("target"))!, data = { ...saved.collaboration!, base: management.create.mock.calls[1][0], journal: [] };
    const doc = hydrateCollaboration(data);
    try { expect(projectSharedDocument(doc, saved.project).title).toBe("再編集した隊列"); } finally { doc.destroy(); }
    expect(saved.collaboration!.generation).toBe(record.collaboration!.generation);
  } finally { editor.destroy(); }
});

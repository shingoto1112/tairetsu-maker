// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import projects from "../repositories/contract/fixtures/commitProjects.json";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { RepositoryError } from "../repositories/types";
import type { Project } from "../types";
import { createSharedDocument } from "./model";
import { createCollaborationData } from "./persistence";
import { SharedSessionController } from "./sharedSessionController";
const setup = async () => {
  const repository = new MemoryProjectRepository();
  const project = projects.stage as Project, doc = createSharedDocument(project);
  const collaboration = { ...createCollaborationData(doc), sharedDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    transportBinding: { accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipGeneration: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } };
  doc.destroy(); await repository.commit({ project, collaboration, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
  const publish = vi.fn();
  const owner = await SharedSessionController.create(repository, (await repository.get(project.id!))!, {
    enabled: false, config: null, platform: "web", current: () => true, publish, failed: vi.fn(), saved: vi.fn(), committed: vi.fn(),
  });
  return { owner, repository, project, publish };
};
describe("shared document session ownership", () => {
  it("keeps editor and unsaved rescue after failed batch close, retains attachment when V2 is OFF", async () => {
    const { owner, repository, project } = await setup();
    try {
      expect(owner.provider).toBeNull(); owner.editor.begin(); owner.editor.edit(p => ({ ...p, title: "未保存の編集" }));
      const commit = vi.spyOn(repository, "commit").mockRejectedValue(new RepositoryError("NO_SPACE"));
      expect(await owner.close()).toBe(false); expect(owner.editor.project.title).toBe("未保存の編集");
      expect(owner.store.getSnapshot().sync).toBe("保存失敗");
      const rescue = await owner.prepareIndependentCopy(); expect(rescue.project.title).toBe("未保存の編集"); expect(rescue.collaboration).toBeNull();
      commit.mockRestore(); expect(await owner.close()).toBe(true);
      const record = await repository.get(project.id!); expect(record?.collaboration?.sharedDocumentId).toBeTruthy(); expect(record?.project.title).toBe("未保存の編集");
    } finally { owner.dispose(); }
  });
  it("notifies only newly committed pending updates; view/ACK commits do not create send triggers", async () => {
    const { owner, repository, project } = await setup();
    try {
      const events: { pendingUpdateIds: string[] }[] = []; owner.coordinator.subscribeCommits(event => events.push(event));
      owner.editor.edit(p => ({ ...p, title: "更新" })); await owner.flush();
      expect(events[events.length - 1]?.pendingUpdateIds.length).toBe(1);
      owner.editor.setLocal({ ...owner.editor.project, viewerPerspective: "performer" }); await owner.flush();
      expect(events[events.length - 1]?.pendingUpdateIds).toEqual([]);
      const ids = (await repository.get(project.id!))!.collaboration!.outbox.map(e => e.updateId);
      await owner.coordinator.markOutboxSent(ids); expect(events[events.length - 1]?.pendingUpdateIds).toEqual([]);
    } finally { owner.dispose(); }
  });
});

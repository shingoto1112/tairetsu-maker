// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import projects from "../repositories/contract/fixtures/commitProjects.json";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { RepositoryError } from "../repositories/types";
import type { Project } from "../types";
import { createSharedDocument } from "./model";
import { createCollaborationData } from "./persistence";
import { SharedSessionController } from "./sharedSessionController";
vi.mock("../utils/audioStorage", () => ({ listDeviceAudio: vi.fn(async () => []), resolveAudioPlaybackURL: vi.fn(async () => "file://test") }));
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
  it("local binding survives restart/CAS without changing descriptor or creating an outbox update; rescue strips participation", async () => {
    const { owner, repository, project } = await setup();
    try {
      const audio = { id: "device-a", name: "共通曲.wav", type: "audio/wav", size: 100, duration: 60 };
      owner.changeSong(audio); await owner.flush();
      const otherSong = { name: "以前の共通曲.wav", type: "audio/wav", size: 100, duration: 90 };
      owner.coordinator.setAudioBindings([...owner.coordinator.audioBindingsProjection, { song: otherSong, audio: { ...audio, id: "other-song-original" } }]); await owner.flush();
      const descriptor = owner.song, count = (await repository.get(project.id!))!.collaboration!.outbox.length;
      const other = { ...audio, id: "device-b", name: "別エンコード.mp3", size: 50, type: "audio/mpeg" };
      // Another same-origin writer causes CAS; keep the explicit device choice.
      const saved = (await repository.get(project.id!))!;
      const concurrent = { ...saved.collaboration!, audioBindings: saved.collaboration!.audioBindings!.map(b => b.song.name === otherSong.name ? { ...b, audio: { ...b.audio, id: "other-song-concurrent" } } : b) };
      await repository.commit({ project: saved.project, collaboration: concurrent, expectedRepositoryRevision: saved.repositoryRevision,
        localRevision: String(Number(saved.localRevision) + 1), operationId: "competing-local-writer" });
      owner.bindAudio(other); expect(await owner.flush()).toBe(true);
      const next = (await repository.get(project.id!))!;
      expect(next.project.audio).toEqual(other); expect(next.collaboration!.audioBindings![0].audio).toEqual(other);
      expect(next.collaboration!.audioBindings![1].audio.id).toBe("other-song-concurrent");
      expect(next.collaboration!.outbox.length).toBe(count); expect(owner.song).toEqual(descriptor); expect(owner.audioMatches(other)).toBe(true);
      const rescue = await owner.prepareIndependentCopy(); expect(rescue.project.audio).toEqual(other); expect(rescue.collaboration).toBeNull();
      expect(() => owner.bindAudio(other, "stale-song")).toThrow("共通曲が変わりました");
    } finally { owner.dispose(); }
  });
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

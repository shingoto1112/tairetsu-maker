import { describe, expect, it, vi } from "vitest";
import type { AudioMeta, Project } from "../types";
import { describeAudio, mergeAudioBindings, sameSong, validateAudioBindings } from "../repositories/audioBindings";
import { chooseDeviceAudio } from "./deviceAudio";
import { validateCollaboration, validateCollaborationTransition } from "../repositories/collaborationData";
import { initialCollaboration } from "../repositories/contract/runCollaborationContract";
import { encodeBody, decodeBody } from "../repositories/indexedDbFormat";
import fixture from "../repositories/contract/fixtures/commitProjects.json";
import { deviceAudioProject } from "../storage/deviceAudioProject";
import { createSharedDocument } from "./model";
import { createCollaborationData } from "./persistence";

vi.mock("../utils/audioStorage", () => ({ listDeviceAudio: vi.fn(), resolveAudioPlaybackURL: vi.fn(async (audio: AudioMeta) => audio.id === "missing" ? null : "file://test") }));
const audio: AudioMeta = { id: "local-a", name: "共通曲.wav", type: "audio/wav", size: 100, duration: 60 };
describe("device song bindings", () => {
  it("auto selects exactly one complete descriptor match; ambiguity and unknown length never choose arbitrarily", async () => {
    const song = describeAudio(audio);
    expect(await chooseDeviceAudio(song, [], [audio])).toEqual(audio);
    expect(await chooseDeviceAudio(song, [], [audio, { ...audio, id: "local-b" }])).toBeNull();
    expect(await chooseDeviceAudio(song, [], [{ ...audio, duration: undefined }])).toBeNull();
    expect(await chooseDeviceAudio({ ...song, duration: undefined }, [], [{ ...audio, duration: undefined }])).toBeNull();
    expect(await chooseDeviceAudio(song, [], [{ ...audio, type: "audio/mpeg" }])).toBeNull();
    expect(await chooseDeviceAudio(song, [], [{ ...audio, id: "missing" }])).toBeNull();
  });
  it("explicit bindings allow other encodings but never follow a changed descriptor", async () => {
    const song = describeAudio(audio), other = { ...audio, id: "encoding-b", name: "端末曲.mp3", type: "audio/mpeg", size: 50 };
    expect(await chooseDeviceAudio(song, [{ song, audio: other }], [audio, other])).toEqual(other);
    expect(await chooseDeviceAudio({ ...song, duration: 61 }, [{ song, audio: other }], [other])).toBeNull();
    expect(sameSong(song, { ...song, duration: undefined })).toBe(false);
  });
  it("closed attachment validation retains mappings through integrity encoding and rejects unknown paths or duplicate descriptors", () => {
    const binding = { song: describeAudio(audio), audio }, data = { ...initialCollaboration(), schemaVersion: 2 as const, audioBindings: [binding] };
    expect(validateCollaboration(data).audioBindings).toEqual([binding]);
    expect(() => validateCollaboration({ ...data, schemaVersion: 1 })).toThrow();
    expect(() => validateCollaboration({ ...data, schemaVersion: 3 })).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }));
    expect(() => validateCollaborationTransition(initialCollaboration(), data)).not.toThrow();
    expect(() => validateCollaborationTransition(data, initialCollaboration())).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    const record = { project: fixture.stage as Project, collaboration: data, repositoryRevision: "1", localRevision: "1", sync: null };
    expect(decodeBody(encodeBody(record), fixture.stage.id).collaboration?.audioBindings).toEqual([binding]);
    expect(() => validateAudioBindings([binding, binding])).toThrow();
    expect(() => validateAudioBindings([{ ...binding, audio: { ...audio, path: "/private/device" } }])).toThrow();
    expect(() => validateAudioBindings([{ ...binding, song: { ...binding.song, duration: NaN } }])).toThrow();
    expect(() => validateAudioBindings(Array(4097).fill(binding))).toThrow();
    expect(mergeAudioBindings([binding], [{ song: binding.song, audio: { ...audio, id: "new" } }])[0].audio.id).toBe("new");
  });
  it("backup and previous rescue materialize current binding and omit unrelated previous music", async () => {
    const project: Project = { ...fixture.stage as Project, audio }, doc = createSharedDocument(project), collaboration = createCollaborationData(doc); doc.destroy();
    const encoded = { ...audio, id: "encoding-b", name: "端末曲.mp3" };
    const record = { project, collaboration: { ...collaboration, schemaVersion: 2 as const, audioBindings: [{ song: describeAudio(audio), audio: encoded }] }, repositoryRevision: "1", localRevision: "1", sync: null };
    expect((await deviceAudioProject(record)).audio).toEqual(encoded);
    const changed = { ...project, audio: { ...audio, duration: 61 } }, changedDoc = createSharedDocument(changed);
    record.collaboration = { ...createCollaborationData(changedDoc), schemaVersion: 2, audioBindings: record.collaboration.audioBindings }; changedDoc.destroy();
    expect((await deviceAudioProject(record)).audio).toBeNull();
  });
});

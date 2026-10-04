import type { AudioMeta } from "../types";
import type { ProjectRepository } from "../repositories/types";
import { listAllSummaries } from "../storage/appRepository";
import { listDeviceAudio, resolveAudioPlaybackURL } from "../utils/audioStorage";
import { sameSong, validateAudioBindings, type AudioBinding, type SongDescriptor } from "../repositories/audioBindings";

export const deviceAudioCandidates = async (repository: ProjectRepository, bindings: AudioBinding[], current?: AudioMeta | null): Promise<AudioMeta[]> => {
  const candidates = new Map<string, AudioMeta>();
  const add = (audio: AudioMeta) => {
    try { validateAudioBindings([{ song: { name: audio.name, type: audio.type, size: audio.size, ...(audio.duration === undefined ? {} : { duration: audio.duration }) }, audio }]); candidates.set(audio.id, audio); }
    catch { /* One invalid metadata row cannot hide healthy music. */ }
  };
  (await listDeviceAudio()).forEach(add);
  bindings.forEach(b => add(b.audio)); if (current) add(current);
  // Old audio stores have no duration catalog. Read only documents with an
  // audio reference missing from that catalog. Read/validate one body at a time.
  for (const summary of await listAllSummaries(repository)) {
    if (!summary.audioId || candidates.has(summary.audioId)) continue;
    try { const audio = (await repository.get(summary.id))?.project.audio; if (audio) add(audio); }
    catch { /* Individual damaged documents keep their own recovery path. */ }
  }
  return [...candidates.values()];
};
export const audioExists = async (audio: AudioMeta): Promise<boolean> => {
  const url = await resolveAudioPlaybackURL(audio);
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  return !!url;
};
export const chooseDeviceAudio = async (song: SongDescriptor | null | undefined, bindings: AudioBinding[], candidates: AudioMeta[]): Promise<AudioMeta | null> => {
  if (!song) return null;
  const known = bindings.find(b => sameSong(b.song, song));
  if (known && await audioExists(known.audio)) return known.audio;
  if (song.duration === undefined) return null;
  const matching: AudioMeta[] = [];
  for (const audio of candidates) if (sameSong(song, audio) && await audioExists(audio)) matching.push(audio);
  return matching.length === 1 ? matching[0] : null;
};

import type { AudioMeta } from "../types";
import { isValidStorageId } from "./ids";
import { RepositoryError, type CollaborationData } from "./types";

export type SongDescriptor = Omit<AudioMeta, "id">;
export type AudioBinding = NonNullable<CollaborationData["audioBindings"]>[number];
export const songKey = (song: SongDescriptor | null | undefined): string =>
  JSON.stringify(song ? [song.name, song.type, song.size, song.duration ?? null] : null);
export const sameSong = (a: SongDescriptor | null | undefined, b: SongDescriptor | null | undefined): boolean => songKey(a) === songKey(b);
export const describeAudio = ({ name, type, size, duration }: AudioMeta): SongDescriptor =>
  ({ name, type, size, ...(duration === undefined ? {} : { duration }) });
const validMeta = (v: unknown, withId: boolean): boolean => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const m = v as Record<string, unknown>, allowed = ["name", "type", "size", "duration", ...(withId ? ["id"] : [])];
  return Object.keys(m).every(k => allowed.includes(k)) && (!withId || isValidStorageId(m.id)) &&
    typeof m.name === "string" && m.name.length > 0 && m.name.length <= 4096 &&
    typeof m.type === "string" && m.type.length > 0 && m.type.length <= 4096 &&
    Number.isSafeInteger(m.size) && (m.size as number) > 0 && (m.size as number) <= 200 * 1024 * 1024 &&
    (m.duration === undefined || typeof m.duration === "number" && Number.isFinite(m.duration) && m.duration >= 0);
};
export const validateAudioBindings = (value: unknown): AudioBinding[] => {
  if (!Array.isArray(value)) throw new RepositoryError("INVALID_ARGUMENT");
  if (value.length > 4096) throw new RepositoryError("QUOTA_EXCEEDED");
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Object.keys(entry).length !== 2 || !validMeta(entry.song, false) || !validMeta(entry.audio, true))
      throw new RepositoryError("INVALID_ARGUMENT");
    const key = songKey(entry.song);
    if (seen.has(key)) throw new RepositoryError("INVALID_ARGUMENT");
    seen.add(key);
  }
  return value as AudioBinding[];
};
export const mergeAudioBindings = (saved: AudioBinding[] = [], local: AudioBinding[] = [], baseline?: AudioBinding[]): AudioBinding[] => {
  const bindings = new Map(saved.map(b => [songKey(b.song), b]));
  const previous = new Map(baseline?.map(b => [songKey(b.song), b]));
  for (const binding of local) {
    const key = songKey(binding.song), old = previous.get(key);
    // Rebase only this writer's changes, not stale choices for other songs.
    if (old && old.audio.id === binding.audio.id && sameSong(old.audio, binding.audio)) continue;
    bindings.set(key, binding);
  }
  return [...bindings.values()];
};

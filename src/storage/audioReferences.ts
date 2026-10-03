import { RepositoryError } from "../repositories/types";
import { assertStorageId } from "../repositories/ids";
import type { MigrationItem } from "../repositories/migrationTypes";

export const migrationProtectsAudio = (item: Pick<MigrationItem, "disposition" | "outcome" | "state">): boolean =>
  item.disposition === "recovery" || item.outcome === "recovery" || item.state !== "completed";

/** Inspect raw recovery JSON too. An undecidable reference aborts the entire GC. */
export const addAudioReference = (value: unknown, references: Set<string>): void => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RepositoryError("CORRUPT");
  const audio = (value as Record<string, unknown>).audio;
  if (audio === undefined || audio === null) return;
  if (!audio || typeof audio !== "object" || Array.isArray(audio)) throw new RepositoryError("CORRUPT");
  try { references.add(assertStorageId((audio as Record<string, unknown>).id)); }
  catch { throw new RepositoryError("CORRUPT"); }
};

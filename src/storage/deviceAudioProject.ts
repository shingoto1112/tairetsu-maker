import type { ProjectRecord } from "../repositories/types";
import type { AudioMeta, Project } from "../types";
import { sameSong } from "../repositories/audioBindings";

/** Normal ZIP/rescue materialize one current device reference, never the local
 * binding history or participation/CRDT attachment. No ZIP schema extension. */
export const deviceAudioProject = async (record: ProjectRecord, live: Project = record.project): Promise<Project> => {
  if (!record.collaboration || record.collaboration.documentSchema !== 2) return live;
  const { hydrateCollaboration } = await import("../collaboration/persistence");
  const { getModel } = await import("../collaboration/model");
  const doc = hydrateCollaboration(record.collaboration);
  try {
    const song = getModel(doc).settings.get("song") as Omit<AudioMeta, "id"> | null | undefined;
    const binding = record.collaboration.audioBindings?.find(b => sameSong(b.song, song));
    // Old records without mappings retain an exactly matching local metadata
    // reference. The session will inspect ambiguity before allowing playback.
    const audio = binding?.audio ?? (song && sameSong(song, live.audio) ? live.audio : null);
    return { ...live, audio };
  } finally { doc.destroy(); }
};

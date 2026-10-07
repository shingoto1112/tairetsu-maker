import type { ParadeSettings } from "../types";

export const MAX_PARADE_TOTAL_DISTANCE_METERS = 500;
export const MAX_PARADE_BACKWARD_DISTANCE_METERS = 500;

/** Input policy only. Legacy normalization and repository reads stay permissive. */
export function paradeDistanceError(settings: Partial<ParadeSettings>): string | null {
  const total = settings.totalDistance;
  if (total !== undefined && (!Number.isFinite(total) || total < 1 || total > MAX_PARADE_TOTAL_DISTANCE_METERS))
    return `パレードの全体距離は1〜${MAX_PARADE_TOTAL_DISTANCE_METERS}mにしてください。`;
  const backward = settings.backwardDistanceMeters;
  if (backward !== undefined && (!Number.isFinite(backward) || backward < 0 || backward > MAX_PARADE_BACKWARD_DISTANCE_METERS))
    return `パレードの後方表示距離は0〜${MAX_PARADE_BACKWARD_DISTANCE_METERS}mにしてください。`;
  return null;
}

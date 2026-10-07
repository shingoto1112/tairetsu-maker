export const MAX_RENDER_TICKS = 16384;

/** Index-based sampling avoids both huge loops and value += step stalling at large magnitudes. */
export function boundedTicks(min: number, max: number, step = 1, origin = 0, limit = MAX_RENDER_TICKS): number[] {
  if (![min, max, step, origin].every(Number.isFinite) || step <= 0 || min > max || !Number.isSafeInteger(limit) || limit < 2) return [];
  const first = Math.ceil((min - origin) / step - 1e-9);
  const last = Math.floor((max - origin) / step + 1e-9);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last) return [];
  const stride = Math.max(1, Math.ceil((last - first) / (limit - 1)));
  const count = Math.min(limit, Math.floor((last - first) / stride) + 1);
  return Array.from({ length: count }, (_, i) => Number((origin + (first + i * stride) * step).toFixed(9)));
}

export function paradeMeterTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [];
  return [...new Set([min, ...boundedTicks(min, max, 1, 0, MAX_RENDER_TICKS - 2), max])].sort((a, b) => a - b);
}

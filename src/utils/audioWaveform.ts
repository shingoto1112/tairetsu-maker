export type WaveformData = { durationSec: number; peaks: Float32Array };

// Include every analysis parameter in the version when changing the algorithm.
export const WAVEFORM_ANALYSIS_VERSION = "abs-max-v1-8000hz-1600";
export const WAVEFORM_SAMPLE_RATE = 8000;
export const WAVEFORM_PEAK_COUNT = 1600;
export const MAX_WAVEFORM_PEAKS = 2000;
export const MAX_WAVEFORM_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_WAVEFORM_DURATION_SEC = 15 * 60;

export const waveformCacheKey = (key: string): string =>
  JSON.stringify([WAVEFORM_ANALYSIS_VERSION, key]);

/** Absolute channel maxima, never a mono sum (opposite phases must not cancel).
 * Integer boundaries partition every sample exactly once, including the tail.
 * Returned peaks are immutable by convention, like cached WaveformData.
 */
export function calculateWaveformPeaks(
  channels: readonly Float32Array[], pointCount = WAVEFORM_PEAK_COUNT,
): Float32Array {
  if (!Number.isFinite(pointCount) || pointCount < 1) {
    throw new RangeError("波形の点数は1以上の有限な数にしてください。");
  }
  const length = channels[0]?.length ?? 0;
  if (channels.some(channel => channel.length !== length)) {
    throw new RangeError("音源のチャンネル長が一致しません。");
  }
  const count = Math.min(length, MAX_WAVEFORM_PEAKS, Math.floor(pointCount));
  const peaks = new Float32Array(count);
  for (let point = 0; point < count; point++) {
    const start = Math.floor(point * length / count);
    const end = Math.floor((point + 1) * length / count);
    let peak = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) {
        const amplitude = Math.abs(channel[sample]);
        if (Number.isFinite(amplitude) && amplitude > peak) peak = amplitude;
      }
    }
    peaks[point] = peak;
  }
  return peaks;
}

/** Memory-only LRU; entries contain just duration and peaks, never input/PCM.
 * Default capacity is at most 12 entries / 96 KiB of peak arrays.
 */
export class WaveformCache {
  private readonly entries = new Map<string, WaveformData>();
  private bytes = 0;

  constructor(private readonly maxEntries = 12, private readonly maxBytes = 96 * 1024) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("波形キャッシュの上限が不正です。");
    }
  }

  get size(): number { return this.entries.size; }
  get byteLength(): number { return this.bytes; }

  get(key: string): WaveformData | undefined {
    const data = this.entries.get(key);
    if (data) {
      this.entries.delete(key);
      this.entries.set(key, data);
    }
    return data;
  }

  set(key: string, data: WaveformData): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.peaks.byteLength;
      this.entries.delete(key);
    }
    if (this.maxEntries === 0 || data.peaks.byteLength > this.maxBytes) return;
    this.entries.set(key, data);
    this.bytes += data.peaks.byteLength;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.peaks.byteLength;
      this.entries.delete(oldest);
    }
  }
}

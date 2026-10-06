import { useCallback, useEffect, useRef, useState } from "react";
import {
  calculateWaveformPeaks, MAX_WAVEFORM_DURATION_SEC, MAX_WAVEFORM_INPUT_BYTES,
  WaveformCache, waveformCacheKey, WAVEFORM_SAMPLE_RATE,
  type WaveformData,
} from "../utils/audioWaveform";

export type AudioWaveformStatus = "idle" | "loading" | "ready" | "error" | "too-large" | "unsupported";
export type AudioWaveformOptions = {
  /** Identity of the actual local file. Change it whenever the file changes. */
  key: string | null;
  /** Fresh, exclusively owned ArrayBuffer, or a Blob. decodeAudioData may detach bytes. */
  load: () => Promise<Blob | ArrayBuffer>;
  sizeHint?: number;
  durationHint?: number;
  enabled: boolean;
};
export type AudioWaveformResult = {
  status: AudioWaveformStatus;
  data: WaveformData | null;
  retry: () => void;
};

type Outcome = Pick<AudioWaveformResult, "status" | "data">;
type Listener = (outcome: Outcome) => void;
type Job = {
  key: string;
  load: AudioWaveformOptions["load"] | null;
  running: boolean;
  listeners: Set<Listener>;
};
const outcome = (status: AudioWaveformStatus): Outcome => ({ status, data: null });
const exceedsLimits = (size?: number, duration?: number): boolean =>
  (size !== undefined && size > MAX_WAVEFORM_INPUT_BYTES) ||
  (duration !== undefined && duration > MAX_WAVEFORM_DURATION_SEC);

function createDecodeContext(): OfflineAudioContext | null {
  const host = globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Constructor = host.OfflineAudioContext ?? host.webkitOfflineAudioContext;
  if (!Constructor) return null;
  try {
    // No render and no playback AudioContext. Never retry at a higher rate.
    const context = new Constructor(1, 1, WAVEFORM_SAMPLE_RATE);
    return context.sampleRate === WAVEFORM_SAMPLE_RATE && typeof context.decodeAudioData === "function"
      ? context : null;
  } catch {
    return null;
  }
}

/** One global slot includes loading and byte conversion, not only decoding.
 * Unsubscribed decoding cannot be stopped, so it keeps the slot until settled.
 */
class WaveformReader {
  private readonly cache = new WaveformCache();
  private readonly jobs = new Map<string, Job>();
  private pending: Job[] = [];
  private active = false;

  request(key: string, load: AudioWaveformOptions["load"], listener: Listener): () => void {
    const versionedKey = waveformCacheKey(key);
    const cached = this.cache.get(versionedKey);
    if (cached) {
      listener({ status: "ready", data: cached });
      return () => {};
    }
    let job = this.jobs.get(versionedKey);
    if (!job) {
      job = { key: versionedKey, load, running: false, listeners: new Set() };
      this.jobs.set(versionedKey, job);
      this.pending.push(job);
    }
    const subscription: Listener = result => listener(result);
    job.listeners.add(subscription);
    this.drain();
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      job.listeners.delete(subscription);
      if (!job.running && job.listeners.size === 0) {
        this.jobs.delete(job.key);
        this.pending = this.pending.filter(candidate => candidate !== job);
        job.load = null;
      }
    };
  }

  private drain(): void {
    if (this.active) return;
    const job = this.pending.shift();
    if (!job) return;
    job.running = true;
    this.active = true;
    void this.read(job);
  }

  private abandoned(job: Job): boolean {
    if (job.listeners.size > 0) return false;
    // A request arriving after this checkpoint must queue a fresh read, rather
    // than join a job whose input/result has already been discarded.
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    return true;
  }

  private async analyze(job: Job): Promise<Outcome> {
    let context: OfflineAudioContext | null = createDecodeContext();
    if (!context) { job.load = null; return outcome("unsupported"); }
    let input: Blob | ArrayBuffer | null = null;
    let bytes: ArrayBuffer | null = null;
    let buffer: AudioBuffer | null = null;
    try {
      input = await job.load!();
      job.load = null;
      if (this.abandoned(job)) return outcome("idle");
      const size = input instanceof ArrayBuffer ? input.byteLength : input.size;
      if (exceedsLimits(size)) return outcome("too-large");
      if (size <= 0) return outcome("error");
      bytes = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
      input = null;
      if (this.abandoned(job)) return outcome("idle");
      if (exceedsLimits(bytes.byteLength)) return outcome("too-large");
      buffer = await context.decodeAudioData(bytes);
      bytes = null;
      if (this.abandoned(job)) return outcome("idle");
      if (buffer.sampleRate !== WAVEFORM_SAMPLE_RATE) return outcome("unsupported");
      if (exceedsLimits(undefined, buffer.duration)) return outcome("too-large");
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.numberOfChannels < 1) {
        return outcome("error");
      }
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer!.getChannelData(channel));
      return { status: "ready", data: { durationSec: buffer.duration, peaks: calculateWaveformPeaks(channels) } };
    } finally {
      // OfflineAudioContext has no close(). These references are GC eligible.
      input = null;
      bytes = null;
      buffer = null;
      context = null;
      job.load = null;
    }
  }

  private async read(job: Job): Promise<void> {
    let result: Outcome;
    try { result = await this.analyze(job); }
    catch { result = outcome("error"); }
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    if (job.listeners.size > 0 && result.status === "ready" && result.data) {
      this.cache.set(job.key, result.data);
    }
    for (const listener of job.listeners) listener(result);
    job.listeners.clear();
    this.active = false;
    this.drain();
  }
}

const reader = new WaveformReader();

/** Loader identity changes do not restart analysis: key identifies the bytes.
 * Limits are checked even on cache hits. Errors are uncached and retryable.
 */
export function useAudioWaveform({ key, load, sizeHint, durationHint, enabled }: AudioWaveformOptions): AudioWaveformResult {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  const [state, setState] = useState<Outcome & {
    key: string | null; attempt: number; sizeHint?: number; durationHint?: number;
  }>({ ...outcome("idle"), key: null, attempt: 0 });

  useEffect(() => {
    if (!enabled || key === null || exceedsLimits(sizeHint, durationHint)) return;
    let current = true;
    const publish: Listener = result => {
      if (current) setState({ ...result, key, attempt, sizeHint, durationHint });
    };
    publish(outcome("loading"));
    const unsubscribe = reader.request(key, loadRef.current, publish);
    return () => { current = false; unsubscribe(); };
  }, [key, enabled, sizeHint, durationHint, attempt]);

  if (!enabled || key === null) return { ...outcome("idle"), retry };
  if (exceedsLimits(sizeHint, durationHint)) return { ...outcome("too-large"), retry };
  // Hide stale data in the render changing key, before effect cleanup runs.
  if (state.key !== key || state.attempt !== attempt ||
      !Object.is(state.sizeHint, sizeHint) || !Object.is(state.durationHint, durationHint)) {
    return { ...outcome("loading"), retry };
  }
  return { status: state.status, data: state.data, retry };
}

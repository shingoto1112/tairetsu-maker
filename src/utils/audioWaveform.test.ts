import { describe, expect, it } from "vitest";
import { calculateWaveformPeaks, MAX_WAVEFORM_PEAKS, WaveformCache, waveformCacheKey, type WaveformData } from "./audioWaveform";

const data = (value: number, count = 2): WaveformData => ({ durationSec: 10, peaks: new Float32Array(count).fill(value) });

describe("waveform peaks", () => {
  it("handles silence, no channels, and zero samples", () => {
    expect([...calculateWaveformPeaks([new Float32Array(8)], 3)]).toEqual([0, 0, 0]);
    expect(calculateWaveformPeaks([])).toHaveLength(0);
    expect(calculateWaveformPeaks([new Float32Array()])).toHaveLength(0);
  });
  it("preserves opposite-phase peaks and maxima from every channel", () => {
    expect([...calculateWaveformPeaks([
      new Float32Array([0.25, -0.5, 0.125, -0.25]),
      new Float32Array([-0.25, 0.5, -1, 0.25]),
    ], 2)]).toEqual([0.5, 1]);
  });
  it("partitions fractional intervals without losing boundary or tail samples", () => {
    expect([...calculateWaveformPeaks([new Float32Array([0.125, 0.25, 0.5, 0.75, 1])], 3)])
      .toEqual([0.125, 0.5, 1]);
    const samples = new Float32Array(11);
    for (let index = 0; index < samples.length; index++) {
      samples.fill(0); samples[index] = 1;
      expect([...calculateWaveformPeaks([samples], 4)].reduce((sum, value) => sum + value, 0)).toBe(1);
    }
  });
  it("caps points, limits short inputs, and ignores non-finite samples", () => {
    expect(calculateWaveformPeaks([new Float32Array(4001)], 100000)).toHaveLength(MAX_WAVEFORM_PEAKS);
    expect([...calculateWaveformPeaks([new Float32Array([NaN, Infinity, -0.5])])]).toEqual([0, 0, 0.5]);
    expect(calculateWaveformPeaks([new Float32Array(8)], 2.8)).toHaveLength(2);
  });
  it("rejects invalid point counts and mismatched channel lengths", () => {
    for (const count of [0, -1, NaN, Infinity]) expect(() => calculateWaveformPeaks([], count)).toThrow(RangeError);
    expect(() => calculateWaveformPeaks([new Float32Array(1), new Float32Array(2)])).toThrow(RangeError);
  });
});

describe("waveform LRU", () => {
  it("evicts the least recently used entry and promotes reads", () => {
    const cache = new WaveformCache(2);
    const a = data(1); cache.set("a", a); cache.set("b", data(2));
    expect(cache.get("a")).toBe(a);
    cache.set("c", data(3));
    expect(cache.get("b")).toBeUndefined(); expect(cache.size).toBe(2);
  });
  it("accounts for replacement and enforces the byte budget", () => {
    const cache = new WaveformCache(10, 16);
    cache.set("a", data(1)); cache.set("b", data(2));
    cache.set("a", data(3, 3));
    expect(cache.get("b")).toBeUndefined(); expect(cache.byteLength).toBe(12);
    cache.set("a", data(4, 5));
    expect(cache.get("a")).toBeUndefined(); expect(cache.byteLength).toBe(0);
  });
  it("supports disabled caching and unambiguous versioned keys", () => {
    const cache = new WaveformCache(0); cache.set("a", data(1)); expect(cache.size).toBe(0);
    expect(waveformCacheKey("a")).not.toBe(waveformCacheKey("a:abs-max-v1"));
    expect(JSON.parse(waveformCacheKey("a"))[1]).toBe("a");
    expect(() => new WaveformCache(-1)).toThrow(RangeError);
  });
});

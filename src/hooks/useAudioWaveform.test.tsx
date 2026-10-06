// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WAVEFORM_DURATION_SEC, MAX_WAVEFORM_INPUT_BYTES, WAVEFORM_SAMPLE_RATE } from "../utils/audioWaveform";
import type { AudioWaveformOptions } from "./useAudioWaveform";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const buffer = (duration = 2, sampleRate = WAVEFORM_SAMPLE_RATE): AudioBuffer => ({
  duration, sampleRate, numberOfChannels: 2,
  getChannelData: (channel: number) => new Float32Array(channel ? [-0.5, 1] : [0.5, -1]),
} as AudioBuffer);
const options = (key: string | null = "one"): AudioWaveformOptions => ({
  key, enabled: true, load: vi.fn().mockImplementation(async () => new ArrayBuffer(8)),
});

let useAudioWaveform: typeof import("./useAudioWaveform").useAudioWaveform;
let decode: ReturnType<typeof vi.fn>;
let construct: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
beforeEach(async () => {
  vi.resetModules();
  ({ useAudioWaveform } = await import("./useAudioWaveform"));
  decode = vi.fn().mockResolvedValue(buffer()); construct = vi.fn();
  vi.stubGlobal("OfflineAudioContext", class {
    sampleRate = WAVEFORM_SAMPLE_RATE;
    decodeAudioData = decode;
    constructor(...args: unknown[]) { construct(...args); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useAudioWaveform", () => {
  it("shares concurrent same-key requests and reuses peak-only cache", async () => {
    const pending = deferred<AudioBuffer>(); decode.mockReturnValue(pending.promise);
    const firstOptions = options(), secondOptions = options();
    const first = renderHook(() => useAudioWaveform(firstOptions));
    const second = renderHook(() => useAudioWaveform(secondOptions));
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(first.result.current.status).toBe("loading");
    await act(async () => pending.resolve(buffer()));
    expect(first.result.current.status).toBe("ready");
    expect(first.result.current.data).toBe(second.result.current.data);
    expect([...first.result.current.data!.peaks]).toEqual([0.5, 1]);
    expect(Object.keys(first.result.current.data!)).toEqual(["durationSec", "peaks"]);
    expect(firstOptions.load).toHaveBeenCalledOnce(); expect(secondOptions.load).not.toHaveBeenCalled();
    expect(construct).toHaveBeenCalledExactlyOnceWith(1, 1, 8000);
    first.unmount(); second.unmount();
    const thirdOptions = options(); const third = renderHook(() => useAudioWaveform(thirdOptions));
    expect(third.result.current.status).toBe("ready"); expect(thirdOptions.load).not.toHaveBeenCalled();
  });

  it("discards old key results, serializes decode, and does not cache abandoned results", async () => {
    const pending = deferred<AudioBuffer>(); decode.mockReturnValueOnce(pending.promise);
    const old = options(), next = options("two");
    const view = renderHook(props => useAudioWaveform(props), { initialProps: old });
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
    view.rerender(next);
    expect(view.result.current.data).toBeNull(); expect(next.load).not.toHaveBeenCalled();
    await act(async () => pending.resolve(buffer(10)));
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current.data!.durationSec).toBe(2);
    const oldAgain = options(); view.rerender(oldAgain);
    await waitFor(() => expect(oldAgain.load).toHaveBeenCalledOnce());
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it("does not overlap loads/conversions and removes unsubscribed queued work", async () => {
    const pending = deferred<ArrayBuffer>(); const first = options(); first.load = vi.fn(() => pending.promise);
    const a = renderHook(() => useAudioWaveform(first));
    const queued = options("queued"); const b = renderHook(() => useAudioWaveform(queued)); b.unmount();
    const next = options("next"); const c = renderHook(() => useAudioWaveform(next));
    expect(next.load).not.toHaveBeenCalled(); a.unmount();
    await act(async () => pending.resolve(new ArrayBuffer(8)));
    await waitFor(() => expect(c.result.current.status).toBe("ready"));
    expect(queued.load).not.toHaveBeenCalled(); expect(decode).toHaveBeenCalledOnce();
  });

  it("rejoins in-flight work after StrictMode cleanup and ignores loader identity churn", async () => {
    const pending = deferred<ArrayBuffer>(); const original = options(); original.load = vi.fn(() => pending.promise);
    const view = renderHook(props => useAudioWaveform(props), {
      initialProps: original, wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    const newerLoad = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    view.rerender({ ...original, load: newerLoad });
    await act(async () => pending.resolve(new ArrayBuffer(8)));
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(original.load).toHaveBeenCalledOnce(); expect(newerLoad).not.toHaveBeenCalled();
  });

  it("returns idle without loading when disabled or missing key, and hides data on disabling", async () => {
    const props = options(); const view = renderHook(p => useAudioWaveform(p), { initialProps: { ...props, enabled: false } });
    expect(view.result.current.status).toBe("idle"); expect(props.load).not.toHaveBeenCalled();
    view.rerender({ ...props, key: null, enabled: true }); expect(props.load).not.toHaveBeenCalled();
    view.rerender(props); await waitFor(() => expect(view.result.current.status).toBe("ready"));
    view.rerender({ ...props, enabled: false }); expect(view.result.current.data).toBeNull();
  });

  it.each(["load", "decode", "sync-load"])("contains %s failure and retries without caching errors", async failure => {
    const props = options();
    if (failure === "load") props.load = vi.fn().mockRejectedValueOnce(new Error("private")).mockResolvedValue(new ArrayBuffer(8));
    if (failure === "sync-load") props.load = vi.fn().mockImplementationOnce(() => { throw new Error("private"); }).mockResolvedValue(new ArrayBuffer(8));
    if (failure === "decode") decode.mockRejectedValueOnce(new Error("bad codec"));
    const view = renderHook(() => useAudioWaveform(props));
    await waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(view.result.current.data).toBeNull();
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(props.load).toHaveBeenCalledTimes(2);
  });

  it.each([
    { sizeHint: MAX_WAVEFORM_INPUT_BYTES + 1 }, { durationHint: MAX_WAVEFORM_DURATION_SEC + 1 },
    { durationHint: Infinity },
  ])("rejects excessive hints before reading or constructing a context: %j", hints => {
    const props = { ...options(), ...hints }; const view = renderHook(() => useAudioWaveform(props));
    expect(view.result.current.status).toBe("too-large"); expect(props.load).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });

  it("accepts exact limits and checks hints before using cached data", async () => {
    const props = { ...options(), sizeHint: MAX_WAVEFORM_INPUT_BYTES, durationHint: MAX_WAVEFORM_DURATION_SEC };
    const view = renderHook(p => useAudioWaveform(p), { initialProps: props });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    view.rerender({ ...props, sizeHint: MAX_WAVEFORM_INPUT_BYTES + 1 });
    expect(view.result.current.status).toBe("too-large"); expect(view.result.current.data).toBeNull();
  });

  it("rejects actual oversized Blob before allocating its ArrayBuffer", async () => {
    const blob = new Blob(["x"]); Object.defineProperty(blob, "size", { value: MAX_WAVEFORM_INPUT_BYTES + 1 });
    const conversion = vi.fn(); Object.defineProperty(blob, "arrayBuffer", { value: conversion });
    const view = renderHook(() => useAudioWaveform({ ...options(), load: async () => blob }));
    await waitFor(() => expect(view.result.current.status).toBe("too-large"));
    expect(conversion).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
  });

  it("converts Blob once and rejects duration only discovered after decoding", async () => {
    const bytes = new ArrayBuffer(8), blob = new Blob(["audio"]);
    const conversion = vi.fn().mockResolvedValue(bytes); Object.defineProperty(blob, "arrayBuffer", { value: conversion });
    decode.mockResolvedValue(buffer(MAX_WAVEFORM_DURATION_SEC + 1));
    const view = renderHook(() => useAudioWaveform({ ...options(), load: async () => blob }));
    await waitFor(() => expect(view.result.current.status).toBe("too-large"));
    expect(decode).toHaveBeenCalledExactlyOnceWith(bytes); expect(conversion).toHaveBeenCalledOnce();
    expect(view.result.current.data).toBeNull();
  });

  it("rejects an oversized ArrayBuffer and an empty input", async () => {
    const bytes = new ArrayBuffer(8); Object.defineProperty(bytes, "byteLength", { value: MAX_WAVEFORM_INPUT_BYTES + 1 });
    const props = options(); props.load = vi.fn().mockResolvedValueOnce(bytes).mockResolvedValueOnce(new ArrayBuffer(0));
    const view = renderHook(() => useAudioWaveform(props));
    await waitFor(() => expect(view.result.current.status).toBe("too-large"));
    act(() => view.result.current.retry()); await waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(decode).not.toHaveBeenCalled();
  });

  it.each(["missing", "constructor", "context-rate", "decoded-rate"])("reports unsupported for %s without high-rate retries", async kind => {
    if (kind === "missing") vi.stubGlobal("OfflineAudioContext", undefined);
    if (kind === "constructor") vi.stubGlobal("OfflineAudioContext", class { constructor() { construct(); throw new Error("rate unsupported"); } });
    if (kind === "context-rate") vi.stubGlobal("OfflineAudioContext", class { sampleRate = 44100; decodeAudioData = decode; constructor() { construct(); } });
    if (kind === "decoded-rate") decode.mockResolvedValue(buffer(2, 44100));
    const props = options(), view = renderHook(() => useAudioWaveform(props));
    await waitFor(() => expect(view.result.current.status).toBe("unsupported"));
    expect(construct.mock.calls.length).toBeLessThanOrEqual(1);
    if (kind !== "decoded-rate") expect(props.load).not.toHaveBeenCalled();
  });

  it("supports prefixed OfflineAudioContext without creating a playback context", async () => {
    vi.stubGlobal("webkitOfflineAudioContext", globalThis.OfflineAudioContext);
    vi.stubGlobal("OfflineAudioContext", undefined); const playback = vi.fn(); vi.stubGlobal("AudioContext", playback);
    const view = renderHook(() => useAudioWaveform(options()));
    await waitFor(() => expect(view.result.current.status).toBe("ready")); expect(playback).not.toHaveBeenCalled();
  });
});

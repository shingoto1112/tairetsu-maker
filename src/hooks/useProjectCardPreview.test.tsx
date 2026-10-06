// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { ProjectRecord, ProjectSummary } from "../repositories/types";
import { createProjectSummary } from "../project/codec";
import { createProjectCardPreviewModel } from "../utils/projectCardPreviewModel";
import { ProjectCardPreviewCache, ProjectCardPreviewReader, projectCardPreviewKey,
  useProjectCardPreview, type ProjectCardPreviewSource } from "./useProjectCardPreview";

const record = (id = "one", revision = "1"): ProjectRecord => ({
  project: { ...createSampleProject(), id }, repositoryRevision: revision, localRevision: revision, sync: null,
});
const summary = (id = "one", revision = "1") => createProjectSummary(record(id).project, revision, null);
const deferred = () => {
  let resolve!: (value: ProjectRecord | null) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<ProjectRecord | null>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

type Observed = { callback: IntersectionObserverCallback; target?: Element; disconnect: () => void };
const observers = (): Observed[] => {
  const all: Observed[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    private observed: Observed;
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      expect(options.rootMargin).toBe("100px");
      this.observed = { callback, disconnect: vi.fn() }; all.push(this.observed);
    }
    observe(target: Element) { this.observed.target = target; }
    disconnect() { this.observed.disconnect(); }
  });
  return all;
};
const intersect = (observer: Observed, visible = true) => observer.callback([
  { target: observer.target!, isIntersecting: visible } as IntersectionObserverEntry,
], {} as IntersectionObserver);
function Harness({ item = summary(), source }: { item?: ProjectSummary; source: ProjectCardPreviewSource }) {
  const { ref, model } = useProjectCardPreview(item, source);
  return <div ref={ref}>{model ? `${model.width}:${model.points[0]?.x}` : "placeholder"}</div>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("preview LRU and keys", () => {
  it("keys by ID and full string repository revision without delimiter collisions", () => {
    expect(projectCardPreviewKey(summary("one", "1"))).not.toBe(projectCardPreviewKey(summary("one", "2")));
    expect(projectCardPreviewKey({ id: "a:1", repositoryRevision: "2" })).not.toBe(
      projectCardPreviewKey({ id: "a", repositoryRevision: "12" }));
    expect(projectCardPreviewKey(summary("one", "9007199254740993"))).toContain("9007199254740993");
  });
  it("evicts least recently used entries, enforces total primitives and rejects oversized entries", () => {
    const model = createProjectCardPreviewModel(record().project)!;
    const cache = new ProjectCardPreviewCache(2, 10);
    cache.set("a", model); cache.set("b", model);
    expect(cache.get("a")).toBe(model);
    cache.set("c", model);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2); expect(cache.pointCount).toBe(10);
    cache.set("a", { ...model, objects: [], points: [model.points[0]] });
    expect(cache.pointCount).toBe(6);
    cache.set("huge", { ...model, points: Array(11).fill(model.points[0]) });
    expect(cache.get("huge")).toBeUndefined(); expect(cache.pointCount).toBe(6);
    const weighted = new ProjectCardPreviewCache(32, 5);
    weighted.set("a", model); weighted.set("b", model);
    expect(weighted.size).toBe(1); expect(weighted.get("a")).toBeUndefined();
    const standard = new ProjectCardPreviewCache();
    for (let i = 0; i < 33; i++) standard.set(String(i), model);
    expect(standard.size).toBe(32); expect(standard.get("0")).toBeUndefined();
  });
});

describe("shared read scheduler", () => {
  it.each([1, 2])("honors concurrency %i and cancels queued work", async concurrency => {
    const waits = new Map<string, ReturnType<typeof deferred>>();
    const source = { concurrency, get: vi.fn((id: string) => {
      const wait = deferred(); waits.set(id, wait); return wait.promise;
    }) };
    const reader = new ProjectCardPreviewReader(source);
    for (let i = 0; i < concurrency; i++) reader.request(summary(String(i)), vi.fn());
    const cancelled = vi.fn(), cancel = reader.request(summary("cancelled"), cancelled);
    const next = vi.fn(); reader.request(summary("next"), next);
    expect(source.get).toHaveBeenCalledTimes(concurrency);
    cancel(); waits.get("0")!.resolve(record("0")); await flush();
    expect(source.get).toHaveBeenCalledTimes(concurrency + 1);
    expect(source.get).not.toHaveBeenCalledWith("cancelled");
    waits.get("next")!.resolve(record("next"));
    for (let i = 1; i < concurrency; i++) waits.get(String(i))!.resolve(record(String(i)));
    await flush(); expect(next).toHaveBeenCalledOnce(); expect(cancelled).not.toHaveBeenCalled();
  });
  it("deduplicates active reads and serves detached cached models on re-entry", async () => {
    const wait = deferred(), source = { concurrency: 2, get: vi.fn(() => wait.promise) };
    const reader = new ProjectCardPreviewReader(source), first = vi.fn(), second = vi.fn();
    const cancel = reader.request(summary(), first); reader.request(summary(), second); cancel();
    const body = record(); wait.resolve(body); await flush();
    expect(source.get).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
    const model = second.mock.calls[0][0];
    body.project.frames[0].positions.m_anna.x = 88;
    const cached = vi.fn(); reader.request(summary(), cached);
    expect(cached).toHaveBeenCalledWith(model); expect(model.points[0].x).toBe(3);
    expect(source.get).toHaveBeenCalledOnce();
  });
  it("keeps cancelled in-flight reads counted, discards their result and releases the queue", async () => {
    const wait = deferred(), source = { concurrency: 1, get: vi.fn()
      .mockImplementationOnce(() => wait.promise).mockResolvedValue(record("two")) };
    const reader = new ProjectCardPreviewReader(source), first = vi.fn(), second = vi.fn();
    const cancel = reader.request(summary(), first); cancel(); reader.request(summary("two"), second);
    expect(source.get).toHaveBeenCalledOnce();
    wait.resolve(record()); await flush();
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
    expect(reader.cache.get(projectCardPreviewKey(summary()))).toBeUndefined();
  });
  it("rejoins an in-flight read on quick re-entry and never shares between sources", async () => {
    const wait = deferred(), source = { concurrency: 1, get: vi.fn(() => wait.promise) };
    const reader = new ProjectCardPreviewReader(source), first = vi.fn(), second = vi.fn();
    reader.request(summary(), first)(); reader.request(summary(), second);
    wait.resolve(record()); await flush();
    expect(source.get).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
    const otherSource = { concurrency: 1, get: vi.fn().mockResolvedValue(record()) };
    new ProjectCardPreviewReader(otherSource).request(summary(), vi.fn()); await flush();
    expect(otherSource.get).toHaveBeenCalledOnce();
  });
  it("does not cache failures, missing records, revision mismatches or wrong IDs", async () => {
    const source = { concurrency: 1, get: vi.fn()
      .mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce(null).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(record("one", "2")).mockResolvedValueOnce(record("other"))
      .mockResolvedValueOnce(record()) };
    const log = vi.spyOn(console, "error"), reader = new ProjectCardPreviewReader(source);
    for (let i = 0; i < 5; i++) {
      const listener = vi.fn(); reader.request(summary(), listener); await flush();
      expect(listener).toHaveBeenCalledWith(null); expect(reader.cache.size).toBe(0);
    }
    const listener = vi.fn(); reader.request(summary(), listener); await flush();
    expect(listener.mock.calls[0][0]).not.toBeNull(); expect(reader.cache.size).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });
  it("contains a synchronous get failure and continues draining", async () => {
    const source = { concurrency: 1, get: vi.fn().mockImplementationOnce(() => { throw new Error("private"); })
      .mockResolvedValueOnce(record("two")) };
    const reader = new ProjectCardPreviewReader(source), first = vi.fn(), second = vi.fn();
    reader.request(summary(), first); reader.request(summary("two"), second); await flush();
    expect(first).toHaveBeenCalledWith(null); expect(second.mock.calls[0][0]).not.toBeNull();
  });
  it("makes pending cancellation idempotent when the same key is queued again", async () => {
    const wait = deferred(), source = { concurrency: 1, get: vi.fn()
      .mockImplementationOnce(() => wait.promise).mockResolvedValue(record("two")) };
    const reader = new ProjectCardPreviewReader(source);
    reader.request(summary(), vi.fn());
    const cancelled = vi.fn(), cancel = reader.request(summary("two"), cancelled);
    cancel();
    const first = vi.fn(), second = vi.fn();
    reader.request(summary("two"), first); cancel(); reader.request(summary("two"), second);
    wait.resolve(record()); await flush();
    expect(source.get).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("viewport hook", () => {
  it.each([50, 200])("does not read all %i mounted cards at startup", async count => {
    const all = observers(), wait = deferred(), source = { concurrency: 2, get: vi.fn(() => wait.promise) };
    render(<>{Array.from({ length: count }, (_, i) => <Harness key={i} item={summary(String(i))} source={source} />)}</>);
    expect(source.get).not.toHaveBeenCalled();
    act(() => all.slice(0, 4).forEach(observer => intersect(observer)));
    expect(source.get).toHaveBeenCalledTimes(2);
    act(() => all.slice(2, 4).forEach(observer => intersect(observer, false)));
    await act(async () => { wait.resolve(null); await flush(); });
    expect(source.get).toHaveBeenCalledTimes(2);
  });
  it("shows placeholder offscreen, reuses cached data on return, and disconnects", async () => {
    const all = observers(), source = { concurrency: 1, get: vi.fn().mockResolvedValue(record()) };
    const view = render(<Harness source={source} />);
    await act(async () => { intersect(all[0]); await flush(); });
    expect(view.container.textContent).toBe("12:3");
    act(() => intersect(all[0], false)); expect(view.container.textContent).toBe("placeholder");
    await act(async () => { intersect(all[0]); await flush(); });
    expect(view.container.textContent).toBe("12:3"); expect(source.get).toHaveBeenCalledOnce();
    view.unmount(); expect(all[0].disconnect).toHaveBeenCalledOnce();
    act(() => intersect(all[0])); expect(source.get).toHaveBeenCalledOnce();
  });
  it("discards an old revision response after a newer revision renders", async () => {
    const all = observers(), old = deferred(), newer = deferred();
    const source = { concurrency: 2, get: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise) };
    const view = render(<Harness source={source} />);
    act(() => intersect(all[0]));
    view.rerender(<Harness source={source} item={summary("one", "2")} />);
    const newRecord = record("one", "2"); newRecord.project.stage.widthMeters = 21;
    await act(async () => { newer.resolve(newRecord); await flush(); });
    expect(view.container.textContent).toBe("21:3");
    await act(async () => { old.resolve(record()); await flush(); });
    expect(view.container.textContent).toBe("21:3"); expect(source.get).toHaveBeenCalledTimes(2);
  });
  it("discards responses from a replaced source and after leaving the viewport", async () => {
    const all = observers(), old = deferred(), pending = deferred();
    const oldSource = { concurrency: 1, get: vi.fn(() => old.promise) };
    const source = { concurrency: 1, get: vi.fn(() => pending.promise) };
    const view = render(<Harness source={oldSource} />);
    act(() => intersect(all[0])); view.rerender(<Harness source={source} />);
    await act(async () => { old.resolve(record()); await flush(); });
    expect(view.container.textContent).toBe("placeholder");
    act(() => intersect(all[0], false));
    await act(async () => { pending.resolve(record()); await flush(); });
    expect(view.container.textContent).toBe("placeholder");
  });
  it("does not read without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const source = { concurrency: 2, get: vi.fn().mockResolvedValue(record()) };
    expect(render(<Harness source={source} />).container.textContent).toBe("placeholder");
    expect(source.get).not.toHaveBeenCalled();
  });
});

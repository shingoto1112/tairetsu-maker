import { useEffect, useRef, useState } from "react";
import type { ProjectRecord, ProjectSummary } from "../repositories/types";
import { createProjectCardPreviewModel, type ProjectCardPreviewModel } from "../utils/projectCardPreviewModel";

/** Keep this object stable (e.g. useMemo), and bind get to its repository. */
export type ProjectCardPreviewSource = {
  get(id: string): Promise<ProjectRecord | null | undefined>;
  concurrency: number;
};

export const projectCardPreviewKey = (summary: Pick<ProjectSummary, "id" | "repositoryRevision">): string =>
  JSON.stringify([summary.id, summary.repositoryRevision]);

/** Bounded by entries AND drawing primitives. Oversized models are displayed but not cached. */
export class ProjectCardPreviewCache {
  private entries = new Map<string, ProjectCardPreviewModel>();
  private weight = 0;
  constructor(private readonly maxEntries = 32, private readonly maxPoints = 4096) {}
  get size() { return this.entries.size; }
  get pointCount() { return this.weight; }
  get(key: string): ProjectCardPreviewModel | undefined {
    const model = this.entries.get(key);
    if (model) { this.entries.delete(key); this.entries.set(key, model); }
    return model;
  }
  set(key: string, model: ProjectCardPreviewModel): void {
    const previous = this.entries.get(key);
    if (previous) { this.weight -= this.cost(previous); this.entries.delete(key); }
    const cost = this.cost(model);
    if (this.maxEntries <= 0 || cost > this.maxPoints) return;
    this.entries.set(key, model); this.weight += cost;
    while (this.entries.size > this.maxEntries || this.weight > this.maxPoints) {
      const oldest = this.entries.keys().next().value!;
      this.weight -= this.cost(this.entries.get(oldest)!); this.entries.delete(oldest);
    }
  }
  private cost(model: ProjectCardPreviewModel) { return model.points.length + model.objects.length; }
}

type Listener = (model: ProjectCardPreviewModel | null) => void;
type Job = { key: string; id: string; revision: string; running: boolean; listeners: Set<Listener> };

/** One scheduler per source. An in-flight get occupies its slot until it settles, even after cancellation. */
export class ProjectCardPreviewReader {
  readonly cache = new ProjectCardPreviewCache();
  private jobs = new Map<string, Job>();
  private pending: Job[] = [];
  private active = 0;
  constructor(private readonly source: ProjectCardPreviewSource) {}
  request(summary: Pick<ProjectSummary, "id" | "repositoryRevision">, listener: Listener): () => void {
    const key = projectCardPreviewKey(summary), cached = this.cache.get(key);
    if (cached) { listener(cached); return () => {}; }
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, id: summary.id, revision: summary.repositoryRevision, running: false, listeners: new Set() };
      this.jobs.set(key, job); this.pending.push(job);
    }
    // Each subscription needs its own identity, even if callers reuse a callback.
    const subscription: Listener = model => listener(model);
    job.listeners.add(subscription);
    this.drain();
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      job.listeners.delete(subscription);
      if (!job.running && job.listeners.size === 0) {
        this.jobs.delete(key); this.pending = this.pending.filter(candidate => candidate !== job);
      }
    };
  }
  private drain(): void {
    const limit = Number.isFinite(this.source.concurrency) ? Math.max(1, Math.floor(this.source.concurrency)) : 1;
    while (this.active < limit && this.pending.length) {
      const job = this.pending.shift()!;
      job.running = true; this.active++;
      void this.read(job);
    }
  }
  private async read(job: Job): Promise<void> {
    let model: ProjectCardPreviewModel | null = null;
    try {
      // Only this local variable ever holds a full record, including its collaboration data.
      const record = await this.source.get(job.id);
      if (job.listeners.size && record?.repositoryRevision === job.revision && record.project.id === job.id) {
        model = createProjectCardPreviewModel(record.project);
      }
    } catch { /* Read/validation failure leaves the neutral placeholder; never log record or exception. */ }
    if (model && job.listeners.size) this.cache.set(job.key, model);
    this.jobs.delete(job.key);
    this.active--;
    const listeners = [...job.listeners];
    job.listeners.clear();
    // Start already queued work before publishing results to React subscribers.
    this.drain();
    for (const listener of listeners) listener(model);
  }
}

const readers = new WeakMap<ProjectCardPreviewSource, ProjectCardPreviewReader>();
const getReader = (source: ProjectCardPreviewSource): ProjectCardPreviewReader => {
  let reader = readers.get(source);
  if (!reader) { reader = new ProjectCardPreviewReader(source); readers.set(source, reader); }
  return reader;
};

export function useProjectCardPreview(summary: ProjectSummary, source: ProjectCardPreviewSource) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{
    key: string; source: ProjectCardPreviewSource; model: ProjectCardPreviewModel | null;
  } | null>(null);
  const key = projectCardPreviewKey(summary);
  const generation = useRef(0);
  useEffect(() => {
    const element = ref.current;
    // Fail closed: environments without viewport observation never initiate bulk reads.
    if (!element || typeof IntersectionObserver === "undefined") return;
    let live = true;
    const observer = new IntersectionObserver(entries => {
      if (live) for (const entry of entries) if (entry.target === element) setVisible(entry.isIntersecting);
    }, { rootMargin: "100px", threshold: 0 });
    observer.observe(element);
    return () => { live = false; observer.disconnect(); };
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    setResult(null);
    if (!visible) return;
    const cancel = getReader(source).request({ id: summary.id, repositoryRevision: summary.repositoryRevision }, model => {
      if (generation.current === current) setResult({ key, source, model });
    });
    return () => { generation.current++; cancel(); };
  }, [visible, key, source, summary.id, summary.repositoryRevision]);
  return { ref, model: visible && result?.key === key && result.source === source ? result.model : null };
}

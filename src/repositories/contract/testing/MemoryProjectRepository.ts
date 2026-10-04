// Test oracle only. Never import this module from application code.
import { createProjectSummary, serializeProject } from "../../../project/codec";
import { assertStorageId } from "../../ids";
import { validateCollaboration, validateCollaborationTransition } from "../../collaborationData";
import { assertCollaborationExtends, validateCollaborationProject } from "../../../collaboration/persistence";
import {
  assertRevision, compareRevisions, incrementRevision, RepositoryError,
  type CommitReceipt, type CommitRequest, type ListQuery, type Page,
  type ProjectRecord, type ProjectRepository, type ProjectSummary,
  type RemoveRequest, type RenameRequest,
} from "../../types";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const scalarCompare = (a: string, b: string): number => {
  const aa = Array.from(a, c => c.codePointAt(0)!);
  const bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
};
const sortTime = (s: ProjectSummary) => {
  const time = Date.parse(s.lastOpenedAt ?? s.updatedAt ?? s.createdAt);
  return Number.isFinite(time) ? time : 0;
};
const order = (a: ProjectSummary, b: ProjectSummary) => sortTime(b) - sortTime(a) || scalarCompare(a.id, b.id);

export class MemoryProjectRepository implements ProjectRepository {
  private records = new Map<string, ProjectRecord>();
  private operations = new Map<string, { signature: string; receipt?: CommitReceipt }>();

  async initialize() { return { status: "ready" as const, schemaVersion: 1, errors: [] }; }

  async get(id: string): Promise<ProjectRecord | null> {
    assertStorageId(id);
    return this.records.has(id) ? clone(this.records.get(id)!) : null;
  }

  async list(query: ListQuery): Promise<Page<ProjectSummary>> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100 ||
        (query.mode !== undefined && query.mode !== "stage" && query.mode !== "parade")) {
      throw new RepositoryError("INVALID_ARGUMENT");
    }
    let after: ProjectSummary | undefined;
    if (query.cursor !== undefined) {
      try {
        const parsed = JSON.parse(query.cursor) as { mode?: string; time: number; id: string };
        if (parsed.mode !== query.mode || !Number.isFinite(parsed.time) || !assertStorageId(parsed.id)) throw new Error();
        after = { id: parsed.id, updatedAt: new Date(parsed.time).toISOString() } as ProjectSummary;
      } catch { throw new RepositoryError("INVALID_ARGUMENT"); }
    }
    const all = [...this.records.values()].map(r => createProjectSummary(r.project, r.repositoryRevision, r.sync, r.collaboration))
      .filter(s => (!query.mode || s.mode === query.mode) && (!after || order(s, after) > 0)).sort(order);
    const items = all.slice(0, query.limit);
    const last = items[items.length - 1];
    return clone({ items, nextCursor: all.length > items.length && last ?
      JSON.stringify({ ...(query.mode ? { mode: query.mode } : {}), time: sortTime(last), id: last.id }) : null });
  }

  private replay(operationId: string, signature: string) {
    assertStorageId(operationId);
    const previous = this.operations.get(operationId);
    if (previous && previous.signature !== signature) throw new RepositoryError("CONFLICT", operationId);
    return previous;
  }

  private existing(id: string, expected: string, operationId: string) {
    assertStorageId(id);
    assertRevision(expected);
    const r = this.records.get(id);
    if (!r) throw new RepositoryError("NOT_FOUND", operationId);
    if (r.repositoryRevision !== expected) throw new RepositoryError("CONFLICT", operationId);
    return r;
  }

  async commit(input: CommitRequest): Promise<CommitReceipt> {
    // Capture synchronously, before any asynchronous boundary.
    const encoded = serializeProject(input.project);
    if (!encoded.ok) throw encoded.error;
    const request = clone(input);
    if (request.collaboration) { request.collaboration = validateCollaboration(request.collaboration); validateCollaborationProject(request.collaboration, request.project); }
    assertRevision(request.localRevision);
    if (request.expectedRepositoryRevision !== null) assertRevision(request.expectedRepositoryRevision);
    const signature = JSON.stringify({ kind: "commit", request });
    const previous = this.replay(request.operationId, signature);
    if (previous) return clone(previous.receipt!);
    const id = assertStorageId(request.project.id);
    const current = this.records.get(id);
    if (request.expectedRepositoryRevision === null) {
      if (current) throw new RepositoryError("CONFLICT", request.operationId);
    } else {
      this.existing(id, request.expectedRepositoryRevision, request.operationId);
      if (compareRevisions(request.localRevision, current!.localRevision) <= 0) throw new RepositoryError("CONFLICT", request.operationId);
    }
    const repositoryRevision = current ? incrementRevision(current.repositoryRevision) : "1";
    validateCollaborationTransition(current?.collaboration, request.collaboration);
    if (current?.collaboration && request.collaboration) assertCollaborationExtends(current.collaboration, request.collaboration);
    const record: ProjectRecord = { project: request.project, localRevision: request.localRevision,
      repositoryRevision, sync: current?.sync ?? null, ...(request.collaboration ? { collaboration: request.collaboration } : {}) };
    const receipt = { id, operationId: request.operationId, repositoryRevision,
      localRevision: request.localRevision, summary: createProjectSummary(record.project, repositoryRevision, record.sync, record.collaboration) };
    this.records.set(id, record);
    this.operations.set(request.operationId, { signature, receipt });
    return clone(receipt);
  }

  async rename(input: RenameRequest): Promise<CommitReceipt> {
    const request = clone(input);
    const signature = JSON.stringify({ kind: "rename", request });
    const previous = this.replay(request.operationId, signature);
    if (previous) return clone(previous.receipt!);
    if (typeof request.title !== "string" || !request.title.trim() || !Number.isFinite(Date.parse(request.updatedAt))) throw new RepositoryError("INVALID_ARGUMENT", request.operationId);
    assertRevision(request.localRevision);
    const current = this.existing(request.id, request.expectedRepositoryRevision, request.operationId);
    if (compareRevisions(request.localRevision, current.localRevision) <= 0) throw new RepositoryError("CONFLICT", request.operationId);
    const record = { ...current, project: { ...current.project, title: request.title, updatedAt: request.updatedAt },
      localRevision: request.localRevision, repositoryRevision: incrementRevision(current.repositoryRevision) };
    const receipt = { id: request.id, operationId: request.operationId, repositoryRevision: record.repositoryRevision,
      localRevision: record.localRevision, summary: createProjectSummary(record.project, record.repositoryRevision, record.sync, record.collaboration) };
    this.records.set(request.id, record);
    this.operations.set(request.operationId, { signature, receipt });
    return clone(receipt);
  }

  async touchOpened(id: string, at: string): Promise<ProjectSummary> {
    assertStorageId(id);
    if (!Number.isFinite(Date.parse(at))) throw new RepositoryError("INVALID_ARGUMENT");
    const current = this.records.get(id);
    if (!current) throw new RepositoryError("NOT_FOUND");
    const record = { ...current, project: { ...current.project, lastOpenedAt: at }, repositoryRevision: incrementRevision(current.repositoryRevision) };
    this.records.set(id, record);
    return clone(createProjectSummary(record.project, record.repositoryRevision, record.sync, record.collaboration));
  }

  async remove(input: RemoveRequest): Promise<void> {
    const request = clone(input);
    const signature = JSON.stringify({ kind: "remove", request });
    if (this.replay(request.operationId, signature)) return;
    this.existing(request.id, request.expectedRepositoryRevision, request.operationId);
    this.records.delete(request.id);
    this.operations.set(request.operationId, { signature });
  }
}

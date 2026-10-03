import operations from "./fixtures/operations.json";
import projects from "./fixtures/commitProjects.json";
import {
  compareRevisions, type CommitReceipt, type CommitRequest, type ListQuery,
  type ProjectRecord, type ProjectRepository, type ProjectSummary,
  type RemoveRequest, type RenameRequest,
} from "../types";
import type { Project } from "../../types";

type Expected = null | Record<string, unknown>;
type ProjectInput = { projectKey: string; patch?: Record<string, unknown>; localRevision: string;
  expectedRepositoryRevision: string | null; operationId: string };
type Step = { expect: Expected } & (
  | ({ op: "commit" } & ProjectInput)
  | { op: "get"; id: string }
  | { op: "list"; query: ListQuery & { usePreviousCursor?: boolean } }
  | { op: "rename"; input: RenameRequest }
  | { op: "remove"; input: RemoveRequest }
  | { op: "touchOpened"; id: string; at: string }
  | { op: "duplicate"; sourceId: string; id: string; title: string; at: string; operationId: string }
  | { op: "concurrentCommits"; requests: ProjectInput[] }
  | ({ op: "commitWithEdit"; editedTitle: string; editorLocalRevision: string } & ProjectInput)
);
export type ContractFixture = { formatVersion: number; scenarios: { name: string; steps: Step[] }[] };

const fail = (message: string): never => { throw new Error(message); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equal = (actual: unknown, expected: unknown, path = "result"): void => {
  if (expected === null || typeof expected !== "object") {
    if (actual !== expected) fail(`${path}: value mismatch`);
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) fail(`${path}: array mismatch`);
    expected.forEach((v, i) => equal((actual as unknown[])[i], v, `${path}[${i}]`));
  } else {
    if (!actual || typeof actual !== "object") fail(`${path}: object missing`);
    for (const [key, v] of Object.entries(expected)) equal((actual as Record<string, unknown>)[key], v, `${path}.${key}`);
  }
};
const code = (error: unknown): unknown =>
  error && typeof error === "object" && "code" in error ? error.code : undefined;

/** Fixture expectations are recursive subsets; arrays and null are exact.
 * No Vitest/DOM/Node dependency. Each scenario receives a fresh isolated store.
 * JSON format and runner semantics are documented alongside the fixtures.
 */
export const runRepositoryContract = async (
  createRepository: () => ProjectRepository | Promise<ProjectRepository>,
  fixture: ContractFixture = operations as ContractFixture,
): Promise<{ scenarios: number; steps: number }> => {
  if (fixture.formatVersion !== 1) fail("unsupported contract fixture version");
  let steps = 0;
  for (const scenario of fixture.scenarios) {
    const repository = await createRepository();
    equal(await repository.initialize(), { status: "ready", errors: [] });
    let previousCursor: string | null = null;
    const requestFor = (input: ProjectInput): CommitRequest => {
      const raw = (projects as Record<string, unknown>)[input.projectKey];
      if (!raw) fail("unknown project fixture");
      return { project: { ...clone(raw as Project), ...input.patch },
        localRevision: input.localRevision, expectedRepositoryRevision: input.expectedRepositoryRevision, operationId: input.operationId };
    };
    // Compute independently from the codec under test; never trust the stored summary.
    const verifySummary = async (summary: ProjectSummary) => {
      const record = await repository.get(summary.id);
      if (!record) fail("summary without body");
      const { project: p, repositoryRevision } = record as ProjectRecord;
      equal(summary, { id: p.id, title: p.title, mode: p.mode ?? "stage",
        createdAt: p.createdAt ?? p.updatedAt, updatedAt: p.updatedAt, lastOpenedAt: p.lastOpenedAt,
        memberCount: p.members.length, sceneCount: p.frames.length, audioId: p.audio?.id, repositoryRevision });
    };
    const verifyReceipt = async (receipt: CommitReceipt, request?: CommitRequest) => {
      equal(receipt, { id: receipt.summary.id, repositoryRevision: receipt.summary.repositoryRevision });
      // Replay may describe an older persisted revision; validate its own result
      // against the current body only when the revisions still match.
      const record = await repository.get(receipt.id);
      if (record?.repositoryRevision === receipt.repositoryRevision) {
        await verifySummary(receipt.summary);
        equal(record.localRevision, receipt.localRevision);
        if (request) equal(record.project, clone(request.project));
      }
      if (request) equal(receipt, { localRevision: request.localRevision, operationId: request.operationId });
    };
    for (const [index, step] of scenario.steps.entries()) {
      let result: unknown;
      try {
        switch (step.op) {
          case "commit": {
            const request = requestFor(step);
            const receipt = await repository.commit(request);
            await verifyReceipt(receipt, request);
            result = receipt;
            break;
          }
          case "get": {
            result = await repository.get(step.id);
            // Mutating a read must never mutate persisted state.
            if (result) {
              const copy = clone(result) as ProjectRecord;
              (result as ProjectRecord).project.title = "detached read mutation";
              equal(await repository.get(step.id), copy);
              result = copy;
            }
            break;
          }
          case "list": {
            const { usePreviousCursor, ...query } = step.query;
            if (usePreviousCursor) {
              if (previousCursor === null) fail("previous page has no cursor");
              query.cursor = previousCursor as string;
            }
            const page = await repository.list(query);
            previousCursor = page.nextCursor;
            for (const summary of page.items) await verifySummary(summary);
            result = { ids: page.items.map(s => s.id), hasNext: page.nextCursor !== null };
            break;
          }
          case "rename": result = await repository.rename(step.input); await verifyReceipt(result as CommitReceipt); break;
          case "remove": await repository.remove(step.input); result = null; break;
          case "touchOpened": result = await repository.touchOpened(step.id, step.at); await verifySummary(result as ProjectSummary); break;
          case "duplicate": {
            const source = await repository.get(step.sourceId);
            if (!source) fail("duplicate source missing");
            const project = { ...source!.project, id: step.id, title: step.title, createdAt: step.at, updatedAt: step.at };
            delete project.lastOpenedAt;
            const request = { project, localRevision: "1", expectedRepositoryRevision: null, operationId: step.operationId };
            result = await repository.commit(request);
            await verifyReceipt(result as CommitReceipt, request);
            break;
          }
          case "concurrentCommits": {
            const requests = step.requests.map(requestFor);
            const settled = await Promise.allSettled(requests.map(r => repository.commit(r)));
            for (const [i, r] of settled.entries()) if (r.status === "fulfilled") await verifyReceipt(r.value, requests[i]);
            result = { successes: settled.filter(r => r.status === "fulfilled").length,
              errors: settled.filter(r => r.status === "rejected").map(r => code((r as PromiseRejectedResult).reason)) };
            break;
          }
          case "commitWithEdit": {
            const request = requestFor(step);
            const snapshot = clone(request);
            const pending = repository.commit(request);
            request.project.title = step.editedTitle;
            const receipt = await pending;
            await verifyReceipt(receipt, snapshot);
            result = { receiptLocalRevision: receipt.localRevision, editorLocalRevision: step.editorLocalRevision,
              dirty: compareRevisions(step.editorLocalRevision, receipt.localRevision) > 0 };
            break;
          }
          default: fail("unknown operation");
        }
      } catch (error) {
        if (step.expect && "error" in step.expect && code(error) === step.expect.error) { steps++; continue; }
        // Avoid including project bodies or names in failure output.
        throw new Error(`Contract ${scenario.name}, step ${index + 1} (${step.op}) failed: ${String(code(error) ?? "assertion")}`);
      }
      if (step.expect && "error" in step.expect) fail(`step ${index + 1}: expected rejection`);
      equal(result, step.expect, `step ${index + 1}`);
      steps++;
    }
  }
  return { scenarios: fixture.scenarios.length, steps };
};

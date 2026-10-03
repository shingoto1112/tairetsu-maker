import { describe, expect, it } from "vitest";
import { runRepositoryContract } from "./runRepositoryContract";
import { MemoryProjectRepository } from "./testing/MemoryProjectRepository";

describe("platform-independent repository contract", () => {
  it("passes the JSON operation sequence on the isolated memory oracle", async () => {
    const result = await runRepositoryContract(() => new MemoryProjectRepository());
    expect(result.scenarios).toBe(2);
    expect(result.steps).toBe(50);
  });
  it("rejects an adapter that falsely maps read errors to missing", async () => {
    const repository = new MemoryProjectRepository();
    repository.get = async () => null;
    await expect(runRepositoryContract(() => repository)).rejects.toThrow();
  });
  it("rejects an adapter with incorrect CAS", async () => {
    const repository = new MemoryProjectRepository();
    const commit = repository.commit.bind(repository);
    repository.commit = async input => {
      if (input.operationId === "stale_a") return commit({ ...input, expectedRepositoryRevision: "2" });
      return commit(input);
    };
    await expect(runRepositoryContract(() => repository)).rejects.toThrow();
  });
  it("rejects an adapter with an incorrect list order", async () => {
    const repository = new MemoryProjectRepository();
    const list = repository.list.bind(repository);
    repository.list = async query => {
      const page = await list(query);
      page.items.reverse();
      return page;
    };
    await expect(runRepositoryContract(() => repository)).rejects.toThrow();
  });
  it("requires unreadable records to reject rather than return null", async () => {
    const fixture = { formatVersion: 1, scenarios: [{ name: "unreadable", steps: [
      { op: "get" as const, id: "damaged", expect: { error: "CORRUPT" } },
    ] }] };
    const repository = new MemoryProjectRepository();
    const { RepositoryError } = await import("../types");
    repository.get = async () => { throw new RepositoryError("CORRUPT"); };
    expect(await runRepositoryContract(() => repository, fixture)).toEqual({ scenarios: 1, steps: 1 });
    repository.get = async () => null;
    await expect(runRepositoryContract(() => repository, fixture)).rejects.toThrow();
  });
});

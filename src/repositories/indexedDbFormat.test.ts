import { describe, expect, it } from "vitest";
import { jsonIntegrity, scalarKey, encodeSummary } from "./indexedDbFormat";
import fixture from "./contract/fixtures/collaboration.json";
import projects from "./contract/fixtures/commitProjects.json";
import type { Project } from "../types";
import type { CollaborationData } from "./types";
import { classifyIndexedDbError } from "./indexedDbRepository";
import { RepositoryError } from "./types";

describe("IndexedDB format and error boundaries", () => {
  it("projects only lightweight attachment identity into summaries", () => {
    const collaboration = { ...fixture.initial, transportBinding: { accountId: "11111111-1111-4111-8111-111111111111", membershipGeneration: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } as CollaborationData;
    const record = { project: projects.stage as Project, collaboration, repositoryRevision: "1", localRevision: "1", sync: null };
    expect(encodeSummary(record).summary.sharing).toEqual({ documentId: collaboration.sharedDocumentId, ...collaboration.transportBinding });
    expect(JSON.stringify(encodeSummary(record))).not.toContain(collaboration.base);
    expect(encodeSummary({ ...record, collaboration: { ...collaboration, sharedDocumentId: null } }).summary.sharing).toBeUndefined();
  });
  it("uses the standard CRC-32/ISO-HDLC vector and UTF-8 byte length", () => {
    expect(jsonIntegrity("123456789")).toEqual({ byteLength: 9, crc32: "cbf43926" });
    expect(jsonIntegrity("日本語😀").byteLength).toBe(13);
  });
  it("orders astral IDs by Unicode scalar value, including prefix IDs", () => {
    expect(["😀", "\ue000", "a", "aa"].sort((a, b) => scalarKey(a) < scalarKey(b) ? -1 : 1)).toEqual(["a", "aa", "\ue000", "😀"]);
  });
  it.each([
    ["QuotaExceededError", "QUOTA_EXCEEDED"], ["InvalidStateError", "BUSY"],
    ["TransactionInactiveError", "BUSY"], ["SecurityError", "ACCESS_DENIED"],
    ["NotAllowedError", "ACCESS_DENIED"], ["VersionError", "UNSUPPORTED_SCHEMA"],
    ["DataError", "CORRUPT"], ["DataCloneError", "CORRUPT"],
    ["AbortError", "IO_ERROR"], ["UnknownError", "IO_ERROR"],
  ])("classifies %s as %s without exposing input", (name, code) => {
    expect(classifyIndexedDbError(new DOMException("private body/path", name), "operation-a")).toMatchObject({ code, operationId: "operation-a" });
    expect(classifyIndexedDbError(new DOMException("private body/path", name)).message).not.toContain("private");
  });
  it("keeps domain errors and attaches the operation ID", () => {
    expect(classifyIndexedDbError(new RepositoryError("CONFLICT"), "op")).toMatchObject({ code: "CONFLICT", operationId: "op" });
  });
});

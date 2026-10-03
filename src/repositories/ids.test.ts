import { describe, expect, it } from "vitest";
import cases from "./contract/fixtures/ids.json";
import { assertStorageId, isValidStorageId } from "./ids";
import { compareRevisions, incrementRevision, isRevision, RepositoryError, REPOSITORY_ERROR_MESSAGES } from "./types";

describe("portable ID test table", () => {
  it.each(cases.map((c, index) => ({ ...c, index })))("case $index", ({ value, valid }) => {
    expect(isValidStorageId(value)).toBe(valid);
    if (valid) expect(assertStorageId(value)).toBe(value);
    else expect(() => assertStorageId(value)).toThrowError(expect.objectContaining({ code: "INVALID_ID" }));
  });
});
describe("decimal revisions and classified errors", () => {
  it.each(["", "01", "-1", "+1", "1.0", "1e3", " 1", "1\n"])("rejects noncanonical revision", value => {
    expect(isRevision(value)).toBe(false);
    expect(() => incrementRevision(value)).toThrow(RepositoryError);
  });
  it("compares and increments beyond JS safe integer and signed bigint", () => {
    expect(compareRevisions("9", "10")).toBe(-1);
    expect(compareRevisions("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareRevisions("123", "123")).toBe(0);
    expect(incrementRevision("0")).toBe("1");
    expect(incrementRevision("1999")).toBe("2000");
    expect(incrementRevision("999999999999999999999")).toBe("1000000000000000000000");
  });
  it("maps every code to Japanese text without exposing payloads", () => {
    for (const code of Object.keys(REPOSITORY_ERROR_MESSAGES) as (keyof typeof REPOSITORY_ERROR_MESSAGES)[]) {
      const error = new RepositoryError(code, "operation_001");
      expect(error.message).toBe(REPOSITORY_ERROR_MESSAGES[code]);
      expect(error.operationId).toBe("operation_001");
    }
  });
});

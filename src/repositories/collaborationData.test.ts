import { expect, it } from "vitest";
import fixture from "./contract/fixtures/collaboration.json";
import { COLLABORATION_LIMITS, base64Bytes, validateCollaboration, validateCollaborationTransition } from "./collaborationData";
import type { CollaborationData } from "./types";

it("bounds decoded base/updates/total, entry counts and rejects noncanonical base64", () => {
  const data = fixture.initial as CollaborationData;
  expect(base64Bytes(btoa("a".repeat(COLLABORATION_LIMITS.baseBytes)), COLLABORATION_LIMITS.baseBytes)).toBe(COLLABORATION_LIMITS.baseBytes);
  expect(() => validateCollaboration({ ...data, base: "AB==" })).toThrowError();
  expect(() => validateCollaboration({ ...data, base: "AAAA".repeat(Math.ceil(COLLABORATION_LIMITS.baseBytes / 3) + 1) })).toThrowError(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
  const bytes = btoa("a".repeat(COLLABORATION_LIMITS.updateBytes));
  const journal = Array.from({ length: 65 }, (_, i) => ({ updateId: `size-${i}`, bytes, source: "remote" }));
  expect(() => validateCollaboration({ ...data, journal })).toThrowError(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
  expect(() => validateCollaboration({ ...data, outbox: Array.from({ length: COLLABORATION_LIMITS.entries + 1 }, () => ({})) })).toThrowError(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
  expect(() => validateCollaboration({ ...data, journal: fixture.updates })).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
});
it("rejects immutable identity/bytes and ACK/cursor/epoch rollback", () => {
  const data = { ...fixture.initial, outbox: [{ ...fixture.updates[0], status: "sent" }] } as unknown as CollaborationData;
  for (const next of [{ ...data, generation: "2" }, { ...data, sharedDocumentId: "other" },
    { ...data, outbox: [{ ...data.outbox[0], status: "pending" }] }, { ...data, outbox: [{ ...data.outbox[0], bytes: "AAAA" }] }]) {
    expect(() => validateCollaborationTransition(data, next as CollaborationData)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
  }
});

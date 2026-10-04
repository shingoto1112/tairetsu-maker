import { isValidStorageId } from "./ids";
/** Optional cross-platform summary projection; no IndexedDB/Yjs dependency. */
export const validSharingSummary = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shared = value as Record<string, unknown>;
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  return isValidStorageId(shared.documentId) && Object.keys(shared).every(key => ["documentId", "accountId", "membershipGeneration"].includes(key)) &&
    (shared.accountId === undefined && shared.membershipGeneration === undefined || uuid(shared.accountId) && uuid(shared.membershipGeneration));
};

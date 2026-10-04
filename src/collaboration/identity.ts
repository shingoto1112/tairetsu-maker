const uuid = (v: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);

/** Local record identity is separate from immutable creator CRDT identity. */
export function isSharedLocalAlias(localId: string | undefined, documentId?: string | null): boolean {
  const prefix = `shared-${documentId}-`;
  return !!documentId && uuid(documentId) && !!localId?.startsWith(prefix) && uuid(localId.slice(prefix.length));
}
export const newSharedLocalId = (documentId: string): string => {
  if (!uuid(documentId)) throw new Error("Invalid document identity");
  return `shared-${documentId}-${crypto.randomUUID()}`;
};

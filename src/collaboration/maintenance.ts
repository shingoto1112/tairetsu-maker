import * as Y from 'yjs';
// @ts-ignore Deno source import.
import { inspectWire, assertResolvedDocument, assertValidatedDocument, documentCausality, SERVER_LIMITS, ValidationError } from './serverValidation.ts';
// @ts-ignore Deno source import.
import { canonicalCheckpointContent, projectCheckpointContent, validateCheckpointDTO, type CheckpointDTO } from './checkpoint.ts';

export type MaintenanceCut = { documentId: string; generation: string; cutSeq: string; documentSchema: 1 | 2;
  snapshot: { id: string; uptoSeq: string; bytes: Uint8Array }; updates: { seq: string; bytes: Uint8Array }[] };
const seq = (value: string) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const fail = (code: string): never => { throw new ValidationError(code); };
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), b => b.toString(16).padStart(2, '0')).join('');
}

/** One confirmed replay. No simultaneous source/GC/reloaded Docs. Source is
 * validated with GC disabled so overwritten/deleted malicious Items survive. */
export async function buildMaintenanceOutput(cut: MaintenanceCut, operation: 'compact' | 'automatic' | 'manual',
  actor: string, serverAt: string, sample: () => void = () => {}): Promise<{ bytes: Uint8Array; digest: string; elapsedMs: number }> {
  const start = performance.now();
  if (!seq(cut.cutSeq) || !seq(cut.snapshot.uptoSeq) || BigInt(cut.snapshot.uptoSeq) > BigInt(cut.cutSeq)) fail('INVALID_CHECKPOINT_CUT');
  if (!cut.snapshot.bytes.length || cut.snapshot.bytes.length > SERVER_LIMITS.snapshotBytes || cut.updates.length > SERVER_LIMITS.entries ||
    cut.updates.reduce((n, u) => n + u.bytes.length, 0) > SERVER_LIMITS.logBytes) fail('QUOTA_EXCEEDED');
  let cursor = BigInt(cut.snapshot.uptoSeq);
  for (const u of cut.updates) if (!seq(u.seq) || BigInt(u.seq) !== ++cursor || !u.bytes.length || u.bytes.length > SERVER_LIMITS.updateBytes) fail('INCOMPLETE_SERVER_STATE');
  if (cursor !== BigInt(cut.cutSeq)) fail('INCOMPLETE_SERVER_STATE');
  let full: Uint8Array | undefined, causal = '', canonical: Uint8Array;
  let doc: Y.Doc | undefined = new Y.Doc({ gc: false });
  try {
    inspectWire(cut.snapshot.bytes); Y.applyUpdate(doc, cut.snapshot.bytes);
    // The pinned validation boundary checks dependencies after every apply too.
    assertResolvedDocument(doc);
    for (const u of cut.updates) {
      inspectWire(u.bytes); Y.applyUpdate(doc, u.bytes); assertResolvedDocument(doc);
      if (performance.now() - start > SERVER_LIMITS.validationMs) fail('VALIDATION_BUDGET');
    }
    assertValidatedDocument(doc, cut.documentSchema);
    canonical = canonicalCheckpointContent({ formatVersion: 1, sharedSchemaVersion: cut.documentSchema, ...projectCheckpointContent(doc, cut.documentSchema) });
    if (operation === 'compact') { full = Y.encodeStateAsUpdate(doc); causal = documentCausality(doc); }
    sample();
  } finally { doc.destroy(); doc = undefined; }
  if (operation !== 'compact') {
    const payload = JSON.parse(new TextDecoder().decode(canonical!));
    const digest = await sha256(canonical!);
    await validateCheckpointDTO({ ...payload, documentId: cut.documentId, generation: cut.generation, confirmedSeq: cut.cutSeq,
      digest, reason: operation, requestedBy: actor, automatic: operation === 'automatic', serverAt } satisfies CheckpointDTO);
    sample();
    return { bytes: canonical!, digest, elapsedMs: performance.now() - start };
  }
  let gcDoc: Y.Doc | undefined = new Y.Doc({ gc: true });
  let bytes: Uint8Array;
  try {
    Y.applyUpdate(gcDoc, full!); full = undefined;
    assertResolvedDocument(gcDoc);
    bytes = Y.encodeStateAsUpdate(gcDoc); sample();
  } finally { gcDoc.destroy(); gcDoc = undefined; }
  if (!bytes!.length || bytes!.length > SERVER_LIMITS.snapshotBytes) fail('QUOTA_EXCEEDED');
  let reload: Y.Doc | undefined = new Y.Doc({ gc: false });
  try {
    inspectWire(bytes!); Y.applyUpdate(reload, bytes!); assertValidatedDocument(reload, cut.documentSchema);
    const reprojected = canonicalCheckpointContent({ formatVersion: 1, sharedSchemaVersion: cut.documentSchema, ...projectCheckpointContent(reload, cut.documentSchema) });
    if (documentCausality(reload) !== causal || canonical!.length !== reprojected.length || canonical!.some((b, i) => b !== reprojected[i])) fail('COMPACTION_MISMATCH');
    sample();
  } finally { reload.destroy(); reload = undefined; }
  return { bytes: bytes!, digest: await sha256(bytes!), elapsedMs: performance.now() - start };
}

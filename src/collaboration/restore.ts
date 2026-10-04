import * as Y from 'yjs';
// @ts-ignore Deno source import.
import { inspectWire, assertResolvedDocument, assertValidatedDocument, SERVER_LIMITS, ValidationError } from './serverValidation.ts';
// @ts-ignore Deno source import.
import { canonicalCheckpointContent, projectCheckpointContent, materializeCheckpoint, inspectCheckpointDTO, type CheckpointDTO } from './checkpoint.ts';
// @ts-ignore Deno source import.
import { planSharedRestoreContent, sharedDifferences, contentDifferences, effectiveSharedContent } from './restorePlan.ts';
// @ts-ignore Deno source import.
import { sha256, type MaintenanceCut } from './maintenance.ts';

export type RestoreOutput = { beforeBytes: Uint8Array; beforeDigest: string; update: Uint8Array; updateDigest: string;
  targetSeq: string; targetDigest: string; title: string; elapsedMs: number; differences: string[] };
const fail = (code: string): never => { throw new ValidationError(code); };
/** No Project-to-shared conversion, no historical binary application. The only
 * replay is H; the logical checkpoint is edited into that working document. */
export async function buildRestoreOutput(cut: MaintenanceCut, input: unknown, sample: () => void = () => {}): Promise<RestoreOutput> {
  const start = performance.now();
  const { target, expected } = await inspectCheckpointDTO(input, (doc, target) => { sample(); return { target, expected: effectiveSharedContent(doc) }; });
  if (target.documentId !== cut.documentId || target.generation !== cut.generation || target.sharedSchemaVersion !== cut.documentSchema) fail('CHECKPOINT_DOCUMENT_MISMATCH');
  if (!/^(0|[1-9][0-9]{0,18})$/.test(cut.cutSeq) || !/^(0|[1-9][0-9]{0,18})$/.test(cut.snapshot.uptoSeq) ||
    BigInt(cut.snapshot.uptoSeq) > BigInt(cut.cutSeq) || BigInt(target.confirmedSeq) > BigInt(cut.cutSeq)) fail('INVALID_CHECKPOINT_CUT');
  if (!cut.snapshot.bytes.length || cut.snapshot.bytes.length > SERVER_LIMITS.snapshotBytes || cut.updates.length > SERVER_LIMITS.entries ||
    cut.updates.reduce((n, u) => n + u.bytes.length, 0) > SERVER_LIMITS.logBytes) fail('QUOTA_EXCEEDED');
  let cursor = BigInt(cut.snapshot.uptoSeq);
  let doc: Y.Doc | undefined = new Y.Doc({ gc: false });
  try {
    inspectWire(cut.snapshot.bytes); Y.applyUpdate(doc, cut.snapshot.bytes); assertResolvedDocument(doc);
    for (const u of cut.updates) {
      if (!/^(0|[1-9][0-9]{0,18})$/.test(u.seq) || BigInt(u.seq) !== ++cursor || !u.bytes.length || u.bytes.length > SERVER_LIMITS.updateBytes) fail('INCOMPLETE_SERVER_STATE');
      inspectWire(u.bytes); Y.applyUpdate(doc, u.bytes); assertResolvedDocument(doc);
    }
    if (String(cursor) !== cut.cutSeq) fail('INCOMPLETE_SERVER_STATE');
    assertValidatedDocument(doc, cut.documentSchema);
    sample();
    const beforeBytes = canonicalCheckpointContent({ formatVersion: 1, sharedSchemaVersion: cut.documentSchema, ...projectCheckpointContent(doc, cut.documentSchema) });
    sample();
    const vector = Y.encodeStateVector(doc);
    doc.transact(() => planSharedRestoreContent(doc!, target, true), Symbol('server restore'));
    sample();
    const update = Y.encodeStateAsUpdate(doc, vector);
    // One transaction only; never split this into several appends.
    if (update.length > SERVER_LIMITS.updateBytes) fail('RESTORE_UPDATE_TOO_LARGE');
    inspectWire(update); assertValidatedDocument(doc, cut.documentSchema);
    if (Y.encodeStateAsUpdate(doc).length > SERVER_LIMITS.snapshotBytes) fail('QUOTA_EXCEEDED');
    const differences = contentDifferences(effectiveSharedContent(doc), expected);
    if (differences.length) fail('RESTORE_CONTENT_MISMATCH');
    sample();
    const title = cut.documentSchema === 2 ? (doc.getMap('settings').get('title') as { title: string }).title : '隊列表';
    if (performance.now() - start > SERVER_LIMITS.validationMs) fail('VALIDATION_BUDGET');
    doc.destroy(); doc = undefined; // Release before async digest/output transport.
    return { beforeBytes, beforeDigest: await sha256(beforeBytes), update, updateDigest: await sha256(update), targetSeq: target.confirmedSeq,
      targetDigest: target.digest, title: Array.from(title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()).slice(0, 120).join('') || '名称未設定',
      differences, elapsedMs: performance.now() - start };
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(e instanceof Error && ['RESTORE_TOPOLOGY_MISMATCH', 'QUOTA_EXCEEDED', 'UNSUPPORTED_SCHEMA'].includes(e.message) ? e.message : 'INVALID_RESTORE');
  } finally { doc?.destroy(); doc = undefined; }
}

export type RestoreReceipt = { result: 'COMMITTED'; documentId: string; generation: string; requestId: string;
  checkpointId: string; targetSeq: string; targetDigest: string; restoreSeq: string; beforeCheckpointId: string; beforeSeq: string; duplicate: boolean };
export type RestoreState = { phase: 'requesting' | 'accepted' | 'committed' | 'applied'; requestId: string; targetSeq?: string; restoreSeq?: string;
  receipt?: RestoreReceipt; differences?: string[]; hasUnsentChanges?: boolean; message: string };
/** Only call with the durable cursor/doc after the existing receive+save path.
 * A failed local save cannot advance this state or clear pending edits. */
export function observeRestore(state: RestoreState, durable: { documentId: string; generation: string; cursor: string; doc: Y.Doc; pending: number }, target: CheckpointDTO): RestoreState {
  const receipt = state.receipt;
  if (!receipt || durable.documentId !== receipt.documentId || durable.generation !== receipt.generation ||
    target.documentId !== receipt.documentId || target.generation !== receipt.generation || target.confirmedSeq !== receipt.targetSeq || target.digest !== receipt.targetDigest ||
    !/^(0|[1-9][0-9]*)$/.test(durable.cursor) || BigInt(durable.cursor) < BigInt(receipt.restoreSeq)) return state;
  const wanted = materializeCheckpoint(target);
  try {
    const differences = sharedDifferences(durable.doc, wanted), pending = durable.pending > 0;
    return { ...state, phase: 'applied', differences, hasUnsentChanges: pending, message: !differences.length ? 'この端末に反映しました' :
      pending ? 'この端末の未送信の編集を含むため、指定した状態と異なる項目があります' :
      BigInt(durable.cursor) > BigInt(receipt.restoreSeq) ? 'その後の共同編集により、指定した状態と異なる項目があります' : '指定した状態との相違を確認してください' };
  } finally { wanted.destroy(); }
}

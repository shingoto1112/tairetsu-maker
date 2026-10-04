import { Capacitor } from '@capacitor/core';
import { runIdbTransaction } from '../utils/idbTransaction';
import { RepositoryError, type CommitRequest } from '../repositories/types';
import type { CheckpointDTO } from './checkpoint';
import type { RestoreRequest } from './historyApi';
import type { RestoreState } from './restore';

export type HistoryOperation = {
  version: 1; revision: number;
  restore?: { request: RestoreRequest; target: CheckpointDTO; state: RestoreState; confirmed: boolean; failed?: string };
  copy?: { checkpointId: string; request: CommitRequest; message: string; saved: boolean; opened?: boolean };
};
export interface HistoryJournal {
  read(key: string): Promise<HistoryOperation | null>;
  write(key: string, expected: number, value: HistoryOperation): Promise<void>;
}
const check = (v: HistoryOperation | null) => {
  if (v && (v.version !== 1 || !Number.isSafeInteger(v.revision) || v.revision < 1 || (!v.restore && !v.copy))) throw new RepositoryError('CORRUPT');
  return v;
};
const classify = (e: unknown) => e instanceof RepositoryError ? e : new RepositoryError(e instanceof DOMException && e.name === 'QuotaExceededError' ? 'NO_SPACE' : 'IO_ERROR');
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  let blocked = false;
  const request = indexedDB.open('tairetsu-collaboration-operations', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('operations');
  request.onerror = () => reject(classify(request.error));
  request.onblocked = () => { blocked = true; reject(new RepositoryError('BUSY')); };
  request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
});
/** Separate operation journal; no scan or upgrade of Project records. A broken
 * operation isolates that document's history actions, never repository startup.
 * Strict IDB CAS also fences simultaneous tabs before any restore is sent. */
export const indexedHistoryJournal: HistoryJournal = {
  async read(key) {
    const db = await database();
    try { return check(await runIdbTransaction<HistoryOperation | null>(db, 'operations', 'readonly', (tx, result) => {
      const request = tx.objectStore('operations').get(key); request.onsuccess = () => result(request.result ?? null);
    }, classify)); } finally { db.close(); }
  },
  async write(key, expected, value) {
    check(value); if (value.revision !== expected + 1) throw new RepositoryError('INVALID_ARGUMENT');
    const db = await database();
    try { await runIdbTransaction<void>(db, 'operations', 'readwrite', (tx, result, fail) => {
      const store = tx.objectStore('operations'), request = store.get(key);
      request.onsuccess = () => {
        try {
          const old = check(request.result ?? null);
          if ((old?.revision ?? 0) !== expected) return fail(new RepositoryError('CONFLICT'));
          store.put(value, key); result();
        } catch (e) { fail(e); }
      };
    }, classify); } finally { db.close(); }
  },
};
const folder = async (key: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return `Application Support/collaboration-operations/${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
};
const nativeRead = async (key: string): Promise<HistoryOperation | null> => {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const path = await folder(key);
  let names: string[];
  try { names = (await Filesystem.readdir({ directory: Directory.LibraryNoCloud, path })).files.map(f => f.name).filter(n => /^\d{12}-[0-9a-f-]{36}\.json$/.test(n)).sort(); }
  catch (e) { if ((e as { code?: string }).code === 'OS-PLUG-FILE-0008') return null; throw classify(e); }
  if (!names.length) return null;
  // Never roll back to an older intent after an invalid newest record.
  const data = (await Filesystem.readFile({ directory: Directory.LibraryNoCloud, path: `${path}/${names[names.length - 1]}`, encoding: Encoding.UTF8 })).data;
  if (typeof data !== 'string' || data.length > 32 * 1048576) throw new RepositoryError('CORRUPT');
  try { return check(JSON.parse(data)); } catch { throw new RepositoryError('CORRUPT'); }
};
/** iPad uses Application Support via LibraryNoCloud, not WebView IndexedDB.
 * Append/rename publishes an immutable revision. A crash before rename has
 * never sent the action; a crash after it reopens the SAME operation. */
export const nativeHistoryJournal: HistoryJournal = {
  read: nativeRead,
  async write(key, expected, value) {
    check(value);
    if (!globalThis.navigator?.locks) throw new RepositoryError('UNSUPPORTED_SCHEMA');
    await navigator.locks.request(`tairetsu-history-${await folder(key)}`, async () => {
      if (((await nativeRead(key))?.revision ?? 0) !== expected) throw new RepositoryError('CONFLICT');
      if (value.revision !== expected + 1 || value.revision > 999999999999) throw new RepositoryError('INVALID_ARGUMENT');
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const path = await folder(key), name = `${String(value.revision).padStart(12, '0')}-${crypto.randomUUID()}`;
      const data = JSON.stringify(value); if (data.length > 32 * 1048576) throw new RepositoryError('QUOTA_EXCEEDED');
      try {
        await Filesystem.writeFile({ directory: Directory.LibraryNoCloud, path: `${path}/${name}.tmp`, data, encoding: Encoding.UTF8, recursive: true });
        await Filesystem.rename({ directory: Directory.LibraryNoCloud, from: `${path}/${name}.tmp`, to: `${path}/${name}.json` });
        // Keep newest two published revisions. Cleanup failure cannot invalidate
        // the publication; the reader always chooses the newest revision.
        const files = (await Filesystem.readdir({ directory: Directory.LibraryNoCloud, path })).files;
        for (const f of files) if (/^\d{12}-[0-9a-f-]{36}\.json$/.test(f.name) && Number(f.name.slice(0, 12)) < value.revision - 1)
          await Filesystem.deleteFile({ directory: Directory.LibraryNoCloud, path: `${path}/${f.name}` }).catch(() => {});
      } catch (e) { throw classify(e); }
    });
  },
};
export const createHistoryJournal = () => Capacitor.isNativePlatform() ? nativeHistoryJournal : indexedHistoryJournal;

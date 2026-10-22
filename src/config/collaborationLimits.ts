/** Network acceptance is deliberately smaller than device recovery storage.
 * Do not lower storage limits: old attachments/backups must remain rescuable.
 * SQL mirrors these network defaults; scripts/check-collab-v2.mjs verifies them.
 * Swift mirrors only DEVICE_COLLABORATION_LIMITS (unchanged in 9c). */
export const DEVICE_COLLABORATION_LIMITS = Object.freeze({ updateBytes: 256 * 1024, baseBytes: 8 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024, jsonBytes: 24 * 1024 * 1024, entries: 4096, compactEntries: 128, compactBytes: 1024 * 1024 });
export const SHARED_DOCUMENT_LIMITS = Object.freeze({ updateBytes: 262144, snapshotBytes: 2097152,
  logBytes: 1048576, entries: 512, members: 300, scenes: 100, positions: 20000,
  structs: 50000, clients: 1024, validationMs: 1000, compactEntries: 64, compactBytes: 262144 });

/** Direct Broadcast: count sends AND deliveries. Shared by all local packet types.
 * This is an estimate per room, not a global/project quota or abuse prevention. */
export type EphemeralBudgetSettings = { enabled: boolean; maxHz: number; messagesPerSecond: number;
  reservePerSecond: number; minimumConnections: number; maxConnections: number; connectionTtlMs: number;
  pollMs: number; permitMs: number };
export const EPHEMERAL_BUDGET: Readonly<EphemeralBudgetSettings> = Object.freeze({ enabled: true, maxHz: 3, messagesPerSecond: 60,
  reservePerSecond: 12, minimumConnections: 8, maxConnections: 32, connectionTtlMs: 45000,
  pollMs: 30000, permitMs: 15000 });

/** Creation slots are independent of per-document content and byte limits. */
export const SHARED_CREATION_LIMITS = Object.freeze({ activeDocumentsPerCreator: 20 });

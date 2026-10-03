import type { BootstrapOptions, StorageBootstrapResult } from "./migrationCoordinator";
import { RepositoryError } from "../repositories/types";

// Tiny lazy boundary for step 5. No App/platform barrel import in this phase.
let inFlight: Promise<StorageBootstrapResult> | undefined;
export const runStorageBootstrap = (options: Partial<BootstrapOptions> = {}): Promise<StorageBootstrapResult> => {
  // Injected repositories are independent (tests/tools); default bootstrap is single-flight.
  if (options.repository) return import("./migrationCoordinator").then(m => m.migrateLegacyStorage(options as BootstrapOptions));
  if (inFlight) return inFlight;
  const work = async () => {
    const { getAppRuntime } = await import("../platform/runtime");
    const native = getAppRuntime() === "capacitor-ios";
    const repository = native
      ? new (await import("../repositories/nativeSqliteRepository")).NativeSqliteProjectRepository()
      : new (await import("../repositories/indexedDbRepository")).IndexedDbProjectRepository();
    try {
      const readers = options.readers ?? (native ? { native: await (await import("./legacyReaders")).createCapacitorLegacyReader() } : {});
      return await (await import("./migrationCoordinator")).migrateLegacyStorage({ ...options, repository, readers });
    } finally { if ("close" in repository) repository.close(); }
  };
  inFlight = work().catch(e => ({ completed: false, canContinue: false, migratedCount: 0, recoveryCount: 0, duplicateCount: 0,
    failures: [{ code: e instanceof RepositoryError ? e.code : "IO_ERROR" as const }], audioMigration: "deferred" as const }))
    .finally(() => { inFlight = undefined; });
  return inFlight;
};

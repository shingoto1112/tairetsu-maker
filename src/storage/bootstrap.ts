import type { BootstrapOptions, StorageBootstrapResult } from "./migrationCoordinator";
import { RepositoryError } from "../repositories/types";
import { getAppRuntime } from "../platform/runtime";

// App startup awaits this lazy boundary. No platform barrel import.
let inFlight: Promise<StorageBootstrapResult> | undefined;
export const runStorageBootstrap = (options: Partial<BootstrapOptions> = {}): Promise<StorageBootstrapResult> => {
  // Injected repositories are independent (tests/tools); default bootstrap is single-flight.
  if (options.repository) return import("./migrationCoordinator").then(m => m.migrateLegacyStorage(options as BootstrapOptions));
  if (inFlight) return inFlight;
  const work = async () => {
    const { Capacitor } = await import("@capacitor/core");
    // Same rule as prepareAppRepository: the dev-only iPad preview has no native plugin.
    const native = getAppRuntime() === "capacitor-ios" && Capacitor.isNativePlatform();
    const repository = native
      ? new (await import("../repositories/nativeSqliteRepository")).NativeSqliteProjectRepository()
      : new (await import("../repositories/indexedDbRepository")).IndexedDbProjectRepository();
    try {
      const readers = options.readers ?? (native ? { native: await (await import("./legacyReaders")).createCapacitorLegacyReader(), includeDrafts: false } : { includeDrafts: false });
      return await (await import("./migrationCoordinator")).migrateLegacyStorage({ ...options, repository, readers });
    } finally { if ("close" in repository) repository.close(); }
  };
  inFlight = work().catch(e => ({ completed: false, canContinue: false, migratedCount: 0, recoveryCount: 0, duplicateCount: 0,
    failures: [{ code: e instanceof RepositoryError ? e.code : "IO_ERROR" as const }], audioMigration: "deferred" as const }))
    .finally(() => { inFlight = undefined; });
  return inFlight;
};

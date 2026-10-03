/** Separate databases require an origin-wide barrier. Pending audio records cover
 * the gap between publishing bytes and committing a Project. Without Web Locks GC skips. */
export const withStorageWrite = <T>(work: () => Promise<T>): Promise<T> =>
  globalThis.navigator?.locks ? navigator.locks.request("tairetsu-storage-maintenance", { mode: "shared" }, work) : work();
export const withStorageMaintenance = <T>(work: () => Promise<T>, skipped: T): Promise<T> =>
  globalThis.navigator?.locks ? navigator.locks.request("tairetsu-audio-editors", { mode: "exclusive", ifAvailable: true }, lock =>
    lock ? navigator.locks.request("tairetsu-storage-maintenance", { mode: "exclusive" }, work) : skipped) : Promise.resolve(skipped);

/** Protect in-memory edits (including a Project deleted by another tab). GC
 * skips while any editor is open, instead of making startup wait for that tab. */
export const protectAudioEditor = (): Promise<() => Promise<void>> => {
  if (!globalThis.navigator?.locks) return Promise.resolve(async () => {});
  return new Promise(resolve => {
    const request = navigator.locks.request("tairetsu-audio-editors", { mode: "shared" }, () => new Promise<void>(release =>
      resolve(async () => { release(); await request; })));
  });
};

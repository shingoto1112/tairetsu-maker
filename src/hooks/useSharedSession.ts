import { useRef } from "react";
import type { SharedSessionController, SharedSessionOptions } from "../collaboration/sharedSessionController";
import type { ProjectRecord, ProjectRepository } from "../repositories/types";
import { SharedSessionStore } from "../storage/sharedSessionState";
import type { Project } from "../types";

/** Stable imperative session host. No effect watches or writes Project. The
 * status store is subscribed by a separate UI in 8a-2, not by the Canvas owner. */
export function useSharedSession() {
  const ref = useRef<ReturnType<typeof createHost> | null>(null);
  ref.current ??= createHost(); return ref.current;
}
function createHost() {
  let active: SharedSessionController | null = null;
  let generation = 0;
  const backgrounds = new Map<string, { controller: SharedSessionController; done: Promise<void> }>();
  const store = new SharedSessionStore();
  let unsubscribe = () => {};
  const host = {
    store,
    get active() { return active; },
    /** Only after a durable independent copy exists. Refuse a stale rescue
     * while newer edits remain in the live editor. Original disk copy stays. */
    releaseRescued(localId: string, projection: Project) {
      if (!active || active.localId !== localId || JSON.stringify(active.editor.project) !== JSON.stringify(projection)) return false;
      ++generation; active.dispose(); active = null; unsubscribe(); unsubscribe = () => {}; return true;
    },
    async settle(localId: string) {
      const background = backgrounds.get(localId);
      if (background) { background.controller.dispose(); await background.done; backgrounds.delete(localId); }
    },
    async open(repository: ProjectRepository, record: ProjectRecord, options: SharedSessionOptions) {
      const own = ++generation;
      await host.settle(record.project.id!);
      const { SharedSessionController } = await import("../collaboration/sharedSessionController");
      const controller = await SharedSessionController.create(repository, record, { ...options, current: () => own === generation && options.current() });
      if (own !== generation || !options.current()) { controller.dispose(); return null; }
      active = controller; unsubscribe();
      unsubscribe = controller.store.subscribe(() => store.set(controller.store.getSnapshot()));
      store.set(controller.store.getSnapshot()); return controller;
    },
    async close(background = true) {
      if (!active) return true;
      const controller = active;
      if (!await controller.close(background)) return false;
      if (active !== controller) return true;
      ++generation; active = null; unsubscribe(); unsubscribe = () => {};
      const done = controller.beginBackground().finally(() => { if (backgrounds.get(controller.localId)?.controller === controller) backgrounds.delete(controller.localId); });
      backgrounds.set(controller.localId, { controller, done }); return true;
    },
    async shutdown() {
      const current = active;
      if (current && !await current.flush()) return false;
      ++generation; unsubscribe(); active = null;
      current?.dispose();
      for (const background of backgrounds.values()) background.controller.dispose();
      await Promise.all([...backgrounds.values()].map(background => background.done)); backgrounds.clear();
      return true;
    },
  };
  return host;
}

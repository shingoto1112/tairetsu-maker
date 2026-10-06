import { useEffect, useState, useSyncExternalStore } from "react";
import type { CollaborationUiBridge } from "../collaboration/uiTypes";
import type { CollaborationUiService } from "../collaboration/uiService";

type UiSnapshot = ReturnType<CollaborationUiService["getSnapshot"]>;
const noSubscribe = () => () => {};
const noSnapshot = (): UiSnapshot | null => null;

/**
 * Home view of the lazy collaboration service. It loads the service through the
 * same dynamic boundary (no Yjs in the main bundle) and follows its snapshot so
 * the home header and grid can show the account state and cloud-only cards.
 * Initialization and the first refresh stay owned by CollaborationSurface.
 */
export const useCollaborationLibrary = (bridge: CollaborationUiBridge, enabled: boolean) => {
  const [service, setService] = useState<CollaborationUiService | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void bridge.get().then((loaded) => { if (live) setService(loaded); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [bridge, enabled]);
  const ui = useSyncExternalStore<UiSnapshot | null>(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? noSnapshot);
  return enabled ? { service, ui, failed } : { service: null, ui: null, failed: false };
};

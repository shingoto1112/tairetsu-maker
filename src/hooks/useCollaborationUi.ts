import { useRef } from "react";
import type { CollaborationUiBridge } from "../collaboration/uiTypes";
/** The stable host retains invitation/save retries across library/editor views.
 * Implementation and all Yjs dependencies stay behind the dynamic boundary. */
export function useCollaborationUi() {
  const ref = useRef<CollaborationUiBridge | null>(null);
  if (!ref.current) {
    let service: ReturnType<CollaborationUiBridge["get"]> | null = null;
    const bridge: CollaborationUiBridge = { options: null, get: () => service ??= import("../collaboration/uiService").then(({ CollaborationUiService }) => new CollaborationUiService(() => bridge.options!)) };
    ref.current = bridge;
  }
  return ref.current;
}

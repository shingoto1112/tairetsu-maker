import { useLayoutEffect, useMemo, useRef } from "react";
import type { SceneElementEditTarget } from "../types";

type Target = SceneElementEditTarget | SceneElementEditTarget[];
type Begin = (label?: string, target?: Target) => boolean | void | Promise<boolean | void>;
type End = (target?: Target) => void;

export type CanvasEditOperation = {
  readonly active: boolean;
  begin: Begin;
  end: End;
};

export type CanvasEditScope = {
  create: (element: HTMLElement, pointerId: number, begin?: Begin, end?: End) => CanvasEditOperation;
};

// A gesture owns both its pending permission reply and its history batch.
// Cancelling a scope closes that batch immediately; a late reply cannot close
// or revive another gesture, even if its pointer ID is reused.
export function useCanvasEditScope(
  projectId: string | undefined,
  sceneId: string | null | undefined,
  disabled: boolean,
  onBegin: Begin,
  onEnd: End,
): CanvasEditScope {
  const callbacks = useRef({ onBegin, onEnd });
  useLayoutEffect(() => { callbacks.current = { onBegin, onEnd }; });
  const scope = useMemo(() => {
    let alive = false;
    let owner: CanvasEditOperation | null = null;
    return {
      activate: () => { alive = !disabled; },
      cancel: () => { owner?.end(); alive = false; },
      create(element: HTMLElement, pointerId: number, begin?: Begin, finish?: End): CanvasEditOperation {
        owner?.end();
        let started = false;
        let closed = false;
        let target: Target | undefined;
        let end: End | undefined;
        const operation: CanvasEditOperation = {
          get active() { return alive && !closed && owner === operation; },
          begin(label, editTarget) {
            if (!operation.active) return false;
            target = editTarget;
            started = true;
            end = finish ?? callbacks.current.onEnd;
            const result = (begin ?? callbacks.current.onBegin)(label, target);
            const settle = (allowed: boolean | void) => {
              if (!operation.active) return false;
              if (allowed === false) started = false;
              return allowed;
            };
            return result instanceof Promise ? result.then(settle) : settle(result);
          },
          end(editTarget) {
            if (closed || owner !== operation) return;
            closed = true;
            owner = null;
            if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
            if (started) end?.(editTarget ?? target);
          },
        };
        owner = operation;
        return operation;
      },
    };
  }, [projectId, sceneId, disabled]);
  useLayoutEffect(() => {
    scope.activate();
    return () => scope.cancel();
  }, [scope]);
  return scope;
}

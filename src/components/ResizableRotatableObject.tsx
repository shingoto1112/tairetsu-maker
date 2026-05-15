import {
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useEffect,
  useRef,
} from "react";
import {
  ObjectState,
  StageConfig,
  StageObject,
  ViewerPerspective,
} from "../types";
import {
  clientPointToMeters,
  constrainObjectCenterPosition,
  constrainObjectPosition,
  getObjectCenter,
  objectTopLeftFromCenter,
  stagePointToDisplayPoint,
  snapToGrid,
} from "../utils/coordinates";
import {
  createEdgeAutoScroller,
  type EdgeAutoScroller,
} from "../utils/edgeAutoScroll";
import {
  TOUCH_LONG_PRESS_CANCEL_DISTANCE_PX,
} from "../utils/touchLongPress";

type InteractionKind = "move" | "resize" | "rotate";

type DragState = {
  kind: InteractionKind;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  startPointer: { x: number; y: number };
  stageElement: HTMLElement;
  startState: ObjectState;
  startAngle: number;
  hasMoved: boolean;
  isBeginPending: boolean;
};

type ResizableRotatableObjectProps = {
  object: StageObject;
  state: ObjectState;
  stage: StageConfig;
  viewerPerspective: ViewerPerspective;
  selected: boolean;
  disabled: boolean;
  remoteLockOwner?: string | null;
  onSelect: () => void;
  onMove: (state: Partial<ObjectState>) => void;
  onInteractionStart?: (kind: InteractionKind) => boolean | void | Promise<boolean | void>;
  onInteractionEnd?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  onTouchLongPressEnd?: (event: PointerEvent<HTMLElement>) => void;
  onTouchLongPressMove?: (event: PointerEvent<HTMLElement>) => void;
  onTouchLongPressStart?: (event: PointerEvent<HTMLElement>) => void;
  onLockedElementEditAttempt?: (ownerName: string) => void;
};

const OBJECT_DRAG_SNAP_METERS = 0.25;

const getStageElement = (element: HTMLElement): HTMLElement | null =>
  element.closest("[data-stage-surface='true']") as HTMLElement | null;

const getAngle = (
  clientX: number,
  clientY: number,
  objectState: ObjectState,
  stageElement: HTMLElement,
  stage: StageConfig,
  viewerPerspective: ViewerPerspective,
): number => {
  const rect = stageElement.getBoundingClientRect();
  const center = stagePointToDisplayPoint(
    {
      x: objectState.x + objectState.widthMeters / 2,
      y: objectState.y + objectState.heightMeters / 2,
    },
    stage,
    viewerPerspective,
  );
  const centerX =
    rect.left + (center.x / stage.widthMeters) * rect.width;
  const centerY =
    rect.top + (center.y / stage.depthMeters) * rect.height;
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
};

export const ResizableRotatableObject = ({
  object,
  state,
  stage,
  viewerPerspective,
  selected,
  disabled,
  remoteLockOwner = null,
  onSelect,
  onMove,
  onInteractionStart,
  onInteractionEnd,
  onContextMenu,
  onTouchLongPressEnd,
  onTouchLongPressMove,
  onTouchLongPressStart,
  onLockedElementEditAttempt,
}: ResizableRotatableObjectProps) => {
  const dragRef = useRef<DragState | null>(null);
  const autoScrollerRef = useRef<EdgeAutoScroller | null>(null);
  const editable = !disabled && !object.locked && !remoteLockOwner;

  useEffect(
    () => () => {
      autoScrollerRef.current?.stop();
    },
    [],
  );

  const applyDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    drag.currentClientX = clientX;
    drag.currentClientY = clientY;
    if (drag.isBeginPending) {
      return;
    }
    if (!drag.hasMoved) {
      drag.isBeginPending = true;
      const beginResult = onInteractionStart?.(drag.kind) ?? true;
      void Promise.resolve(beginResult).then((canEdit) => {
        const latestDrag = dragRef.current;
        if (!latestDrag || latestDrag.pointerId !== drag.pointerId) {
          if (canEdit !== false) {
            onInteractionEnd?.();
          }
          return;
        }
        latestDrag.isBeginPending = false;
        if (canEdit === false) {
          dragRef.current = null;
          autoScrollerRef.current?.stop();
          autoScrollerRef.current = null;
          return;
        }
        latestDrag.hasMoved = true;
        applyDrag(latestDrag.currentClientX, latestDrag.currentClientY);
        autoScrollerRef.current?.update(
          latestDrag.currentClientX,
          latestDrag.currentClientY,
        );
      });
      return;
    }

    if (drag.kind === "rotate") {
      const angle = getAngle(
        clientX,
        clientY,
        drag.startState,
        drag.stageElement,
        stage,
        viewerPerspective,
      );
      onMove({ rotation: drag.startState.rotation + angle - drag.startAngle });
      return;
    }

    const pointer = clientPointToMeters(
      clientX,
      clientY,
      drag.stageElement,
      stage,
      viewerPerspective,
    );
    const dx = pointer.x - drag.startPointer.x;
    const dy = pointer.y - drag.startPointer.y;

    if (drag.kind === "resize") {
      onMove({
        widthMeters: Math.max(
          0.1,
          snapToGrid(
            drag.startState.widthMeters + dx,
            stage.gridSizeMeters,
            stage.showGrid,
          ),
        ),
        heightMeters: Math.max(
          0.1,
          snapToGrid(
            drag.startState.heightMeters + dy,
            stage.gridSizeMeters,
            stage.showGrid,
          ),
        ),
      });
      return;
    }

    const movedCenter = getObjectCenter(
      {
        x: drag.startState.x + dx,
        y: drag.startState.y + dy,
      },
      drag.startState.widthMeters,
      drag.startState.heightMeters,
    );
    const clampedCenter = constrainObjectCenterPosition(
      movedCenter,
      drag.startState.widthMeters,
      drag.startState.heightMeters,
      stage,
    );
    const snappedCenter = constrainObjectCenterPosition(
      {
        x: snapToGrid(clampedCenter.x, OBJECT_DRAG_SNAP_METERS, true),
        y: snapToGrid(clampedCenter.y, OBJECT_DRAG_SNAP_METERS, true),
      },
      drag.startState.widthMeters,
      drag.startState.heightMeters,
      stage,
    );
    const next = constrainObjectPosition(
      objectTopLeftFromCenter(
        snappedCenter,
        drag.startState.widthMeters,
        drag.startState.heightMeters,
      ),
      drag.startState.widthMeters,
      drag.startState.heightMeters,
      stage,
    );
    onMove(next);
  };

  const startInteraction = (
    event: PointerEvent<HTMLElement>,
    kind: InteractionKind,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    onSelect();
    if (remoteLockOwner) {
      onLockedElementEditAttempt?.(remoteLockOwner);
      return;
    }
    onTouchLongPressStart?.(event);
    if (!editable) {
      return;
    }
    const stageElement = getStageElement(event.currentTarget);
    if (!stageElement) {
      return;
    }
    const pointer = clientPointToMeters(
      event.clientX,
      event.clientY,
      stageElement,
      stage,
      viewerPerspective,
    );
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startPointer: pointer,
      stageElement,
      startState: state,
      startAngle:
        kind === "rotate"
          ? getAngle(
              event.clientX,
              event.clientY,
              state,
              stageElement,
              stage,
              viewerPerspective,
            )
          : 0,
      hasMoved: false,
      isBeginPending: false,
    };
    const scrollContainer = stageElement.closest(".stage-fit-area");
    if (scrollContainer instanceof HTMLElement && kind !== "rotate") {
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = createEdgeAutoScroller(scrollContainer, {
        onScroll: () => {
          const drag = dragRef.current;
          if (drag) {
            applyDrag(drag.currentClientX, drag.currentClientY);
          }
        },
      });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.pointerType === "touch" && !drag.hasMoved) {
      onTouchLongPressMove?.(event);
      const movementPx = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (movementPx < TOUCH_LONG_PRESS_CANCEL_DISTANCE_PX) {
        return;
      }
    }
    onTouchLongPressEnd?.(event);
    applyDrag(event.clientX, event.clientY);
    autoScrollerRef.current?.update(event.clientX, event.clientY);
  };

  const stopInteraction = (event: PointerEvent<HTMLElement>) => {
    onTouchLongPressEnd?.(event);
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      if (drag.hasMoved) {
        onInteractionEnd?.();
      }
    }
  };

  const displayTopLeft =
    viewerPerspective === "performer"
      ? {
          x: stage.widthMeters - state.x - state.widthMeters,
          y: stage.depthMeters - state.y - state.heightMeters,
        }
      : { x: state.x, y: state.y };

  const style = {
    left: `${(displayTopLeft.x / stage.widthMeters) * 100}%`,
    top: `${(displayTopLeft.y / stage.depthMeters) * 100}%`,
    width: `${(state.widthMeters / stage.widthMeters) * 100}%`,
    height: `${(state.heightMeters / stage.depthMeters) * 100}%`,
    transform: `rotate(${state.rotation}deg)`,
    zIndex: state.zIndex,
    borderColor: object.color,
    backgroundColor:
      object.type === "area" ? `${object.color}33` : `${object.color}22`,
  };

  return (
    <div
      className={[
        "stage-object",
        `shape-${object.shape}`,
        selected ? "is-selected" : "",
        object.locked ? "is-locked" : "",
        remoteLockOwner ? "is-remote-locked" : "",
      ].join(" ")}
      style={style}
      onPointerDown={(event) => startInteraction(event, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={stopInteraction}
      onPointerCancel={stopInteraction}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      title={remoteLockOwner ? `${remoteLockOwner}が操作中です` : object.name}
    >
      <span className="stage-object__label">{object.name}</span>
      {selected && editable && (
        <>
          <span className="object-anchor-point" aria-hidden="true" />
          <button
            className="rotate-handle"
            onPointerDown={(event) => startInteraction(event, "rotate")}
            onPointerMove={handlePointerMove}
            onPointerUp={stopInteraction}
            onPointerCancel={stopInteraction}
            type="button"
            title="回転"
          />
          <button
            className="resize-handle"
            onPointerDown={(event) => startInteraction(event, "resize")}
            onPointerMove={handlePointerMove}
            onPointerUp={stopInteraction}
            onPointerCancel={stopInteraction}
            type="button"
            title="サイズ変更"
          />
        </>
      )}
    </div>
  );
};

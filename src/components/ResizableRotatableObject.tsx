import { resizeStageObject } from "../utils/stageObjectResize";
import { isStageViewRotated180 } from "../utils/stageOrientation";
import { useCanvasEditScope, type CanvasEditOperation, type CanvasEditScope } from "../hooks/useCanvasEditScope";
import { horizontalGridOriginMeters } from "../utils/horizontalGrid";
import { snapObjectPosition } from "../utils/objectMovement";
import { stageVerticalGridOriginMeters } from "../utils/verticalGrid";
import { objectRenderShape } from "../project/objectAppearance";
import {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useLayoutEffect,
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
  stagePointToDisplayPoint,
} from "../utils/coordinates";
import {
  createEdgeAutoScroller,
  type EdgeAutoScroller,
} from "../utils/edgeAutoScroll";
import {
  TOUCH_LONG_PRESS_CANCEL_DISTANCE_PX,
} from "../utils/touchLongPress";

type InteractionKind = "move" | "resize" | "rotate";
import type { EphemeralSession } from '../collaboration/ephemeralSession';

type DragState = {
  operation: CanvasEditOperation;
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
  latestPatch: Partial<ObjectState> | null;
  hasMoved: boolean;
  isBeginPending: boolean;
  endRequested: boolean;
};

type ResizableRotatableObjectProps = {
  editScope?: CanvasEditScope;
  ephemeral?: EphemeralSession | null;
  sceneId?: string | null;
  object: StageObject;
  state: ObjectState;
  stage: StageConfig;
  viewerPerspective: ViewerPerspective;
  selected: boolean;
  disabled: boolean;
  deferCommit?: boolean;
  remoteLockOwner?: string | null;
  onSelect: () => void;
  onMove: (state: Partial<ObjectState>) => void;
  resolveMove?: (state: Partial<ObjectState>) => Partial<ObjectState>;
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
  editScope: parentEditScope,
  object,
  state,
  stage,
  viewerPerspective,
  selected,
  disabled,
  deferCommit = false,
  remoteLockOwner = null,
  onSelect,
  onMove,
  resolveMove,
  onInteractionStart,
  onInteractionEnd,
  onContextMenu,
  onTouchLongPressEnd,
  onTouchLongPressMove,
  onTouchLongPressStart,
  onLockedElementEditAttempt,
  ephemeral,
  sceneId,
}: ResizableRotatableObjectProps) => {
  const localEditScope = useCanvasEditScope(undefined, sceneId, disabled,
    kind => onInteractionStart?.(kind as InteractionKind), () => onInteractionEnd?.());
  const editScope = parentEditScope ?? localEditScope;
  const objectRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const autoScrollerRef = useRef<EdgeAutoScroller | null>(null);
  const objectDragClearFrameRef = useRef<number | null>(null);
  const editable = !disabled && !object.locked && !remoteLockOwner;

  const cancelPendingObjectDragClear = () => {
    if (objectDragClearFrameRef.current !== null) {
      window.cancelAnimationFrame(objectDragClearFrameRef.current);
      objectDragClearFrameRef.current = null;
    }
  };

  const clearObjectDragPreview = () => {
    const element = objectRef.current;
    if (!element) {
      return;
    }
    element.style.removeProperty("--object-drag-x");
    element.style.removeProperty("--object-drag-y");
    element.style.removeProperty("--object-drag-width");
    element.style.removeProperty("--object-drag-height");
    element.style.removeProperty("--object-drag-rotation");
  };

  const scheduleClearObjectDragPreview = () => {
    cancelPendingObjectDragClear();
    objectDragClearFrameRef.current = window.requestAnimationFrame(() => {
      objectDragClearFrameRef.current = null;
      clearObjectDragPreview();
    });
  };

  useLayoutEffect(
    () => () => {
      dragRef.current?.operation.end();
      dragRef.current = null;
      cancelPendingObjectDragClear();
      clearObjectDragPreview();
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      ephemeral?.cancel();
    },
    [editScope],
  );

  const getDisplayTopLeft = (objectState: ObjectState) =>
    isStageViewRotated180(stage, viewerPerspective)
      ? {
          x: stage.widthMeters - objectState.x - objectState.widthMeters,
          y: stage.depthMeters - objectState.y - objectState.heightMeters,
        }
      : { x: objectState.x, y: objectState.y };

  const previewObjectDrag = (
    drag: DragState,
    patch: Partial<ObjectState>,
  ) => {
    const element = objectRef.current;
    if (!element) {
      return;
    }
    // Preview variables are CSS layout pixels, not zoomed screen pixels.
    const layoutWidth = drag.stageElement.clientWidth;
    const layoutHeight = drag.stageElement.clientHeight;
    const nextState = {
      ...drag.startState,
      ...patch,
      widthMeters: Math.max(
        0.1,
        patch.widthMeters ?? drag.startState.widthMeters,
      ),
      heightMeters: Math.max(
        0.1,
        patch.heightMeters ?? drag.startState.heightMeters,
      ),
    };
    const startDisplayTopLeft = getDisplayTopLeft(drag.startState);
    const nextDisplayTopLeft = getDisplayTopLeft(nextState);
    element.style.setProperty(
      "--object-drag-x",
      `${((nextDisplayTopLeft.x - startDisplayTopLeft.x) / stage.widthMeters) * layoutWidth}px`,
    );
    element.style.setProperty(
      "--object-drag-y",
      `${((nextDisplayTopLeft.y - startDisplayTopLeft.y) / stage.depthMeters) * layoutHeight}px`,
    );
    element.style.setProperty(
      "--object-drag-width",
      `${((nextState.widthMeters - drag.startState.widthMeters) / stage.widthMeters) * layoutWidth}px`,
    );
    element.style.setProperty(
      "--object-drag-height",
      `${((nextState.heightMeters - drag.startState.heightMeters) / stage.depthMeters) * layoutHeight}px`,
    );
    element.style.setProperty(
      "--object-drag-rotation",
      `${(nextState.rotation ?? 0) - drag.startState.rotation}deg`,
    );
  };

  const applyObjectPatch = (
    drag: DragState,
    patch: Partial<ObjectState>,
    measuredAt = 0,
  ) => {
    drag.latestPatch = patch;
    if (deferCommit) {
      previewObjectDrag(drag, patch);
    } else onMove(patch);
    if (drag.kind === 'move') ephemeral?.latestMeasured((patch.x ?? drag.startState.x) - drag.startState.x, (patch.y ?? drag.startState.y) - drag.startState.y, measuredAt);
  };

  const commitDeferredObjectDrag = (drag: DragState) => {
    if (!deferCommit || !drag.latestPatch) {
      return;
    }
    onMove(drag.latestPatch);
    scheduleClearObjectDragPreview();
  };

  const applyDrag = (clientX: number, clientY: number) => {
    const measuredAt = ephemeral ? performance.now() : 0;
    const drag = dragRef.current;
    if (!drag?.operation.active) {
      return;
    }
    drag.currentClientX = clientX;
    drag.currentClientY = clientY;
    if (drag.isBeginPending) {
      return;
    }
    if (!drag.hasMoved) {
      drag.isBeginPending = true;
      const beginResult = drag.operation.begin(drag.kind);
      void Promise.resolve(beginResult).then((canEdit) => {
        const latestDrag = dragRef.current;
        if (latestDrag !== drag || !drag.operation.active) return;
        latestDrag.isBeginPending = false;
        if (canEdit === false) {
          latestDrag.operation.end();
          dragRef.current = null;
          autoScrollerRef.current?.stop();
          autoScrollerRef.current = null;
          return;
        }
        latestDrag.hasMoved = true;
        if (latestDrag.kind === 'move') ephemeral?.begin(sceneId ?? null, [['object', object.id, latestDrag.startState.x, latestDrag.startState.y, latestDrag.startState.widthMeters, latestDrag.startState.heightMeters, latestDrag.startState.rotation]]);
        applyDrag(latestDrag.currentClientX, latestDrag.currentClientY);
        if (latestDrag.endRequested) {
          commitDeferredObjectDrag(latestDrag);
          dragRef.current = null;
          autoScrollerRef.current?.stop();
          autoScrollerRef.current = null;
          latestDrag.operation.end();
          ephemeral?.finish();
          return;
        }
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
      applyObjectPatch(drag, {
        rotation: drag.startState.rotation + angle - drag.startAngle,
      });
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
      applyObjectPatch(drag, resizeStageObject(drag.startState, { x: dx, y: dy }, stage, viewerPerspective));
      return;
    }

    const next = snapObjectPosition({ x: drag.startState.x + dx, y: drag.startState.y + dy }, drag.startState, stage,
      OBJECT_DRAG_SNAP_METERS, { x: horizontalGridOriginMeters(stage.widthMeters, stage.horizontalGuideMode),
        y: stageVerticalGridOriginMeters(stage.depthMeters, stage) }, "center");
    applyObjectPatch(drag, resolveMove ? resolveMove(next) : next, measuredAt);
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
    cancelPendingObjectDragClear();
    dragRef.current = {
      operation: editScope.create(event.currentTarget, event.pointerId,
        kind => onInteractionStart?.(kind as InteractionKind), () => onInteractionEnd?.()),
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
      latestPatch: null,
      hasMoved: false,
      isBeginPending: false,
      endRequested: false,
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
      if (drag.isBeginPending && !drag.hasMoved) {
        drag.endRequested = true;
        drag.currentClientX = event.clientX;
        drag.currentClientY = event.clientY;
        autoScrollerRef.current?.stop();
        autoScrollerRef.current = null;
        return;
      }
      dragRef.current = null;
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      if (drag.hasMoved) {
        commitDeferredObjectDrag(drag);
        if (event.type === 'pointercancel') ephemeral?.cancel(); else ephemeral?.finish();
      }
      drag.operation.end();
    }
  };

  const displayTopLeft = getDisplayTopLeft(state);

  const style: CSSProperties = {
    left: `calc(${(displayTopLeft.x / stage.widthMeters) * 100}% + var(--object-drag-x, 0px))`,
    top: `calc(${(displayTopLeft.y / stage.depthMeters) * 100}% + var(--object-drag-y, 0px))`,
    width: `calc(${(state.widthMeters / stage.widthMeters) * 100}% + var(--object-drag-width, 0px))`,
    height: `calc(${(state.heightMeters / stage.depthMeters) * 100}% + var(--object-drag-height, 0px))`,
    transform: `rotate(calc(${state.rotation}deg + var(--object-drag-rotation, 0deg)))`,
    zIndex: state.zIndex,
    borderColor: object.color,
    backgroundColor:
      object.type === "area" ? `${object.color}33` : `${object.color}22`,
  };

  return (
    <div
      ref={objectRef}
      className={[
        "stage-object",
        `shape-${objectRenderShape(object)}`,
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

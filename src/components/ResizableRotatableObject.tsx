import { MouseEvent as ReactMouseEvent, PointerEvent, useRef } from "react";
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

type InteractionKind = "move" | "resize" | "rotate";

type DragState = {
  kind: InteractionKind;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPointer: { x: number; y: number };
  startState: ObjectState;
  startAngle: number;
  hasMoved: boolean;
};

type ResizableRotatableObjectProps = {
  object: StageObject;
  state: ObjectState;
  stage: StageConfig;
  viewerPerspective: ViewerPerspective;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onMove: (state: Partial<ObjectState>) => void;
  onInteractionStart?: (kind: InteractionKind) => void;
  onInteractionEnd?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
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
  onSelect,
  onMove,
  onInteractionStart,
  onInteractionEnd,
  onContextMenu,
}: ResizableRotatableObjectProps) => {
  const dragRef = useRef<DragState | null>(null);
  const editable = !disabled && !object.locked;

  const startInteraction = (
    event: PointerEvent<HTMLElement>,
    kind: InteractionKind,
  ) => {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    onSelect();
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
      startPointer: pointer,
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
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const stageElement = getStageElement(event.currentTarget);
    if (!stageElement) {
      return;
    }
    if (!drag.hasMoved) {
      onInteractionStart?.(drag.kind);
      drag.hasMoved = true;
    }

    if (drag.kind === "rotate") {
      const angle = getAngle(
        event.clientX,
        event.clientY,
        drag.startState,
        stageElement,
        stage,
        viewerPerspective,
      );
      onMove({ rotation: drag.startState.rotation + angle - drag.startAngle });
      return;
    }

    const pointer = clientPointToMeters(
      event.clientX,
      event.clientY,
      stageElement,
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

  const stopInteraction = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
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
      ].join(" ")}
      style={style}
      onPointerDown={(event) => startInteraction(event, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={stopInteraction}
      onPointerCancel={stopInteraction}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
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

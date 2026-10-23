import { constrainObjectPosition, roundMeters } from "../utils/coordinates";
import { objectPositionBounds } from "../utils/objectGeometry";
import {
  FormationFrame,
  Member,
  MemberGroup,
  ObjectState,
  ParadeSettings,
  Position,
  StageConfig,
  StageObject,
  StageSnapshot,
  Selection,
} from "../types";
import { getMemberDisplayColor } from "../utils/memberAppearance";
import {
  getCenterSplitSideLabel,
  getSafeParadeBackwardDistance,
  getSafeParadeCanvasDistance,
  internalYToParadeDistance,
  normalizeParadeHorizontalMeasureMode,
  paradeDistanceToInternalY,
} from "../utils/parade";
import { NumericInput } from "./NumericInput";
import { useEffect, useRef } from "react";
import { scrollWithinContainer } from "../utils/scrollWithinContainer";

type SelectedPositionCardProps = {
  selected: Selection; selectedMemberIds: string[];
  members: Member[]; memberGroups: MemberGroup[]; objects: StageObject[];
  currentFrame: FormationFrame | null; snapshot: StageSnapshot; stage: StageConfig;
  projectMode?: "stage" | "parade"; paradeSettings?: ParadeSettings;
  canEditScene?: boolean; sceneReadOnlyMessage?: string; focusRequest?: number;
  onMoveMember: (id: string, position: Position) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
};

const parseNumberInput = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundDetailMeters = (value: number): number =>
  Math.round(value * 1000) / 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toDisplayX = (internalX: number | undefined, stageWidth: number) =>
  internalX === undefined ? undefined : internalX - stageWidth / 2;

const fromDisplayX = (displayX: number, stageWidth: number) =>
  displayX + stageWidth / 2;

const fromCenterSplitDistance = (
  distance: number,
  currentInternalX: number | undefined,
  stageWidth: number,
) => {
  const center = stageWidth / 2;
  const currentOffset =
    currentInternalX === undefined ? 0 : currentInternalX - center;
  if (Math.abs(currentOffset) < 0.001) {
    return center + distance;
  }
  return currentOffset < 0 ? center - distance : center + distance;
};

export const SelectedPositionCard = ({
  selected, selectedMemberIds, members, memberGroups, objects, currentFrame,
  snapshot, stage, projectMode = "stage", paradeSettings, canEditScene = true,
  sceneReadOnlyMessage = "このシーンは閲覧のみです。", focusRequest = 0,
  onMoveMember, onUpdateObjectState,
}: SelectedPositionCardProps) => {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const card = cardRef.current;
    if (!card) return;
    const field = card.querySelector<HTMLInputElement>("input:not(:disabled)");
    (field ?? card).focus({ preventScroll: true });
    scrollWithinContainer(card, { behavior: "instant", block: "nearest" });
  }, [focusRequest]);
  const sceneDisabled = !canEditScene;
  const selectedMemberId = selected?.type === "member" ? selected.id
    : !selected && selectedMemberIds.length === 1 ? selectedMemberIds[0] : null;
  const selectedMember = members.find(member => member.id === selectedMemberId) ?? null;
  const selectedObject =
    selected?.type === "object"
      ? objects.find((object) => object.id === selected.id) ?? null
      : null;

  const memberPosition = selectedMember
    ? snapshot.positions[selectedMember.id]
    : undefined;
  const objectState =
    selectedObject && snapshot.objectStates[selectedObject.id]
      ? snapshot.objectStates[selectedObject.id]
      : selectedObject
        ? {
            objectId: selectedObject.id,
            x: selectedObject.defaultX,
            y: selectedObject.defaultY,
            widthMeters: selectedObject.widthMeters,
            heightMeters: selectedObject.heightMeters,
            rotation: selectedObject.defaultRotation,
            visible: selectedObject.visible,
            zIndex: selectedObject.zIndex,
          }
        : undefined;
  const stageWidthMeters = Math.max(
    0.1,
    projectMode === "parade" ? paradeSettings?.width ?? stage.widthMeters : stage.widthMeters,
  );
  const stageDepthMeters = Math.max(
    0.1,
    projectMode === "parade"
      ? paradeSettings?.totalDistance ?? stage.depthMeters
      : stage.depthMeters,
  );
  const paradeBackwardDistanceMeters =
    projectMode === "parade"
      ? getSafeParadeBackwardDistance(paradeSettings?.backwardDistanceMeters)
      : 0;
  const coordinateDepthMeters =
    projectMode === "parade"
      ? getSafeParadeCanvasDistance(stageDepthMeters, paradeBackwardDistanceMeters)
      : stageDepthMeters;
  const paradeHorizontalMeasureMode = normalizeParadeHorizontalMeasureMode(
    paradeSettings?.horizontalMeasureMode,
  );
  const useParadeCenterSplitX =
    projectMode === "parade" &&
    paradeHorizontalMeasureMode === "centerSplit";
  const xLabel =
    projectMode === "parade"
      ? useParadeCenterSplitX
        ? "横位置（センター割り）"
        : "横（センターから）"
      : "横（センターから）";
  const yLabel = projectMode === "parade" ? "m位置" : "縦（最前から）";
  // Stage 縦 uses the same numbers as the rulers: 最前 is 0m, larger toward 奥.
  const frontAtTop = (stage.frontDirection ?? stage.audienceSide ?? "bottom") === "top";
  // Physical performer-right is positive, independently of the current view.
  const xSign = projectMode === "parade" || frontAtTop ? 1 : -1;
  const fromFront = (internalY: number) => roundDetailMeters(frontAtTop ? internalY : stageDepthMeters - internalY);
  const displayYValue = (internalY: number | undefined) =>
    projectMode === "parade"
      ? internalYToParadeDistance(
          internalY,
          stageDepthMeters,
          paradeBackwardDistanceMeters,
        )
      : internalY === undefined ? undefined : fromFront(internalY);
  const internalYValue = (displayY: number) =>
    projectMode === "parade"
      ? paradeDistanceToInternalY(
          displayY,
          stageDepthMeters,
          paradeBackwardDistanceMeters,
        )
      : frontAtTop ? displayY : stageDepthMeters - displayY;
  // Props are stored by their corner; on stage show the distance from 最前 to the prop's front edge.
  const objectDisplayYValue = (internalY: number | undefined, heightMeters: number) =>
    internalY === undefined ? undefined : projectMode === "parade"
      ? roundDetailMeters(stageDepthMeters - internalY)
      : frontAtTop ? internalY : fromFront(internalY + heightMeters);
  const objectInternalYValue = (displayY: number, heightMeters: number) =>
    projectMode === "parade" ? stageDepthMeters - displayY
      : frontAtTop ? displayY : stageDepthMeters - displayY - heightMeters;
  const displayXValue = (internalX: number | undefined) =>
    useParadeCenterSplitX
      ? internalX === undefined
        ? undefined
        : Math.abs(toDisplayX(internalX, stageWidthMeters) ?? 0)
      : internalX === undefined ? undefined : xSign * (toDisplayX(internalX, stageWidthMeters) ?? 0);
  const internalXValue = (
    displayX: number,
    currentInternalX: number | undefined,
  ) =>
    useParadeCenterSplitX
      ? fromCenterSplitDistance(displayX, currentInternalX, stageWidthMeters)
      : fromDisplayX(xSign * displayX, stageWidthMeters);
  const minDisplayX = useParadeCenterSplitX ? 0 : -stageWidthMeters / 2;
  const maxDisplayX = stageWidthMeters / 2;
  const objectStage = { ...stage, widthMeters: stageWidthMeters, depthMeters: coordinateDepthMeters };
  const objectBounds = objectState ? objectPositionBounds(objectState, objectStage) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const leftSide = (objectState?.x ?? stageWidthMeters / 2) < stageWidthMeters / 2 - 0.001;
  const signedMinX = roundMeters(objectBounds.minX) - stageWidthMeters / 2;
  const signedMaxX = roundMeters(objectBounds.maxX) - stageWidthMeters / 2;
  const xEnds = [xSign * signedMinX, xSign * signedMaxX];
  const objectDisplayXBounds = !useParadeCenterSplitX ? { min: Math.min(...xEnds), max: Math.max(...xEnds) }
    : leftSide ? { min: Math.max(0, -signedMaxX), max: Math.max(0, -signedMinX) }
    : { min: Math.max(0, signedMinX), max: Math.max(0, signedMaxX) };
  const yEnds = [objectDisplayYValue(roundMeters(objectBounds.minY), objectState?.heightMeters ?? 0) ?? 0,
    objectDisplayYValue(roundMeters(objectBounds.maxY), objectState?.heightMeters ?? 0) ?? 0];
  const objectDisplayYBounds = { min: Math.min(...yEnds), max: Math.max(...yEnds) };

  const updateMemberCoordinate = (axis: "x" | "y", rawValue: string) => {
    if (sceneDisabled || !selectedMember || !memberPosition) {
      return;
    }
    const value = parseNumberInput(rawValue);
    if (value === null) {
      return;
    }
    const nextInternalX =
      axis === "x" ? internalXValue(value, memberPosition.x) : memberPosition.x;
    const nextInternalY = axis === "y" ? internalYValue(value) : memberPosition.y;
    onMoveMember(selectedMember.id, {
      x: roundDetailMeters(clamp(nextInternalX, 0, stageWidthMeters)),
      y: roundDetailMeters(clamp(nextInternalY, 0, coordinateDepthMeters)),
    });
  };

  const updateObjectCoordinate = (axis: "x" | "y", rawValue: string) => {
    if (sceneDisabled || !selectedObject || !objectState) {
      return;
    }
    const value = parseNumberInput(rawValue);
    if (value === null) {
      return;
    }
    const requested = { x: objectState.x, y: objectState.y,
      [axis]: axis === "x" ? internalXValue(value, objectState.x) : objectInternalYValue(value, objectState.heightMeters) };
    const next = constrainObjectPosition(requested, objectState, objectStage);
    const otherAxis = axis === "x" ? "y" : "x";
    onUpdateObjectState(selectedObject.id, { [axis]: next[axis],
      ...(next[otherAxis] !== objectState[otherAxis] ? { [otherAxis]: next[otherAxis] } : {}) });
  };

  const updateObjectPositiveNumber = (
    field: "widthMeters" | "heightMeters",
    rawValue: string,
  ) => {
    if (sceneDisabled || !selectedObject) {
      return;
    }
    const value = parseNumberInput(rawValue);
    if (value === null || value <= 0) {
      return;
    }
    const currentWidth = objectState?.widthMeters ?? 1;
    const currentHeight = objectState?.heightMeters ?? 1;
    const nextWidth =
      field === "widthMeters"
        ? roundDetailMeters(clamp(value, 0.01, stageWidthMeters))
        : currentWidth;
    const nextHeight =
      field === "heightMeters"
        ? roundDetailMeters(clamp(value, 0.01, coordinateDepthMeters))
        : currentHeight;
    const next = constrainObjectPosition({ x: objectState?.x ?? 0, y: objectState?.y ?? 0 },
      { widthMeters: nextWidth, heightMeters: nextHeight, rotation: objectState?.rotation ?? selectedObject.defaultRotation }, objectStage);
    onUpdateObjectState(selectedObject.id, {
      [field]: field === "widthMeters" ? nextWidth : nextHeight, ...next,
    });
  };

  const updateObjectRotation = (rawValue: string) => {
    if (sceneDisabled || !selectedObject) {
      return;
    }
    const value = parseNumberInput(rawValue);
    if (value === null) {
      return;
    }
    onUpdateObjectState(selectedObject.id, {
      rotation: roundDetailMeters(value),
    });
  };

  if (!selectedMember && !selectedObject && selectedMemberIds.length <= 1) {
    return focusRequest ? <section className="selected-position-card" ref={cardRef} tabIndex={-1} aria-label="選択対象の位置">
      メンバーや道具を選ぶと、位置を数字で合わせられます。
    </section> : null;
  }
  return <section className="selected-position-card" ref={cardRef} tabIndex={-1} aria-label="選択対象の位置">
    {selectedMemberIds.length > 1 ? <strong>{selectedMemberIds.length}人選択中</strong> : <>
      <div className="detail-summary-card__title">
        <span className="detail-color-dot" style={{ backgroundColor: selectedMember
          ? getMemberDisplayColor(selectedMember, { frame: currentFrame, groups: memberGroups, snapshot })
          : selectedObject?.color }} />
        <strong>{selectedMember?.name ?? selectedObject?.name}</strong>
      </div>
      {!canEditScene && <p className="muted-text">{sceneReadOnlyMessage}</p>}
      <div className="detail-edit-grid">
        {selectedMember && <>
              <label className="detail-edit-field">
                <span>{xLabel}</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={minDisplayX}
                    max={maxDisplayX}
                    value={displayXValue(memberPosition?.x)}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) =>
                      updateMemberCoordinate("x", String(value))
                    }
                  />
                  <b>m</b>
                  {useParadeCenterSplitX && (
                    <em className="detail-side-label">
                      {getCenterSplitSideLabel(memberPosition?.x, stageWidthMeters)}
                    </em>
                  )}
                </span>
              </label>
              <label className="detail-edit-field">
                <span>{yLabel}</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={
                      projectMode === "parade"
                        ? -paradeBackwardDistanceMeters
                        : 0
                    }
                    max={stageDepthMeters}
                    value={displayYValue(memberPosition?.y)}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) =>
                      updateMemberCoordinate("y", String(value))
                    }
                  />
                  <b>m</b>
                </span>
              </label>
        </>}
        {selectedObject && <>
              <label className="detail-edit-field">
                <span>{xLabel}</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={objectDisplayXBounds.min}
                    max={objectDisplayXBounds.max}
                    value={displayXValue(objectState?.x)}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) =>
                      updateObjectCoordinate("x", String(value))
                    }
                  />
                  <b>m</b>
                  {useParadeCenterSplitX && (
                    <em className="detail-side-label">
                      {getCenterSplitSideLabel(objectState?.x, stageWidthMeters)}
                    </em>
                  )}
                </span>
              </label>
              <label className="detail-edit-field">
                <span>{yLabel}</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={objectDisplayYBounds.min}
                    max={objectDisplayYBounds.max}
                    value={objectDisplayYValue(objectState?.y, objectState?.heightMeters ?? 0)}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) =>
                      updateObjectCoordinate("y", String(value))
                    }
                  />
                  <b>m</b>
                </span>
              </label>
              <label className="detail-edit-field">
                <span>横幅</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={0.01}
                    value={objectState?.widthMeters}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) =>
                      updateObjectPositiveNumber(
                        "widthMeters",
                        String(value),
                      )
                    }
                  />
                  <b>m</b>
                </span>
              </label>
              <label className="detail-edit-field">
                <span>縦幅</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={0.01}
                    value={objectState?.heightMeters}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) =>
                      updateObjectPositiveNumber(
                        "heightMeters",
                        String(value),
                      )
                    }
                  />
                  <b>m</b>
                </span>
              </label>
              <label className="detail-edit-field">
                <span>回転角度</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="1"
                    value={objectState?.rotation}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onValueChange={(value) => updateObjectRotation(String(value))}
                  />
                  <b>°</b>
                </span>
              </label>
        </>}
      </div>
    </>}
  </section>;
};

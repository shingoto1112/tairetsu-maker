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

const getObjectDisplayXBounds = (
  currentInternalX: number | undefined,
  objectWidthMeters: number | undefined,
  stageWidth: number,
  useCenterSplit: boolean,
) => {
  const safeObjectWidth =
    Number.isFinite(objectWidthMeters) && (objectWidthMeters ?? 0) > 0
      ? (objectWidthMeters as number)
      : 0;
  const maxInternalX = Math.max(0, stageWidth - safeObjectWidth);
  if (!useCenterSplit) {
    return {
      max: toDisplayX(maxInternalX, stageWidth) ?? stageWidth / 2,
      min: toDisplayX(0, stageWidth) ?? -stageWidth / 2,
    };
  }

  const center = stageWidth / 2;
  const currentOffset =
    currentInternalX === undefined ? 0 : currentInternalX - center;
  return {
    max:
      currentOffset < -0.001
        ? center
        : Math.max(0, center - safeObjectWidth),
    min: 0,
  };
};

const getObjectDisplayYBounds = (
  objectHeightMeters: number | undefined,
  stageDepth: number,
  projectMode: "stage" | "parade",
  backwardDistanceMeters = 0,
) => {
  const safeObjectHeight =
    Number.isFinite(objectHeightMeters) && (objectHeightMeters ?? 0) > 0
      ? (objectHeightMeters as number)
      : 0;
  if (projectMode === "parade") {
    return {
      max: stageDepth,
      min: Math.max(-backwardDistanceMeters, -backwardDistanceMeters + safeObjectHeight),
    };
  }
  return {
    max: Math.max(0, stageDepth - safeObjectHeight),
    min: 0,
  };
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
  const yLabel = projectMode === "parade" ? "m位置" : "縦（上端から）";
  const displayYValue = (internalY: number | undefined) =>
    projectMode === "parade"
      ? internalYToParadeDistance(
          internalY,
          stageDepthMeters,
          paradeBackwardDistanceMeters,
        )
      : internalY;
  const internalYValue = (displayY: number) =>
    projectMode === "parade"
      ? paradeDistanceToInternalY(
          displayY,
          stageDepthMeters,
          paradeBackwardDistanceMeters,
        )
      : displayY;
  const displayXValue = (internalX: number | undefined) =>
    useParadeCenterSplitX
      ? internalX === undefined
        ? undefined
        : Math.abs(toDisplayX(internalX, stageWidthMeters) ?? 0)
      : toDisplayX(internalX, stageWidthMeters);
  const internalXValue = (
    displayX: number,
    currentInternalX: number | undefined,
  ) =>
    useParadeCenterSplitX
      ? fromCenterSplitDistance(displayX, currentInternalX, stageWidthMeters)
      : fromDisplayX(displayX, stageWidthMeters);
  const minDisplayX = useParadeCenterSplitX ? 0 : -stageWidthMeters / 2;
  const maxDisplayX = stageWidthMeters / 2;
  const objectDisplayXBounds = getObjectDisplayXBounds(
    objectState?.x,
    objectState?.widthMeters,
    stageWidthMeters,
    useParadeCenterSplitX,
  );
  const objectDisplayYBounds = getObjectDisplayYBounds(
    objectState?.heightMeters,
    stageDepthMeters,
    projectMode,
    paradeBackwardDistanceMeters,
  );

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
    const maxObjectX = Math.max(
      0,
      stageWidthMeters - objectState.widthMeters,
    );
    const maxObjectY = Math.max(
      0,
      coordinateDepthMeters - objectState.heightMeters,
    );
    onUpdateObjectState(selectedObject.id, {
      [axis]:
        axis === "x"
          ? roundDetailMeters(
              clamp(
                internalXValue(
                  clamp(value, objectDisplayXBounds.min, objectDisplayXBounds.max),
                  objectState.x,
                ),
                0,
                maxObjectX,
              ),
            )
          : roundDetailMeters(
              clamp(
                internalYValue(
                  clamp(value, objectDisplayYBounds.min, objectDisplayYBounds.max),
                ),
                0,
                maxObjectY,
              ),
            ),
    });
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
    const nextX = roundDetailMeters(
      clamp(objectState?.x ?? 0, 0, Math.max(0, stageWidthMeters - nextWidth)),
    );
    const nextY = roundDetailMeters(
      clamp(
        objectState?.y ?? 0,
        0,
        Math.max(0, coordinateDepthMeters - nextHeight),
      ),
    );
    onUpdateObjectState(selectedObject.id, {
      [field]: field === "widthMeters" ? nextWidth : nextHeight,
      x: nextX,
      y: nextY,
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
                    value={displayYValue(objectState?.y)}
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

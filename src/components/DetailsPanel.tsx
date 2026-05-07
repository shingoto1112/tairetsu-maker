import {
  FormationFrame,
  Member,
  MemberGroup,
  ObjectState,
  ObjectGroup,
  ParadeSettings,
  Position,
  StageConfig,
  StageObject,
  StageSnapshot,
  Selection,
} from "../types";
import { PanelStickyHeader } from "./PanelStickyHeader";
import { getMemberDisplayColor } from "../utils/memberAppearance";
import {
  getCenterSplitSideLabel,
  normalizeParadeHorizontalMeasureMode,
} from "../utils/parade";
import { NumericInput } from "./NumericInput";

type DetailsPanelProps = {
  selected: Selection;
  selectedMemberIds: string[];
  members: Member[];
  memberGroups: MemberGroup[];
  objects: StageObject[];
  objectGroups: ObjectGroup[];
  currentFrame: FormationFrame | null;
  snapshot: StageSnapshot;
  stage: StageConfig;
  projectMode?: "stage" | "parade";
  paradeSettings?: ParadeSettings;
  onUpdateMember: (id: string, patch: Partial<Member>) => void;
  onUpdateMemberGroup: (memberId: string, groupId: string | null) => void;
  onMoveMember: (id: string, position: Position) => void;
  onUpdateObject: (id: string, patch: Partial<StageObject>) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
};

const objectTypeLabel = (type: StageObject["type"]): string => {
  switch (type) {
    case "curtain":
      return "幕";
    case "chair":
      return "椅子";
    case "table":
      return "机";
    case "panel":
      return "パネル";
    case "mark":
      return "マーク";
    case "area":
      return "範囲";
    case "setPiece":
      return "大道具";
    case "custom":
      return "カスタム";
    default:
      return "道具";
  }
};

const formatMeter = (value?: number): string =>
  value === undefined ? "-" : `${Number(value.toFixed(2))}m`;

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

const getAssignedObjectNames = (
  memberId: string,
  frame: FormationFrame | null,
  objects: StageObject[],
): string[] =>
  Object.entries(frame?.objectAssignments ?? {}).flatMap(
    ([objectId, memberIds]) => {
      if (!memberIds.includes(memberId)) {
        return [];
      }
      return objects.find((object) => object.id === objectId)?.name ?? [];
    },
  );

export const DetailsPanel = ({
  selected,
  selectedMemberIds,
  members,
  memberGroups,
  objects,
  objectGroups,
  currentFrame,
  snapshot,
  stage,
  projectMode = "stage",
  paradeSettings,
  onUpdateMember,
  onUpdateMemberGroup,
  onMoveMember,
  onUpdateObject,
  onUpdateObjectState,
}: DetailsPanelProps) => {
  const selectedMember =
    selected?.type === "member"
      ? members.find((member) => member.id === selected.id) ?? null
      : null;
  const selectedObject =
    selected?.type === "object"
      ? objects.find((object) => object.id === selected.id) ?? null
      : null;

  const selectedMemberGroup = selectedMember
    ? memberGroups.find((group) => group.memberIds.includes(selectedMember.id))
    : null;
  const selectedObjectGroup = selectedObject
    ? objectGroups.find((group) => group.objectIds.includes(selectedObject.id))
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
  const assignedObjectNames = selectedMember
    ? getAssignedObjectNames(selectedMember.id, currentFrame, objects)
    : [];
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
        : "x（中心基準）"
      : "x（中心基準）";
  const yLabel = projectMode === "parade" ? "m位置" : "y（上端基準）";
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

  const updateMemberCoordinate = (axis: "x" | "y", rawValue: string) => {
    if (!selectedMember || !memberPosition) {
      return;
    }
    const value = parseNumberInput(rawValue);
    if (value === null) {
      return;
    }
    const nextInternalX =
      axis === "x" ? internalXValue(value, memberPosition.x) : memberPosition.x;
    const nextInternalY = axis === "y" ? value : memberPosition.y;
    onMoveMember(selectedMember.id, {
      x: roundDetailMeters(clamp(nextInternalX, 0, stageWidthMeters)),
      y: roundDetailMeters(clamp(nextInternalY, 0, stageDepthMeters)),
    });
  };

  const updateObjectCoordinate = (axis: "x" | "y", rawValue: string) => {
    if (!selectedObject || !objectState) {
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
      stageDepthMeters - objectState.heightMeters,
    );
    onUpdateObjectState(selectedObject.id, {
      [axis]:
        axis === "x"
          ? roundDetailMeters(
              clamp(internalXValue(value, objectState.x), 0, maxObjectX),
            )
          : roundDetailMeters(clamp(value, 0, maxObjectY)),
    });
  };

  const updateObjectPositiveNumber = (
    field: "widthMeters" | "heightMeters",
    rawValue: string,
  ) => {
    if (!selectedObject) {
      return;
    }
    const value = parseNumberInput(rawValue);
    if (value === null || value <= 0) {
      return;
    }
    onUpdateObjectState(selectedObject.id, {
      [field]: roundDetailMeters(value),
    });
  };

  const updateObjectRotation = (rawValue: string) => {
    if (!selectedObject) {
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

  return (
    <div className="details-panel">
      <PanelStickyHeader
        title="詳細"
        meta={
          currentFrame
            ? `現在: ${currentFrame.label || "無題"}`
            : "シーンがありません"
        }
      />

      <section className="panel-section">
        <div className="panel-section__header">
          <h3>選択中</h3>
          <span>
            {selectedMember
              ? "メンバー"
              : selectedObject
                ? "道具"
                : selectedMemberIds.length > 1
                  ? `${selectedMemberIds.length}人選択`
                  : "なし"}
          </span>
        </div>

        {!selectedMember && !selectedObject && selectedMemberIds.length <= 1 && (
          <p className="muted-text">
            ステージ上のメンバーや道具を選択すると、ここで名前・サイズ・座標などを編集できます。
          </p>
        )}

        {selectedMemberIds.length > 1 && (
          <div className="detail-summary-card">
            <strong>{selectedMemberIds.length}人のメンバーを選択中</strong>
            <span>整列・矢印キー移動・コピーなどをまとめて操作できます。</span>
          </div>
        )}

        {selectedMember && (
          <div className="detail-summary-card">
            <div className="detail-summary-card__title">
              <span
                className="detail-color-dot"
                style={{
                  backgroundColor: getMemberDisplayColor(selectedMember, {
                    frame: currentFrame,
                    groups: memberGroups,
                    snapshot,
                  }),
                }}
              />
              <strong>{selectedMember.name}</strong>
            </div>
            <div className="detail-edit-grid">
              <label className="detail-edit-field detail-edit-field--wide">
                <span>メンバー名</span>
                <input
                  value={selectedMember.name}
                  onChange={(event) =>
                    onUpdateMember(selectedMember.id, {
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <label className="detail-edit-field">
                <span>所属グループ</span>
                <select
                  value={selectedMemberGroup?.id ?? ""}
                  onChange={(event) =>
                    onUpdateMemberGroup(
                      selectedMember.id,
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">未所属</option>
                  {memberGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-edit-field">
                <span>表示色</span>
                <input
                  className="detail-color-input"
                  type="color"
                  value={selectedMember.color}
                  onChange={(event) =>
                    onUpdateMember(selectedMember.id, {
                      color: event.target.value,
                    })
                  }
                />
              </label>
              <label className="detail-edit-field">
                <span>{xLabel}</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={minDisplayX}
                    max={maxDisplayX}
                    value={displayXValue(memberPosition?.x)}
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
                    min={0}
                    max={stageDepthMeters}
                    value={memberPosition?.y}
                    onValueChange={(value) =>
                      updateMemberCoordinate("y", String(value))
                    }
                  />
                  <b>m</b>
                </span>
              </label>
              <div className="detail-readout-chip detail-readout-chip--wide">
                <span>表示</span>
                <strong>
                  {(selectedMember.visible ?? true) &&
                  (snapshot.memberVisibility[selectedMember.id] ?? true)
                    ? "表示中"
                    : "隊列外"}
                </strong>
              </div>
            </div>
            {assignedObjectNames.length > 0 && (
              <p className="assignment-inline-note">
                割当: {assignedObjectNames.join("、")}
              </p>
            )}
          </div>
        )}

        {selectedObject && (
          <div className="detail-summary-card">
            <div className="detail-summary-card__title">
              <span
                className="detail-color-dot"
                style={{ backgroundColor: selectedObject.color }}
              />
              <strong>{selectedObject.name}</strong>
            </div>
            <div className="detail-edit-grid">
              <label className="detail-edit-field detail-edit-field--wide">
                <span>道具名</span>
                <input
                  value={selectedObject.name}
                  onChange={(event) =>
                    onUpdateObject(selectedObject.id, {
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <div className="detail-readout-chip">
                <span>種類</span>
                <strong>{objectTypeLabel(selectedObject.type)}</strong>
              </div>
              <div className="detail-readout-chip">
                <span>所属</span>
                <strong>{selectedObjectGroup?.name ?? "未所属"}</strong>
              </div>
              <div className="detail-readout-chip">
                <span>表示</span>
                <strong>
                  {(objectState?.visible ?? selectedObject.visible) !== false
                    ? "表示中"
                    : "非表示"}
                </strong>
              </div>
              <label className="detail-edit-field">
                <span>色</span>
                <input
                  className="detail-color-input"
                  type="color"
                  value={selectedObject.color}
                  onChange={(event) =>
                    onUpdateObject(selectedObject.id, {
                      color: event.target.value,
                    })
                  }
                />
              </label>
              <label className="detail-edit-field">
                <span>{xLabel}</span>
                <span className="detail-input-with-unit">
                  <NumericInput
                    step="0.01"
                    min={minDisplayX}
                    max={maxDisplayX}
                    value={displayXValue(objectState?.x)}
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
                    min={0}
                    max={stageDepthMeters}
                    value={objectState?.y}
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
                    onValueChange={(value) => updateObjectRotation(String(value))}
                  />
                  <b>°</b>
                </span>
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section__header">
          <h3>座標の見方</h3>
          <span>詳細タブ</span>
        </div>
        <p className="muted-text">
          {projectMode === "parade"
            ? useParadeCenterSplitX
              ? "横位置はセンターから左右それぞれの距離で表示します。m位置はスタート地点からの距離です。"
              : "xはセンターラインを0mとして、右がプラス、左がマイナスです。m位置はスタート地点からの距離です。"
            : "xはステージ上端のセンターラインを0mとして、右がプラス、左がマイナスです。yはステージ上端を0mとして、下方向がプラスです。"}
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-section__header">
          <h3>ショートカット</h3>
        </div>
        <ul className="details-shortcut-list">
          <li>矢印キー: 0.25m移動</li>
          <li>Shift+矢印: グリッド単位</li>
          <li>Ctrl+矢印: 0.01m移動</li>
          <li>Esc: 選択解除 / メニューを閉じる</li>
        </ul>
      </section>
    </div>
  );
};

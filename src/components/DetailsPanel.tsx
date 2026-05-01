import {
  FormationFrame,
  Member,
  MemberGroup,
  ObjectGroup,
  StageObject,
  StageSnapshot,
  Selection,
} from "../types";
import { PanelStickyHeader } from "./PanelStickyHeader";
import { getMemberDisplayColor } from "../utils/memberAppearance";

type DetailsPanelProps = {
  selected: Selection;
  selectedMemberIds: string[];
  members: Member[];
  memberGroups: MemberGroup[];
  objects: StageObject[];
  objectGroups: ObjectGroup[];
  currentFrame: FormationFrame | null;
  snapshot: StageSnapshot;
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
  const objectState = selectedObject
    ? snapshot.objectStates[selectedObject.id]
    : undefined;
  const assignedObjectNames = selectedMember
    ? getAssignedObjectNames(selectedMember.id, currentFrame, objects)
    : [];

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
            ステージ上のメンバーや道具を選択すると、ここに基本情報を表示します。
            MVPではシーン間の自動移動アニメーションは使わず、曲時刻に合わせて静的な隊列表を切り替えます。
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
            <dl className="detail-readout-grid">
              <div>
                <dt>所属</dt>
                <dd>{selectedMemberGroup?.name ?? "未所属"}</dd>
              </div>
              <div>
                <dt>表示</dt>
                <dd>
                  {(selectedMember.visible ?? true) &&
                  (snapshot.memberVisibility[selectedMember.id] ?? true)
                    ? "表示中"
                    : "隊列外"}
                </dd>
              </div>
              <div>
                <dt>x</dt>
                <dd>{formatMeter(memberPosition?.x)}</dd>
              </div>
              <div>
                <dt>y</dt>
                <dd>{formatMeter(memberPosition?.y)}</dd>
              </div>
            </dl>
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
            <dl className="detail-readout-grid">
              <div>
                <dt>種類</dt>
                <dd>{objectTypeLabel(selectedObject.type)}</dd>
              </div>
              <div>
                <dt>所属</dt>
                <dd>{selectedObjectGroup?.name ?? "未所属"}</dd>
              </div>
              <div>
                <dt>表示</dt>
                <dd>
                  {(objectState?.visible ?? selectedObject.visible) !== false
                    ? "表示中"
                    : "非表示"}
                </dd>
              </div>
              <div>
                <dt>x</dt>
                <dd>{formatMeter(objectState?.x)}</dd>
              </div>
              <div>
                <dt>y</dt>
                <dd>{formatMeter(objectState?.y)}</dd>
              </div>
              <div>
                <dt>横</dt>
                <dd>{formatMeter(objectState?.widthMeters)}</dd>
              </div>
              <div>
                <dt>縦</dt>
                <dd>{formatMeter(objectState?.heightMeters)}</dd>
              </div>
              <div>
                <dt>回転</dt>
                <dd>{objectState ? `${Math.round(objectState.rotation)}°` : "-"}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section__header">
          <h3>再生仕様</h3>
          <span>MVP</span>
        </div>
        <p className="muted-text">
          再生中は、現在時刻に到達しているシーンの静的な配置を表示します。
          次シーンの開始時刻までは自動で移動しません。
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

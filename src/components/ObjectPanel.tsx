import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Plus,
  UserPlus,
  X,
  SendToBack,
  Trash2,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Member,
  ObjectState,
  ObjectGroup,
  Selection,
  AlignmentAction,
  StageObject,
  StageObjectShape,
  StageObjectType,
} from "../types";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";
import { ColorPaletteInput } from "./ColorPaletteInput";

type ObjectPanelProps = {
  objects: StageObject[];
  objectStates: Record<string, ObjectState>;
  members: Member[];
  objectAssignments?: Record<string, string[]>;
  objectGroups: ObjectGroup[];
  selected: Selection;
  visibilityTab: VisibilityTab;
  scrollTarget: { id: string; token: number } | null;
  canEditProject?: boolean;
  canEditScene?: boolean;
  projectReadOnlyMessage?: string;
  sceneReadOnlyMessage?: string;
  onVisibilityTabChange: (tab: VisibilityTab) => void;
  onSelect: (id: string) => void;
  onUpdateObject: (id: string, patch: Partial<StageObject>) => void;
  onUpdateObjectState: (id: string, patch: Partial<ObjectState>) => void;
  onDelete: (id: string) => void;
  onNudgeZ: (id: string, delta: number) => void;
  onAddObject: (visibleInCurrentFrame?: boolean) => void;
  onAddCurtain: (visibleInCurrentFrame?: boolean) => void;
  onAddMark: (visibleInCurrentFrame?: boolean) => void;
  onCreateObjectGroup: (draft?: {
    name?: string;
    color?: string;
    defaultType?: StageObjectType;
    defaultShape?: StageObjectShape;
  }) => void;
  onUpdateObjectGroup: (id: string, patch: Partial<ObjectGroup>) => void;
  onDeleteObjectGroup: (id: string) => void;
  onAddObjectToGroup: (
    group: ObjectGroup,
    visibleInCurrentFrame?: boolean,
  ) => void;
  onChangeObjectGroup: (objectId: string, groupId: string | null) => void;
  onSetAllObjectsFrameVisibility: (visible: boolean) => void;
  onCopySelected: () => void;
  onPasteObject: (visibleInCurrentFrame?: boolean) => void;
  canPasteObject: boolean;
  onAssignMember: (objectId: string, memberId: string) => void;
  onRemoveAssignment: (
    objectId: string,
    memberId: string,
    restoreMember?: boolean,
  ) => void;
  onPlaceSelectedObject: (action: AlignmentAction) => void;
};

type VisibilityTab = "visible" | "hidden";

const compareMembersByName = (a: Member, b: Member): number =>
  a.name.localeCompare(b.name, "ja", { numeric: true });

const objectTypes: StageObjectType[] = [
  "prop",
  "setPiece",
  "chair",
  "table",
  "panel",
  "curtain",
  "mark",
  "area",
  "custom",
];

const shapes: StageObjectShape[] = [
  "rectangle",
  "circle",
  "line",
  "curtain",
  "custom",
];

const shapeLabel: Record<StageObjectShape, string> = {
  rectangle: "四角形",
  circle: "円",
  line: "線",
  curtain: "幕",
  custom: "カスタム",
};

const typeLabel: Record<StageObjectType, string> = {
  prop: "道具",
  setPiece: "大道具",
  chair: "椅子",
  table: "机",
  panel: "パネル",
  curtain: "移動幕",
  mark: "立ち位置",
  area: "範囲",
  custom: "カスタム",
};

export const ObjectPanel = ({
  objects,
  objectStates,
  members,
  objectAssignments = {},
  objectGroups,
  selected,
  visibilityTab,
  scrollTarget,
  canEditProject = true,
  canEditScene = true,
  projectReadOnlyMessage = "初期クラウド編集では、道具マスターや道具グループは編集できません。",
  sceneReadOnlyMessage = "編集するには、このシーンの編集ロックを取得してください。",
  onVisibilityTabChange,
  onSelect,
  onUpdateObject,
  onUpdateObjectState,
  onDelete,
  onNudgeZ,
  onAddObject,
  onAddCurtain,
  onAddMark,
  onCreateObjectGroup,
  onUpdateObjectGroup,
  onDeleteObjectGroup,
  onAddObjectToGroup,
  onChangeObjectGroup,
  onSetAllObjectsFrameVisibility,
  onCopySelected,
  onPasteObject,
  canPasteObject,
  onAssignMember,
  onRemoveAssignment,
  onPlaceSelectedObject,
}: ObjectPanelProps) => {
  const panelRef = useRef<HTMLElement | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [groupDraftName, setGroupDraftName] = useState("");
  const [groupDraftColor, setGroupDraftColor] = useState("#0d8b78");
  const [groupDraftType, setGroupDraftType] =
    useState<StageObjectType>("prop");
  const [groupDraftShape, setGroupDraftShape] =
    useState<StageObjectShape>("rectangle");
  const [expandedObjectGroupIds, setExpandedObjectGroupIds] = useState<
    string[]
  >([]);
  const isVisibleTab = visibilityTab === "visible";
  const projectDisabled = !canEditProject;
  const sceneDisabled = !canEditScene;
  const isObjectVisible = (object: StageObject): boolean =>
    objectStates[object.id]?.visible ?? object.visible ?? true;
  const visibleObjects = objects.filter(isObjectVisible);
  const hiddenObjects = objects.filter((object) => !isObjectVisible(object));
  const activeObjects = isVisibleTab ? visibleObjects : hiddenObjects;
  const membersById = new Map(members.map((member) => [member.id, member]));
  const objectsById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const objectGroupById = useMemo(() => {
    const map = new Map<string, ObjectGroup>();
    objectGroups.forEach((group) => {
      group.objectIds.forEach((objectId) => {
        if (!map.has(objectId)) {
          map.set(objectId, group);
        }
      });
    });
    return map;
  }, [objectGroups]);
  const objectGroupCards = objectGroups
    .map((group) => {
      const groupObjects = group.objectIds
        .map((objectId) => objectsById.get(objectId))
        .filter((object): object is StageObject => {
          if (!object) {
            return false;
          }
          return objectGroupById.get(object.id)?.id === group.id;
        });
      const tabObjects = groupObjects.filter((object) =>
        isVisibleTab ? isObjectVisible(object) : !isObjectVisible(object),
      );
      const visibleCount = groupObjects.filter(isObjectVisible).length;
      const hiddenCount = groupObjects.length - visibleCount;
      return { group, groupObjects, tabObjects, visibleCount, hiddenCount };
    })
    .filter(
      ({ groupObjects, tabObjects }) =>
        groupObjects.length === 0 || tabObjects.length > 0,
    );
  const ungroupedActiveObjects = activeObjects.filter(
    (object) => !objectGroupById.has(object.id),
  );
  const orderedObjectsForVisibilityList = useMemo(() => {
    const ordered: StageObject[] = [];
    const added = new Set<string>();

    objectGroups.forEach((group) => {
      group.objectIds.forEach((objectId) => {
        if (added.has(objectId)) {
          return;
        }
        const object = objectsById.get(objectId);
        if (!object) {
          return;
        }
        ordered.push(object);
        added.add(objectId);
      });
    });

    objects.forEach((object) => {
      if (added.has(object.id)) {
        return;
      }
      ordered.push(object);
      added.add(object.id);
    });

    return ordered;
  }, [objectGroups, objects, objectsById]);

  const toggleObjectGroupExpanded = (groupId: string) => {
    setExpandedObjectGroupIds((previous) =>
      previous.includes(groupId)
        ? previous.filter((id) => id !== groupId)
        : [...previous, groupId],
    );
  };

  const handleCreateObjectGroup = () => {
    if (projectDisabled) {
      return;
    }
    onCreateObjectGroup({
      name: groupDraftName.trim() || undefined,
      color: groupDraftColor,
      defaultType: groupDraftType,
      defaultShape: groupDraftShape,
    });
    setGroupDraftName("");
  };

  useEffect(() => {
    if (!scrollTarget) {
      return undefined;
    }
    const group = objectGroupById.get(scrollTarget.id);
    if (group) {
      setExpandedObjectGroupIds((previous) =>
        previous.includes(group.id) ? previous : [...previous, group.id],
      );
    }
    let frame = 0;
    let secondFrame = 0;
    let clearTimer = 0;
    frame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = panelRef.current?.querySelector<HTMLElement>(
          `[data-object-id="${scrollTarget.id}"]`,
        );
        if (!element) {
          return;
        }
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("is-scroll-target");
        clearTimer = window.setTimeout(() => {
          element.classList.remove("is-scroll-target");
        }, 950);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      if (clearTimer) {
        window.clearTimeout(clearTimer);
      }
    };
  }, [scrollTarget]);

  return (
    <section className="panel-section" ref={panelRef}>
      <PanelStickyHeader
        title="道具"
        meta={
          selected?.type === "object"
            ? `選択中: ${
                objects.find((object) => object.id === selected.id)?.name ??
                "道具"
              } / 表示 ${visibleObjects.length}個 / 非表示 ${hiddenObjects.length}個`
            : `選択中: なし / 表示 ${visibleObjects.length}個 / 非表示 ${hiddenObjects.length}個`
        }
        actions={
          <>
            <button
              className="mini-button primary"
              onClick={() => onAddObject(isVisibleTab)}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              <Plus size={15} />
              道具
            </button>
            <button
              className="mini-button"
              onClick={() => onAddCurtain(isVisibleTab)}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              <Plus size={15} />
              幕
            </button>
            <button
              className="mini-button"
              onClick={() => onAddMark(isVisibleTab)}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              <Plus size={15} />
              マーク
            </button>
            <button className="mini-button" onClick={onCopySelected} type="button">
              コピー
            </button>
            <button
              className="mini-button"
              onClick={() => onPasteObject(isVisibleTab)}
              disabled={projectDisabled || !canPasteObject}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              貼り付け
            </button>
          </>
        }
      />
      {projectDisabled && (
        <p className="notice warning">{projectReadOnlyMessage}</p>
      )}
      {sceneDisabled && <p className="notice warning">{sceneReadOnlyMessage}</p>}

      <div className="panel-visibility-summary">
        <div className="member-visibility-tabs" role="tablist" aria-label="道具の表示状態">
          <button
            className={visibilityTab === "visible" ? "is-active" : ""}
            onClick={() => onVisibilityTabChange("visible")}
            type="button"
          >
            表示 {visibleObjects.length}
          </button>
          <button
            className={visibilityTab === "hidden" ? "is-active" : ""}
            onClick={() => onVisibilityTabChange("hidden")}
            type="button"
          >
            非表示 {hiddenObjects.length}
          </button>
        </div>
        <p className="muted-text">
          現在の追加先:
          {isVisibleTab
            ? " このシーンでステージに表示"
            : " このシーンではステージ外・非表示"}
        </p>
      </div>

      <section className="object-visibility-list" aria-label="道具の表示切替リスト">
        <div className="object-visibility-list__header">
          <strong>表示切替リスト</strong>
          <span>現在のシーンだけに反映</span>
        </div>
        <div className="visibility-checklist__actions">
          <button
            className="mini-button"
            onClick={() => onSetAllObjectsFrameVisibility(true)}
            disabled={sceneDisabled}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            type="button"
          >
            すべて表示
          </button>
          <button
            className="mini-button"
            onClick={() => onSetAllObjectsFrameVisibility(false)}
            disabled={sceneDisabled}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            type="button"
          >
            すべて非表示
          </button>
        </div>
        <div className="object-visibility-list__items">
          {objects.length === 0 ? (
            <p className="empty-state compact">道具はまだありません。</p>
          ) : (
            orderedObjectsForVisibilityList.map((object) => {
              const isVisible = isObjectVisible(object);
              const isSelected =
                selected?.type === "object" && selected.id === object.id;
              return (
                <label
                  className={[
                    "object-visibility-item",
                    isVisible ? "is-visible" : "is-hidden",
                    isSelected ? "is-selected" : "",
                  ].join(" ")}
                  key={object.id}
                  onClick={() => onSelect(object.id)}
                >
                  <input
                    checked={isVisible}
                    disabled={sceneDisabled}
                    title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                    onChange={(event) =>
                      onUpdateObjectState(object.id, {
                        visible: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span
                    className="color-dot square"
                    style={{ backgroundColor: object.color }}
                    aria-hidden="true"
                  />
                  <span className="object-visibility-item__name">
                    {object.name}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </section>

      <section className="object-group-manager" aria-label="道具グループ作成">
        <div className="object-visibility-list__header">
          <strong>道具グループ作成</strong>
          <span>グループ内追加は名前と色を引き継ぎます</span>
        </div>
        <div className="field-grid two">
          <label>
            グループ名
            <input
              value={groupDraftName}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              onChange={(event) => setGroupDraftName(event.target.value)}
              placeholder="例：中旗"
            />
          </label>
          <div className="palette-field">
            <span>色</span>
            <ColorPaletteInput
              value={groupDraftColor}
              disabled={projectDisabled}
              onChange={setGroupDraftColor}
              label="道具グループの色"
            />
          </div>
          <label>
            種類
            <select
              value={groupDraftType}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              onChange={(event) =>
                setGroupDraftType(event.target.value as StageObjectType)
              }
            >
              {objectTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabel[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            形
            <select
              value={groupDraftShape}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              onChange={(event) =>
                setGroupDraftShape(event.target.value as StageObjectShape)
              }
            >
              {shapes.map((shape) => (
                <option key={shape} value={shape}>
                  {shapeLabel[shape]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="mini-button primary"
          onClick={handleCreateObjectGroup}
          disabled={projectDisabled}
          title={projectDisabled ? projectReadOnlyMessage : undefined}
          type="button"
        >
          <Plus size={15} />
          道具グループ作成
        </button>
      </section>

      <section className="object-group-manager" aria-label="道具グループ一覧">
        <div className="object-visibility-list__header">
          <strong>道具グループ一覧</strong>
          <span>{objectGroups.length}グループ</span>
        </div>
        {objectGroupCards.length === 0 ? (
          <p className="empty-state compact">
            道具グループはまだありません。既存道具は未所属として扱います。
          </p>
        ) : (
          <div className="object-group-list">
            {objectGroupCards.map(
              ({ group, groupObjects, tabObjects, visibleCount, hiddenCount }) => {
                const isExpanded = expandedObjectGroupIds.includes(group.id);
                return (
                  <article className="list-card object-group-card" key={group.id}>
                    <div className="object-group-card__summary">
                      <button
                        className="mini-button icon-only"
                        onClick={() => toggleObjectGroupExpanded(group.id)}
                        type="button"
                        aria-label={`${group.name} を${isExpanded ? "閉じる" : "開く"}`}
                      >
                        {isExpanded ? (
                          <ChevronDown size={15} />
                        ) : (
                          <ChevronRight size={15} />
                        )}
                      </button>
                      <span
                        className="color-dot square"
                        style={{ backgroundColor: group.color ?? "#0d8b78" }}
                        aria-hidden="true"
                      />
                      <input
                        value={group.name}
                        disabled={projectDisabled}
                        title={projectDisabled ? projectReadOnlyMessage : undefined}
                        onChange={(event) =>
                          onUpdateObjectGroup(group.id, {
                            name: event.target.value,
                          })
                        }
                        aria-label={`${group.name} のグループ名`}
                      />
                      <span className="group-count">
                        {groupObjects.length}個
                      </span>
                    </div>
                    <div className="group-card__actions">
                      <span className="group-visibility-count">
                        表示{visibleCount} / 非表示{hiddenCount}
                      </span>
                      <ColorPaletteInput
                        compact
                        value={group.color ?? "#0d8b78"}
                        disabled={projectDisabled}
                        onChange={(color) =>
                          onUpdateObjectGroup(group.id, {
                            color,
                          })
                        }
                        label={`${group.name} の色`}
                      />
                      <select
                        className="compact-select"
                        value={group.defaultType ?? "prop"}
                        disabled={projectDisabled}
                        title={projectDisabled ? projectReadOnlyMessage : undefined}
                        onChange={(event) =>
                          onUpdateObjectGroup(group.id, {
                            defaultType: event.target.value as StageObjectType,
                          })
                        }
                        aria-label={`${group.name} の既定種類`}
                      >
                        {objectTypes.map((type) => (
                          <option key={type} value={type}>
                            {typeLabel[type]}
                          </option>
                        ))}
                      </select>
                      <button
                        className="mini-button"
                        onClick={() => onAddObjectToGroup(group, isVisibleTab)}
                        disabled={projectDisabled}
                        title={projectDisabled ? projectReadOnlyMessage : undefined}
                        type="button"
                      >
                        <Plus size={15} />
                        道具
                      </button>
                      <button
                        className="mini-button danger"
                        onClick={() => onDeleteObjectGroup(group.id)}
                        disabled={projectDisabled}
                        title={projectDisabled ? projectReadOnlyMessage : undefined}
                        type="button"
                      >
                        グループ削除
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="object-group-items">
                        {tabObjects.length === 0 ? (
                          <p className="empty-state compact">
                            {isVisibleTab
                              ? "表示中の所属道具はありません。"
                              : "非表示の所属道具はありません。"}
                          </p>
                        ) : (
                          tabObjects.map((object) => {
                            const isVisible = isObjectVisible(object);
                            const isSelected =
                              selected?.type === "object" &&
                              selected.id === object.id;
                            return (
                              <div
                                className={
                                  isSelected
                                    ? "object-group-item is-selected"
                                    : "object-group-item"
                                }
                                data-object-id={object.id}
                                key={object.id}
                                onClick={() => onSelect(object.id)}
                              >
                                <span
                                  className="color-dot square"
                                  style={{ backgroundColor: object.color }}
                                  aria-hidden="true"
                                />
                                <input
                                  value={object.name}
                                  disabled={projectDisabled}
                                  title={
                                    projectDisabled
                                      ? projectReadOnlyMessage
                                      : undefined
                                  }
                                  onChange={(event) =>
                                    onUpdateObject(object.id, {
                                      name: event.target.value,
                                    })
                                  }
                                  aria-label={`${object.name} の名前`}
                                />
                                <select
                                  value={group.id}
                                  disabled={projectDisabled}
                                  title={
                                    projectDisabled
                                      ? projectReadOnlyMessage
                                      : undefined
                                  }
                                  onChange={(event) =>
                                    onChangeObjectGroup(
                                      object.id,
                                      event.target.value || null,
                                    )
                                  }
                                  aria-label={`${object.name} の所属グループ`}
                                >
                                  <option value="">未所属</option>
                                  {objectGroups.map((candidate) => (
                                    <option
                                      key={candidate.id}
                                      value={candidate.id}
                                    >
                                      {candidate.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="mini-button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onUpdateObjectState(object.id, {
                                      visible: !isVisible,
                                    });
                                  }}
                                  disabled={sceneDisabled}
                                  title={
                                    sceneDisabled
                                      ? sceneReadOnlyMessage
                                      : undefined
                                  }
                                  type="button"
                                >
                                  {isVisible ? "非表示" : "表示"}
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>

      <section className="object-placement-tools">
        <div className="object-visibility-list__header">
          <strong>配置</strong>
          <span>選択中の道具だけに反映</span>
        </div>
        <div className="template-grid">
          <button
            className="mini-button"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectLeft")}
            type="button"
          >
            左端
          </button>
          <button
            className="mini-button"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectCenterX")}
            type="button"
          >
            横中央
          </button>
          <button
            className="mini-button"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectRight")}
            type="button"
          >
            右端
          </button>
          <button
            className="mini-button"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectTop")}
            type="button"
          >
            上端
          </button>
          <button
            className="mini-button"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectCenterY")}
            type="button"
          >
            縦中央
          </button>
          <button
            className="mini-button"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectBottom")}
            type="button"
          >
            下端
          </button>
          <button
            className="mini-button primary"
            disabled={sceneDisabled || selected?.type !== "object"}
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={() => onPlaceSelectedObject("objectStageCenter")}
            type="button"
          >
            ステージ中央
          </button>
        </div>
      </section>

      <div className="stack">
        <section className="object-visibility-list" aria-label="未所属道具">
          <div className="object-visibility-list__header">
            <strong>
              {isVisibleTab ? "未所属の表示道具" : "未所属の非表示道具"}
            </strong>
            <span>{ungroupedActiveObjects.length}個</span>
          </div>
          {ungroupedActiveObjects.length === 0 && (
            <p className="empty-state compact">
              {isVisibleTab
                ? "未所属の表示道具はありません。"
                : "未所属の非表示道具はありません。"}
            </p>
          )}
        </section>
        {activeObjects.length === 0 && (
          <p className="empty-state">
            {isVisibleTab
              ? "このシーンで表示中の道具はありません。"
              : "このシーンで非表示の道具はありません。"}
          </p>
        )}
        {ungroupedActiveObjects.map((object) => {
        const state = objectStates[object.id];
        const isVisible = isObjectVisible(object);
        const isSelected = selected?.type === "object" && selected.id === object.id;
        const assignedMemberIds = objectAssignments[object.id] ?? [];
        const assignableMembers = members
          .filter((member) => !assignedMemberIds.includes(member.id))
          .sort(compareMembersByName);
        const sortedAssignedMemberIds = [...assignedMemberIds].sort((a, b) => {
          const memberA = membersById.get(a);
          const memberB = membersById.get(b);
          if (!memberA || !memberB) return 0;
          return compareMembersByName(memberA, memberB);
        });
        const draftMemberId = assignmentDrafts[object.id] ?? "";
        return (
          <article
            key={object.id}
            data-object-id={object.id}
            className={isSelected ? "list-card is-selected" : "list-card"}
            onClick={() => onSelect(object.id)}
          >
            <div className="list-card__row">
              <span
                className="color-dot square"
                style={{ backgroundColor: object.color }}
                aria-hidden="true"
              />
              <input
                value={object.name}
                disabled={projectDisabled}
                title={projectDisabled ? projectReadOnlyMessage : undefined}
                onChange={(event) =>
                  onUpdateObject(object.id, { name: event.target.value })
                }
                aria-label={`${object.name} の名前`}
              />
            </div>
            <div className="field-grid two">
              <label>
                種類
                <select
                  value={object.type}
                  disabled={projectDisabled}
                  title={projectDisabled ? projectReadOnlyMessage : undefined}
                  onChange={(event) =>
                    onUpdateObject(object.id, {
                      type: event.target.value as StageObjectType,
                    })
                  }
                >
                  {objectTypes.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                形
                <select
                  value={object.shape}
                  disabled={projectDisabled}
                  title={projectDisabled ? projectReadOnlyMessage : undefined}
                  onChange={(event) =>
                    onUpdateObject(object.id, {
                      shape: event.target.value as StageObjectShape,
                    })
                  }
                >
                  {shapes.map((shape) => (
                    <option key={shape} value={shape}>
                      {shapeLabel[shape]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="palette-field">
                <span>色</span>
                <ColorPaletteInput
                  compact
                  value={object.color}
                  disabled={projectDisabled}
                  onChange={(color) =>
                    onUpdateObject(object.id, { color })
                  }
                  label={`${object.name} の色`}
                />
              </div>
              <label>
                zIndex
                <NumericInput
                  value={state?.zIndex ?? object.zIndex}
                  disabled={sceneDisabled}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                  onValueChange={(zIndex) =>
                    onUpdateObjectState(object.id, {
                      zIndex: Math.round(zIndex),
                    })
                  }
                />
              </label>
              <label>
                幅 m
                <NumericInput
                  min={0.1}
                  step="0.1"
                  value={state?.widthMeters ?? object.widthMeters}
                  disabled={sceneDisabled}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                  onValueChange={(widthMeters) =>
                    onUpdateObjectState(object.id, {
                      widthMeters,
                    })
                  }
                />
              </label>
              <label>
                高さ m
                <NumericInput
                  min={0.1}
                  step="0.1"
                  value={state?.heightMeters ?? object.heightMeters}
                  disabled={sceneDisabled}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                  onValueChange={(heightMeters) =>
                    onUpdateObjectState(object.id, {
                      heightMeters,
                    })
                  }
                />
              </label>
              <label>
                回転
                <NumericInput
                  step="1"
                  value={state?.rotation ?? object.defaultRotation}
                  disabled={sceneDisabled}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                  onValueChange={(rotation) =>
                    onUpdateObjectState(object.id, {
                      rotation,
                    })
                  }
                />
              </label>
              <label>
                表示
                <select
                  value={String(isVisible)}
                  disabled={sceneDisabled}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                  onChange={(event) =>
                    onUpdateObjectState(object.id, {
                      visible: event.target.value === "true",
                    })
                  }
                >
                  <option value="true">表示</option>
                  <option value="false">非表示</option>
                </select>
              </label>
            </div>
            <div className="assignment-panel">
              <div className="assignment-panel__header">
                <strong>割当メンバー</strong>
                <span>{assignedMemberIds.length}人</span>
              </div>
              <div className="assignment-chip-list">
                {assignedMemberIds.length === 0 ? (
                  <span className="muted-text">割当なし</span>
                ) : (
                  sortedAssignedMemberIds.map((memberId) => {
                    const member = membersById.get(memberId);
                    if (!member) {
                      return null;
                    }
                    return (
                      <span className="assignment-chip" key={memberId}>
                        {member.name}
                        <button
                          type="button"
                          disabled={sceneDisabled}
                          title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveAssignment(object.id, memberId, false);
                          }}
                          aria-label={`${member.name} の割当を解除`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })
                )}
              </div>
              <div className="assignment-picker">
                <select
                  value={draftMemberId}
                  onChange={(event) =>
                    setAssignmentDrafts((previous) => ({
                      ...previous,
                      [object.id]: event.target.value,
                    }))
                  }
                  onClick={(event) => event.stopPropagation()}
                  disabled={sceneDisabled || assignableMembers.length === 0}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                >
                  <option value="">
                    {assignableMembers.length === 0
                      ? "割当できるメンバーなし"
                      : "メンバーを選択"}
                  </option>
                  {assignableMembers.length === 0 ? (
                    null
                  ) : (
                    assignableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  className="mini-button"
                  disabled={sceneDisabled || !draftMemberId}
                  title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (draftMemberId) {
                      onAssignMember(object.id, draftMemberId);
                      setAssignmentDrafts((previous) => ({
                        ...previous,
                        [object.id]: "",
                      }));
                    }
                  }}
                  type="button"
                >
                  <UserPlus size={15} />
                  割当
                </button>
              </div>
            </div>
            <div className="card-actions wrap">
              <button
                className="mini-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUpdateObjectState(object.id, {
                    visible: !isVisible,
                  });
                }}
                disabled={sceneDisabled}
                title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                type="button"
              >
                {isVisible ? (
                  <Eye size={15} />
                ) : (
                  <EyeOff size={15} />
                )}
                {isVisible ? "ステージから外す" : "ステージへ戻す"}
              </button>
              <button
                className="mini-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUpdateObject(object.id, { locked: !object.locked });
                }}
                disabled={projectDisabled}
                title={projectDisabled ? projectReadOnlyMessage : undefined}
                type="button"
              >
                {object.locked ? <Lock size={15} /> : <Unlock size={15} />}
                {object.locked ? "ロック" : "編集可"}
              </button>
              <button
                className="mini-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onNudgeZ(object.id, 1);
                }}
                disabled={sceneDisabled}
                title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                type="button"
              >
                <Layers size={15} />
                前面
              </button>
              <button
                className="mini-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onNudgeZ(object.id, -1);
                }}
                disabled={sceneDisabled}
                title={sceneDisabled ? sceneReadOnlyMessage : undefined}
                type="button"
              >
                <SendToBack size={15} />
                背面
              </button>
              <button
                className="mini-button danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(object.id);
                }}
                disabled={projectDisabled}
                title={projectDisabled ? projectReadOnlyMessage : undefined}
                type="button"
              >
                <Trash2 size={15} />
                削除
              </button>
            </div>
          </article>
        );
      })}
      </div>
    </section>
  );
};

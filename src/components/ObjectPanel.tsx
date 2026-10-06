import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Plus,
  SendToBack,
  Trash2,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Member,
  MemberGroup,
  ObjectState,
  ObjectGroup,
  Selection,
  AlignmentAction,
  StageObject,
  StageObjectShape,
  StageObjectType,
} from "../types";
import { NumericInput } from "./NumericInput";
import { SceneVisibilityPicker } from "./SceneVisibilityPicker";
import { PortraitManagementTarget } from "./PortraitPanelHeader";
import type { VisibilityItem, VisibilityMemory } from "../utils/sceneVisibility";
import { PanelStickyHeader } from "./PanelStickyHeader";
import { RosterManagerButton } from "./RosterManagerButton";
import { ObjectAssignmentEditor, type AssignMember } from "./ObjectAssignmentEditor";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { isMemberShownInScene } from "../utils/assignmentCandidates";
import type { MemberPickerSceneVisibility } from "./MemberPicker";
import { ColorPaletteInput } from "./ColorPaletteInput";

type ObjectPanelProps = {
  portrait?: boolean;
  visibilityMemory?: VisibilityMemory;
  currentFrameId?: string;
  /** Resolved visibility of the selected scene (snapshot), used to order assignment candidates. */
  memberVisibility?: Readonly<Record<string, boolean>>;
  onOpenRosterManager?: () => void;
  canOpenRosterManager?: boolean;
  memberGroups: MemberGroup[];
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
  onAssignMember: AssignMember;
  onRemoveAssignment: (
    objectId: string,
    memberId: string,
    restoreMember?: boolean,
  ) => void;
  onPlaceSelectedObject: (action: AlignmentAction) => void;
};

type VisibilityTab = "visible" | "hidden";

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
  portrait = false,
  visibilityMemory,
  currentFrameId,
  memberVisibility,
  onOpenRosterManager,
  canOpenRosterManager = true,
  memberGroups,
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
  const memberGroupIndex = useMemo(
    () => buildMemberGroupIndex(memberGroups),
    [memberGroups],
  );
  const [openPickerObjectId, setOpenPickerObjectId] = useState<string | null>(null);
  const [isGroupFormOpen, setIsGroupFormOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
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
  useEffect(() => { setOpenPickerObjectId(null); }, [currentFrameId, visibilityTab]);
  // The optional hidden-only filter survives prop/scene switches.
  const [hiddenMembersOnly, setHiddenMembersOnly] = useState(false);
  const assignmentSceneVisibility = useMemo<MemberPickerSceneVisibility | undefined>(() => memberVisibility && ({
    isShown: (member) => isMemberShownInScene(member, memberVisibility),
    hiddenOnly: hiddenMembersOnly,
    onHiddenOnlyChange: setHiddenMembersOnly,
  }), [memberVisibility, hiddenMembersOnly]);
  const sceneDisabled = !canEditScene;
  const isObjectVisible = (object: StageObject): boolean =>
    objectStates[object.id]?.visible ?? object.visible ?? true;
  const visibleObjects = objects.filter(isObjectVisible);
  const hiddenObjects = objects.filter((object) => !isObjectVisible(object));
  const activeObjects = isVisibleTab ? visibleObjects : hiddenObjects;
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
    if (portrait || !scrollTarget) {
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
        scrollWithinContainer(element, { behavior: "smooth", block: "center" });
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
  }, [scrollTarget, portrait]);

  const pickerGroups = useMemo(() => objectGroups.map((group) => ({ ...group, ids: group.objectIds })), [objectGroups]);
  const pickerItems = useMemo<VisibilityItem[]>(() => objects.map((object) => {
    const visible = objectStates[object.id]?.visible ?? object.visible ?? true;
    const count = objectAssignments[object.id]?.length ?? 0;
    const states = [visible ? "表示" : "非表示", typeLabel[object.type], object.locked ? "ロック" : "編集可", "割当" + count + "人"];
    return { id: object.id, name: object.name, color: object.color, square: true, visible,
      selected: selected?.type === "object" && selected.id === object.id,
      status: states.join("・"), fullStatus: states.join("・"), detailCount: Number(count > 0) + Number(object.locked), disabled: sceneDisabled, disabledReason: sceneDisabled ? sceneReadOnlyMessage : undefined };
  }), [objects, objectStates, objectAssignments, selected, sceneDisabled, sceneReadOnlyMessage]);
  const headerActions = (
          <>
            {onOpenRosterManager && (
              <RosterManagerButton
                onClick={onOpenRosterManager}
                disabled={!canOpenRosterManager}
              />
            )}
            <button
              className="mini-button primary"
              onClick={() => onAddObject(isVisibleTab)}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
              aria-label={portrait ? "道具を追加" : undefined}
            >
              <Plus size={15} />
              {portrait ? null : "道具"}
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
              {portrait ? "貼付" : "貼り付け"}
            </button>
          </>
  );
  const visibilityPicker = <SceneVisibilityPicker title="道具" portrait={portrait} items={pickerItems} groups={pickerGroups}
    memory={visibilityMemory} actions={headerActions} visibilityTab={visibilityTab} onVisibilityTab={onVisibilityTabChange}
    onSelect={onSelect} onVisibility={(id, visible) => onUpdateObjectState(id, { visible })}
    onAll={onSetAllObjectsFrameVisibility} disabled={sceneDisabled} scrollTarget={scrollTarget} />;

  return (
    <section className="panel-section object-manager" ref={panelRef}>
      {portrait ? visibilityPicker : (
        <div className="panel-manager-header">
          <h2>道具</h2>
          <div className="panel-sticky-meta">
            選択中: {selected?.type === "object" ? objects.find(object => object.id === selected.id)?.name ?? "道具" : "なし"}
            {` / 表示 ${visibleObjects.length}個 / 非表示 ${hiddenObjects.length}個`}
          </div>
          <div className="panel-heading-actions">{headerActions}</div>
        </div>
      )}
      <div className="panel-manager-body">
        {portrait && <p className="muted-text portrait-add-target">
          現在の追加先:
          {isVisibleTab
            ? " このシーンでステージに表示"
            : " このシーンではステージ外・非表示"}
        </p>}
      {projectDisabled && (
        <p className="notice warning">{projectReadOnlyMessage}</p>
      )}
      {sceneDisabled && <p className="notice warning">{sceneReadOnlyMessage}</p>}

      {!portrait && visibilityPicker}

      {!portrait && <PanelStickyHeader>
        <div className="panel-visibility-summary">
          <div className="member-visibility-tabs" role="tablist" aria-label="表示状態">
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
        </div>
        <p className="muted-text panel-add-target">
          追加先: {isVisibleTab ? "このシーンに表示" : "このシーンでは非表示"}
        </p>
      </PanelStickyHeader>}

      <section className="object-group-manager" aria-label="グループ一覧">
        <div className="object-visibility-list__header">
          <strong>グループ一覧</strong>
          {portrait && <PortraitManagementTarget value={visibilityTab} onChange={onVisibilityTabChange} />}
          <span>{objectGroupCards.length}グループ · {isVisibleTab ? "表示中" : "非表示"}</span>
          <button className="mini-button" type="button" disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            aria-expanded={isGroupFormOpen} aria-controls="object-group-form"
            onClick={() => setIsGroupFormOpen((open) => !open)}>＋グループ</button>
        </div>
        {isGroupFormOpen && <div id="object-group-form">
            <section className="panel-group-form" aria-label="グループ作成">
              <div className="object-visibility-list__header">
                <strong>グループ作成</strong>
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
                  <span>グループの色</span>
                  <ColorPaletteInput
                    value={groupDraftColor}
                    disabled={projectDisabled}
                    onChange={setGroupDraftColor}
                    label="グループの色"
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
                グループ作成
              </button>
            </section>

        </div>}
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
                        label={`${group.name}のグループの色`}
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
                        className="mini-button danger group-delete-button"
                        onClick={() => onDeleteObjectGroup(group.id)}
                        disabled={projectDisabled}
                        aria-label={`グループ「${group.name}」を削除`}
                        title={`グループ「${group.name}」を削除`}
                        type="button"
                      >
                        <Trash2 size={18} aria-hidden="true" />
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

      <div className="stack">
        <section className="object-visibility-list" aria-label="未所属道具">
          <div className="object-visibility-list__header">
            <strong>
              未所属道具
            </strong>
            <span>{ungroupedActiveObjects.length}個</span>
          </div>
          {ungroupedActiveObjects.length === 0 && (
            <p className="empty-state compact">
              {isVisibleTab
                ? "このシーンで表示中の未所属道具はありません。"
                : "このシーンで非表示の未所属道具はありません。"}
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
                重なり順（大きいほど手前）
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
                <ObjectAssignmentEditor
                  key={`${currentFrameId ?? ""}:${visibilityTab}:${object.id}`}
                  objectId={object.id}
                  members={members}
                  assignedMemberIds={assignedMemberIds}
                  groupIndex={memberGroupIndex}
                  isPickerOpen={openPickerObjectId === object.id}
                  onPickerOpenChange={(isOpen) => setOpenPickerObjectId(isOpen ? object.id : null)}
                  disabled={sceneDisabled}
                  readOnlyMessage={sceneReadOnlyMessage}
                  onAssignMember={onAssignMember}
                  onRemoveAssignment={onRemoveAssignment}
                  sceneVisibility={assignmentSceneVisibility}
                  sceneId={currentFrameId}
                />
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
                名簿から削除
              </button>
            </div>
          </article>
        );
      })}
      </div>
      <section className="object-placement-tools">
        <div className="object-visibility-list__header">
          <strong>整列・配置</strong>
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

      </div>
    </section>
  );
};

import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FormationFrame,
  Member,
  MemberCreateInput,
  MemberGroup,
  Selection,
} from "../types";
import { SceneVisibilityPicker } from "./SceneVisibilityPicker";
import { PortraitManagementTarget } from "./PortraitPanelHeader";
import type { VisibilityItem, VisibilityMemory } from "../utils/sceneVisibility";
import { PanelStickyHeader } from "./PanelStickyHeader";
import { RosterManagerButton } from "./RosterManagerButton";
import { ColorPaletteInput } from "./ColorPaletteInput";
import { getMemberDisplayColor } from "../utils/memberAppearance";
import type { ReactNode } from "react";

type MemberPanelProps = {
  portrait?: boolean;
  visibilityMemory?: VisibilityMemory;
  onRestoreMember: (id: string) => void;
  children?: ReactNode;
  onOpenRosterManager?: () => void;
  canOpenRosterManager?: boolean;
  members: Member[];
  selected: Selection;
  selectedMemberIds: string[];
  groups: MemberGroup[];
  currentFrame?: FormationFrame;
  objectAssignmentLabelsByMemberId: Record<string, string[]>;
  visibilityTab: VisibilityTab;
  scrollTarget: { id: string; token: number } | null;
  canEditProject?: boolean;
  canEditScene?: boolean;
  projectReadOnlyMessage?: string;
  sceneReadOnlyMessage?: string;
  onVisibilityTabChange: (tab: VisibilityTab) => void;
  onSelect: (id: string) => void;
  onToggleMemberSelection: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Member>) => void;
  onSetMembersGlobalVisibility: (ids: string[], visible: boolean) => void;
  onSetMemberFrameVisibility: (ids: string[], visible: boolean) => void;
  onSetAllMembersFrameVisibility: (visible: boolean) => void;
  onSetGroupFrameVisibility: (ids: string[], visible: boolean) => void;
  onDelete: (id: string) => void;
  onAddMember: (input?: MemberCreateInput) => void;
  onCreateGroup: (draft?: {
    name?: string;
    color?: string;
    memberIds?: string[];
    visibleInCurrentFrame?: boolean;
  }) => void;
  onUpdateGroup: (id: string, patch: Partial<MemberGroup>) => void;
  onDeleteGroup: (id: string) => void;
  onAddMemberToGroup: (
    group: MemberGroup,
    visibleInCurrentFrame?: boolean,
  ) => void;
  onSelectGroup: (group: MemberGroup) => void;
  onChangeMemberGroup: (memberId: string, groupId: string | null) => void;
  onClearMemberObjectAssignments: (
    memberId: string,
    restoreMember?: boolean,
  ) => void;
  onCopySelected: () => void;
  onPasteMember: (visibleInCurrentFrame?: boolean) => void;
  canPasteMember: boolean;
};

type VisibilityTab = "visible" | "hidden";

const groupDraftColors = [
  "#0f766e",
  "#2563eb",
  "#c2410c",
  "#7c3aed",
  "#db2777",
  "#16a34a",
];

export const MemberPanel = ({
  portrait = false,
  visibilityMemory,
  onRestoreMember,
  children,
  onOpenRosterManager,
  canOpenRosterManager = true,
  members,
  selected,
  selectedMemberIds,
  groups,
  currentFrame,
  objectAssignmentLabelsByMemberId,
  visibilityTab,
  scrollTarget,
  canEditProject = true,
  canEditScene = true,
  projectReadOnlyMessage = "初期クラウド編集では、メンバー名簿やグループは編集できません。",
  sceneReadOnlyMessage = "編集するには、このシーンの編集ロックを取得してください。",
  onVisibilityTabChange,
  onSelect,
  onToggleMemberSelection,
  onUpdate,
  onSetMembersGlobalVisibility,
  onSetMemberFrameVisibility,
  onSetAllMembersFrameVisibility,
  onSetGroupFrameVisibility,
  onDelete,
  onAddMember,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAddMemberToGroup,
  onSelectGroup,
  onChangeMemberGroup,
  onClearMemberObjectAssignments,
  onCopySelected,
  onPasteMember,
  canPasteMember,
}: MemberPanelProps) => {
  const [isGroupFormOpen, setIsGroupFormOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const [draftGroupName, setDraftGroupName] = useState("");
  const [draftGroupColor, setDraftGroupColor] = useState(groupDraftColors[0]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const isVisibleTab = visibilityTab === "visible";
  const projectDisabled = !canEditProject;
  const sceneDisabled = !canEditScene;

  const memberGroupById = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group) => {
      group.memberIds.forEach((memberId) => map.set(memberId, group.id));
    });
    return map;
  }, [groups]);

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const groupNameByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group) => {
      group.memberIds.forEach((memberId) => map.set(memberId, group.name));
    });
    return map;
  }, [groups]);

  const isVisibleInCurrentFrame = (member: Member): boolean =>
    (member.visible ?? true) &&
    (currentFrame?.memberVisibility?.[member.id] !== false) &&
    (objectAssignmentLabelsByMemberId[member.id]?.length ?? 0) === 0;

  const visibleMembers = members.filter(isVisibleInCurrentFrame);
  const hiddenMembers = members.filter((member) => !isVisibleInCurrentFrame(member));
  const ungroupedMembers = members.filter(
    (member) => !memberGroupById.has(member.id),
  );
  const memberBelongsToActiveTab = (member: Member): boolean =>
    isVisibleInCurrentFrame(member) === isVisibleTab;
  const isGroupOnVisibleSide = (group: MemberGroup): boolean =>
    currentFrame?.groupVisibility?.[group.id] !== false;
  const groupsForActiveTab = groups
    .map((group) => {
      const groupMembers = group.memberIds
        .map((id) => membersById.get(id))
        .filter((member): member is Member => Boolean(member));
      const tabMembers = groupMembers.filter(memberBelongsToActiveTab);
      const shouldShowEmptyGroup =
        groupMembers.length === 0 && isGroupOnVisibleSide(group) === isVisibleTab;
      return { group, groupMembers, tabMembers, shouldShowEmptyGroup };
    })
    .filter(({ tabMembers, shouldShowEmptyGroup }) =>
      tabMembers.length > 0 || shouldShowEmptyGroup,
    );
  const activeUngroupedMembers = ungroupedMembers.filter(memberBelongsToActiveTab);

  const handleCreateGroup = () => {
    if (projectDisabled) {
      return;
    }
    onCreateGroup({
      name: draftGroupName.trim() || undefined,
      color: draftGroupColor,
      visibleInCurrentFrame: isVisibleTab,
    });
    setDraftGroupName("");
    setDraftGroupColor(
      groupDraftColors[(groups.length + 1) % groupDraftColors.length],
    );
  };

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroupIds((previous) =>
      previous.includes(groupId)
        ? previous.filter((id) => id !== groupId)
        : [...previous, groupId],
    );
  };

  useEffect(() => {
    if (portrait || !scrollTarget) {
      return undefined;
    }
    const groupId = memberGroupById.get(scrollTarget.id);
    if (groupId) {
      setExpandedGroupIds((previous) =>
        previous.includes(groupId) ? previous : [...previous, groupId],
      );
    }

    let firstFrame = 0;
    let secondFrame = 0;
    let clearTimer = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = panelRef.current?.querySelector<HTMLElement>(
          `[data-member-id="${scrollTarget.id}"]`,
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
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (clearTimer) {
        window.clearTimeout(clearTimer);
      }
    };
  }, [memberGroupById, scrollTarget, portrait]);

  const showMemberOnStage = (member: Member) => {
    if (sceneDisabled || (member.visible === false && projectDisabled)) {
      return;
    }
    onRestoreMember(member.id);
  };

  const hideMemberFromStage = (member: Member) => {
    if (sceneDisabled) {
      return;
    }
    onSetMemberFrameVisibility([member.id], false);
  };

  const renderMemberRow = (member: Member, compact = false) => {
    const isSelected = selected?.type === "member" && selected.id === member.id;
    const isMultiSelected = selectedMemberIds.includes(member.id);
    const isVisible = isVisibleInCurrentFrame(member);
    const groupName = groupNameByMemberId.get(member.id) ?? "未所属";
    const assignmentLabels = objectAssignmentLabelsByMemberId[member.id] ?? [];
    const displayColor = getMemberDisplayColor(member, {
      frame: currentFrame,
      groups,
    });
    const hasSceneColorOverride = Boolean(
      currentFrame?.memberAppearanceOverrides?.[member.id]?.color,
    );
    const canShowMemberOnStage =
      canEditScene && (member.visible !== false || canEditProject);

    return (
      <div
        key={member.id}
        data-member-id={member.id}
        className={[
          "member-row",
          compact ? "is-compact" : "",
          isSelected || isMultiSelected ? "is-selected" : "",
          !isVisible ? "is-scene-hidden" : "",
        ].join(" ")}
        onClick={() => onSelect(member.id)}
      >
        <div className="member-row__main">
          <input
            type="checkbox"
            checked={isMultiSelected}
            onChange={(event) => {
              event.stopPropagation();
              onToggleMemberSelection(member.id);
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label={`${member.name} を複数選択`}
          />
          <span
            className="color-dot"
            style={{ backgroundColor: displayColor }}
            aria-hidden="true"
          />
          <input
            value={member.name}
            disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            onChange={(event) =>
              onUpdate(member.id, { name: event.target.value })
            }
            onClick={(event) => event.stopPropagation()}
            aria-label={`${member.name} の名前`}
          />
        </div>
        {!compact && (
          <div className="member-row__settings">
            <div className="palette-field">
              <span>色</span>
              <ColorPaletteInput
                compact
                value={member.color}
                disabled={projectDisabled}
                onChange={(color) => onUpdate(member.id, { color })}
                label={`${member.name} の色`}
              />
            </div>
            <label>
              所属
              <select
                value={memberGroupById.get(member.id) ?? ""}
                disabled={projectDisabled}
                title={projectDisabled ? projectReadOnlyMessage : undefined}
                onChange={(event) =>
                  onChangeMemberGroup(member.id, event.target.value || null)
                }
                onClick={(event) => event.stopPropagation()}
              >
                <option value="">なし</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="member-row__status">
          <span className={isVisible ? "scene-status visible" : "scene-status hidden"}>
            {isVisible ? "隊列内" : "隊列外"}
          </span>
          <span className="muted-text">{groupName}</span>
          {assignmentLabels.length > 0 && (
            <span className="assignment-badge">
              割当: {assignmentLabels.join(" / ")}
            </span>
          )}
          {hasSceneColorOverride && (
            <span className="assignment-badge">色変更あり</span>
          )}
        </div>
        <div className="card-actions wrap">
          {isVisible ? (
            <button
              className="mini-button"
              onClick={(event) => {
                event.stopPropagation();
                hideMemberFromStage(member);
              }}
              disabled={sceneDisabled}
              title={sceneDisabled ? sceneReadOnlyMessage : undefined}
              type="button"
            >
              <EyeOff size={15} />
              隊列外へ
            </button>
          ) : (
            <button
              className="mini-button primary"
              onClick={(event) => {
                event.stopPropagation();
                showMemberOnStage(member);
              }}
              disabled={!canShowMemberOnStage}
              title={
                sceneDisabled
                  ? sceneReadOnlyMessage
                  : member.visible === false && projectDisabled
                    ? projectReadOnlyMessage
                    : undefined
              }
              type="button"
            >
              <Eye size={15} />
              ステージへ戻す
            </button>
          )}
          {assignmentLabels.length > 0 && (
            <button
              className="mini-button"
              onClick={(event) => {
                event.stopPropagation();
                onClearMemberObjectAssignments(member.id, false);
              }}
              disabled={sceneDisabled}
              title={sceneDisabled ? sceneReadOnlyMessage : undefined}
              type="button"
            >
              割当解除
            </button>
          )}
          {!compact && (
            <button
              className="mini-button"
              onClick={(event) => {
                event.stopPropagation();
                onUpdate(member.id, { visible: !(member.visible ?? true) });
              }}
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              {(member.visible ?? true) ? <EyeOff size={15} /> : <Eye size={15} />}
              {(member.visible ?? true) ? "全シーンで非表示" : "全シーンの非表示を解除"}
            </button>
          )}
          <button
            className="mini-button danger"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(member.id);
            }}
            disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            type="button"
          >
            <Trash2 size={15} />
            名簿から削除
          </button>
        </div>
      </div>
    );
  };

  const pickerGroups = useMemo(() => groups.map((group) => ({ ...group, ids: group.memberIds })), [groups]);
  const groupColorByMemberId = useMemo(() => {
    const colors = new Map<string, string>();
    groups.forEach((group) => group.memberIds.forEach((id) => { if (!colors.has(id) && group.color) colors.set(id, group.color); }));
    return colors;
  }, [groups]);
  const selectedIds = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);
  const pickerItems = useMemo<VisibilityItem[]>(() => members.map((member) => {
    const labels = objectAssignmentLabelsByMemberId[member.id] ?? [];
    const visible = (member.visible ?? true) && currentFrame?.memberVisibility?.[member.id] !== false && labels.length === 0;
    const override = currentFrame?.memberAppearanceOverrides?.[member.id]?.color;
    const states = [visible ? "表示" : "非表示", ...(member.visible === false ? ["全シーン非表示"] : []),
      ...(labels.length ? ["割当: " + labels[0] + (labels.length > 1 ? "＋" + (labels.length - 1) : "")] : []), ...(override ? ["色変更あり"] : [])];
    return { id: member.id, name: member.name, color: override ?? groupColorByMemberId.get(member.id) ?? member.color,
      visible, selected: (selected?.type === "member" && selected.id === member.id) || selectedIds.has(member.id),
      status: states.join("・"), fullStatus: [...states.filter((state) => !state.startsWith("割当:")), ...(labels.length ? ["割当: " + labels.join("、")] : [])].join("・"),
      detailCount: labels.length + Number(member.visible === false) + Number(Boolean(override)),
      disabled: sceneDisabled || (!visible && member.visible === false && projectDisabled),
      disabledReason: sceneDisabled ? sceneReadOnlyMessage : member.visible === false && projectDisabled ? projectReadOnlyMessage : undefined };
  }), [members, currentFrame?.memberVisibility, currentFrame?.memberAppearanceOverrides, objectAssignmentLabelsByMemberId,
    groupColorByMemberId, selected, selectedIds, sceneDisabled, projectDisabled, sceneReadOnlyMessage, projectReadOnlyMessage]);
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
              onClick={() =>
                onAddMember({ visibleInCurrentFrame: isVisibleTab })
              }
              disabled={projectDisabled}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
              aria-label={portrait ? "メンバーを追加" : undefined}
            >
              <Plus size={15} />
              {portrait ? null : "メンバー"}
            </button>
            <button className="mini-button" onClick={onCopySelected} type="button">
              コピー
            </button>
            <button
              className="mini-button"
              onClick={() => onPasteMember(isVisibleTab)}
              disabled={projectDisabled || !canPasteMember}
              title={projectDisabled ? projectReadOnlyMessage : undefined}
              type="button"
            >
              {portrait ? "貼付" : "貼り付け"}
            </button>
          </>
  );
  const visibilityPicker = <SceneVisibilityPicker title="メンバー" portrait={portrait} items={pickerItems} groups={pickerGroups}
    memory={visibilityMemory} actions={headerActions} visibilityTab={visibilityTab} onVisibilityTab={onVisibilityTabChange}
    onSelect={onSelect} onVisibility={(id, visible) => { const member = membersById.get(id); if (member) { if (visible) showMemberOnStage(member); else hideMemberFromStage(member); } }}
    onAll={onSetAllMembersFrameVisibility} disabled={sceneDisabled} scrollTarget={scrollTarget} />;

  return (
    <section className="panel-section member-manager" ref={panelRef}>
      {portrait ? visibilityPicker : (
      <PanelStickyHeader
        title="メンバー"
        meta={`表示 ${visibleMembers.length}人 / 非表示 ${hiddenMembers.length}人 / 選択中 ${selectedMemberIds.length}人`}
        actions={headerActions}
      >
        <div className="panel-visibility-summary">
          <div className="member-visibility-tabs" role="tablist" aria-label="表示状態">
            <button
              className={visibilityTab === "visible" ? "is-active" : ""}
              onClick={() => onVisibilityTabChange("visible")}
              type="button"
            >
              表示 {visibleMembers.length}
            </button>
            <button
              className={visibilityTab === "hidden" ? "is-active" : ""}
              onClick={() => onVisibilityTabChange("hidden")}
              type="button"
            >
              非表示 {hiddenMembers.length}
            </button>
          </div>
        </div>
      </PanelStickyHeader>
      )}
      <div className="panel-manager-body">
        <p className={portrait ? "muted-text portrait-add-target" : "muted-text"}>
          現在の追加先:
          {isVisibleTab
            ? " このシーンでステージに表示"
            : " このシーンでは隊列外・非表示"}
        </p>
      {projectDisabled && (
        <p className="notice warning">{projectReadOnlyMessage}</p>
      )}
      {sceneDisabled && <p className="notice warning">{sceneReadOnlyMessage}</p>}

      {!portrait && visibilityPicker}

      <div className="member-management-block">
        <div className="panel-section__header">
          <h3>グループ一覧</h3>
          {portrait && <PortraitManagementTarget value={visibilityTab} onChange={onVisibilityTabChange} />}
          <span>{groupsForActiveTab.length}グループ · {isVisibleTab ? "表示中" : "非表示"}</span>
          <button className="mini-button" type="button" disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            aria-expanded={isGroupFormOpen} aria-controls="member-group-form"
            onClick={() => setIsGroupFormOpen((open) => !open)}>＋グループ</button>
        </div>
        {isGroupFormOpen && <div id="member-group-form">
            <div className="panel-group-form" aria-label="グループ作成">
              <div className="panel-section__header">
                <h3>グループ作成</h3>

              </div>
              <div className="settings-grid">
                <label>
                  グループ名
                  <input
                    value={draftGroupName}
                    disabled={projectDisabled}
                    title={projectDisabled ? projectReadOnlyMessage : undefined}
                    onChange={(event) => setDraftGroupName(event.target.value)}
                    placeholder="未入力なら グループ1"
                  />
                </label>
                <div className="palette-field">
                  <span>グループの色</span>
                  <ColorPaletteInput
                    value={draftGroupColor}
                    disabled={projectDisabled}
                    onChange={setDraftGroupColor}
                    label="グループの色"
                  />
                </div>
              </div>
                <button
                  className="mini-button primary"
                  disabled={projectDisabled}
                  title={projectDisabled ? projectReadOnlyMessage : undefined}
                  onClick={handleCreateGroup}
                  type="button"
                >
                  <Plus size={15} />
                  グループ作成
                </button>
              <p className="muted-text">
                先にグループを作り、カード内の「＋メンバー」から追加すると名前と色が自動でそろいます。
              </p>
            </div>

        </div>}
        <div className="stack">
          {groups.length === 0 && (
            <p className="empty-state">
              まだグループがありません。見出しの「＋グループ」から作成できます。
            </p>
          )}
          {groups.length > 0 && groupsForActiveTab.length === 0 && (
            <p className="empty-state">
              {isVisibleTab
                ? "このシーンで表示中のメンバーを含むグループはありません。"
                : "このシーンで非表示のメンバーを含むグループはありません。"}
            </p>
          )}
          {groupsForActiveTab.map(({ group, groupMembers, tabMembers }) => {
            const color = group.color ?? "#0f766e";
            const visibleCount = groupMembers.filter(isVisibleInCurrentFrame).length;
            const hiddenCount = groupMembers.length - visibleCount;
            const isExpanded = expandedGroupIds.includes(group.id);
            const status =
              groupMembers.length === 0
                ? "empty"
                : visibleCount === groupMembers.length
                  ? "visible"
                  : visibleCount === 0
                    ? "hidden"
                    : "partial";
            const statusText =
              status === "visible"
                ? "表示中"
                : status === "hidden"
                  ? "非表示"
                  : status === "partial"
                    ? "一部表示"
                    : "空";
            return (
              <article className="list-card group-card is-collapsible" key={group.id}>
                <div
                  className="group-card__summary"
                  onClick={() => toggleGroupExpanded(group.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleGroupExpanded(group.id);
                    }
                  }}
                >
                  <button
                    className="icon-button compact"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleGroupExpanded(group.id);
                    }}
                    type="button"
                    aria-label={isExpanded ? "折りたたむ" : "展開する"}
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <span
                    className="color-dot"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <input
                    value={group.name}
                    disabled={projectDisabled}
                    title={projectDisabled ? projectReadOnlyMessage : undefined}
                    onChange={(event) =>
                      onUpdateGroup(group.id, { name: event.target.value })
                    }
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    aria-label="グループ名"
                  />
                  <span className="group-count">{groupMembers.length}人</span>
                  <span className="group-visibility-count">
                    {isVisibleTab ? `表示${tabMembers.length}` : `非表示${tabMembers.length}`}
                    <small> / 全体 表示{visibleCount} 非表示{hiddenCount}</small>
                  </span>
                  <span className={`group-status ${status}`}>{statusText}</span>
                </div>
                <div className="group-card__actions">
                  <div className="group-color-field" onClick={(event) => event.stopPropagation()}>
                    <span>グループの色</span>
                    <ColorPaletteInput
                      compact
                      value={color}
                      disabled={projectDisabled}
                      onChange={(nextColor) =>
                        onUpdateGroup(group.id, { color: nextColor })
                      }
                      label={`${group.name}のグループの色`}
                    />
                  </div>
                  <button
                    className="mini-button primary"
                    onClick={() => onAddMemberToGroup(group, isVisibleTab)}
                    disabled={projectDisabled}
                    title={projectDisabled ? projectReadOnlyMessage : undefined}
                    type="button"
                  >
                    <Plus size={15} />
                    メンバー
                  </button>
                  <button
                    className={isVisibleTab ? "mini-button" : "mini-button is-active"}
                    disabled={sceneDisabled || (!isVisibleTab && projectDisabled)}
                    title={
                      sceneDisabled
                        ? sceneReadOnlyMessage
                        : !isVisibleTab && projectDisabled
                          ? projectReadOnlyMessage
                          : undefined
                    }
                    onClick={() => {
                      const targetIds = tabMembers.map((member) => member.id);
                      if (isVisibleTab) {
                        if (targetIds.length > 0) {
                          onSetMemberFrameVisibility(targetIds, false);
                        }
                        onSetGroupFrameVisibility([group.id], false);
                        return;
                      }
                      if (targetIds.length > 0) {
                        onSetMembersGlobalVisibility(targetIds, true);
                        onSetMemberFrameVisibility(targetIds, true);
                      }
                      onSetGroupFrameVisibility([group.id], true);
                    }}
                    type="button"
                  >
                    {isVisibleTab ? <EyeOff size={15} /> : <Eye size={15} />}
                    {isVisibleTab ? "隊列外へ" : "ステージへ戻す"}
                  </button>
                  <button
                    className="mini-button"
                    onClick={() =>
                      onSelectGroup({
                        ...group,
                        memberIds: tabMembers.map((member) => member.id),
                      })
                    }
                    type="button"
                  >
                    <Users size={15} />
                    選択
                  </button>
                  <button
                    className="mini-button danger"
                    onClick={() => onDeleteGroup(group.id)}
                    disabled={projectDisabled}
                    title={projectDisabled ? projectReadOnlyMessage : undefined}
                    type="button"
                  >
                    <Trash2 size={15} />
                    グループ削除
                  </button>
                </div>
                {isExpanded && (
                  <div className="group-member-list is-scrollable">
                    {tabMembers.length === 0 ? (
                      <p className="muted-text">
                        {isVisibleTab
                          ? "表示中の所属メンバーはいません。"
                          : "非表示の所属メンバーはいません。"}
                      </p>
                    ) : (
                      tabMembers.map((member) => renderMemberRow(member, true))
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="member-management-block">
        <div className="panel-section__header">
          <h3>未所属メンバー</h3>
          <span>{activeUngroupedMembers.length}人</span>
          <button
            className="mini-button"
            onClick={() =>
              onAddMember({ visibleInCurrentFrame: isVisibleTab })
            }
            disabled={projectDisabled}
            title={projectDisabled ? projectReadOnlyMessage : undefined}
            type="button"
          >
            <Plus size={15} />
            未所属メンバー
          </button>
        </div>
        <div className="stack">
          {activeUngroupedMembers.length === 0 ? (
            <p className="empty-state">
              {visibilityTab === "visible"
                ? "このシーンで表示中の未所属メンバーはいません。"
                : "このシーンで非表示の未所属メンバーはいません。"}
            </p>
          ) : (
            activeUngroupedMembers.map((member) => renderMemberRow(member, false))
          )}
        </div>
      </div>
      {children}
      </div>
    </section>
  );
};

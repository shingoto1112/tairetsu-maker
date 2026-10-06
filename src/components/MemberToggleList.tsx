import { Check } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Member, StageObject } from "../types";
import { useMemberPickerOrder } from "../hooks/useMemberPickerOrder";
import { sortMembersForPicker, type MemberGroupIndex } from "../utils/memberOrdering";
import { shownMemberAssignmentNotice } from "../utils/assignmentCandidates";
import type { MemberPickerSceneVisibility } from "./MemberPicker";
import "./assignmentMemberSelection.css";

type Props = {
  members: Member[];
  groupIndex: MemberGroupIndex;
  assignedIds: ReadonlySet<string>;
  otherObjectsByMember: ReadonlyMap<string, StageObject[]>;
  onToggle: (memberId: string) => void;
  disabled?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  /** Scene-aware order and filter; assigning a shown member asks inline first. */
  sceneVisibility?: MemberPickerSceneVisibility;
  /** Drops an unconfirmed inline question when the scene or prop changes. */
  resetKey?: string;
};

export const MemberToggleList = ({ members, groupIndex, assignedIds, otherObjectsByMember, onToggle, disabled, searchQuery, onSearchQueryChange, sceneVisibility, resetKey }: Props) => {
  const [localQuery, setLocalQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const setQuery = onSearchQueryChange ?? setLocalQuery;
  const [order, selectOrder] = useMemberPickerOrder();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => { setConfirmId(null); }, [resetKey]);
  const isShown = sceneVisibility?.isShown;
  const hiddenOnly = sceneVisibility?.hiddenOnly ?? false;
  // Members already assigned to this prop are hidden in the scene, so they stay listed and can be unassigned.
  const isShownCandidate = (member: Member) => !!isShown && isShown(member) && !assignedIds.has(member.id);
  const rows = useMemo(() => {
    const sorted = sortMembersForPicker(
      members.filter((member) => member.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
      order, groupIndex,
    );
    return isShown && hiddenOnly ? sorted.filter((member) => !(isShown(member) && !assignedIds.has(member.id))) : sorted;
  }, [members, query, order, groupIndex, isShown, hiddenOnly, assignedIds]);
  const confirmMember = confirmId ? members.find((member) => member.id === confirmId) : undefined;

  const renderRows = (list: Member[]) => list.map((member, index) => {
    const membership = groupIndex.get(member.id);
    const groupName = membership?.group.name ?? "未所属";
    const color = membership?.group.color ?? "#94a3b8";
    const other = otherObjectsByMember.get(member.id) ?? [];
    const description = other.length ? `${other.map((object) => object.name).join("、")}も担当` : "";
    const shownInScene = isShownCandidate(member);
    return <Fragment key={member.id}>
      {order === "group" && (index === 0 || membership?.groupIndex !== groupIndex.get(list[index - 1].id)?.groupIndex) &&
        <h4 className="member-toggle-list__heading" style={{ borderLeftColor: color }}>{groupName}</h4>}
      <button type="button" className={`member-toggle-list__row${shownInScene ? " is-shown-in-scene" : ""}`} disabled={disabled}
        aria-pressed={assignedIds.has(member.id)} aria-label={`${member.name} ${groupName}${shownInScene ? " 表示中" : ""}${description ? `・${description}` : ""}`}
        title={description || undefined}
        onClick={() => {
          if (shownInScene && !assignedIds.has(member.id)) { setConfirmId(member.id); return; }
          setConfirmId(null);
          onToggle(member.id);
        }}>
        <span className="member-toggle-list__check" aria-hidden="true">{assignedIds.has(member.id) && <Check size={16} />}</span>
        <span className="member-toggle-list__name">{member.name}{order === "name" && <small>{groupName}</small>}</span>
        {shownInScene && <em className="member-toggle-list__shown-badge" aria-hidden="true">表示中</em>}
        {other.length > 0 && <small className="member-toggle-list__other">{other[0].name}{other.length > 1 ? `ほか${other.length - 1}件` : ""}も担当</small>}
      </button>
      {confirmMember?.id === member.id && <div className="assignment-shown-notice" role="status">
        {shownMemberAssignmentNotice(member.name)}
        <div className="assignment-shown-notice__actions">
          <button type="button" className="primary" disabled={disabled} onClick={() => { setConfirmId(null); onToggle(member.id); }}>割り当てる</button>
          <button type="button" onClick={() => setConfirmId(null)}>キャンセル</button>
        </div>
      </div>}
    </Fragment>;
  });

  return <div className="member-toggle-list">
    <div className="member-toggle-list__controls">
      <input type="search" aria-label="メンバー名を検索" placeholder="メンバー名を検索"
        value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="member-picker__orders" role="group" aria-label="候補の並び順">
        {(["group", "name"] as const).map((value) => <button key={value} type="button"
          aria-pressed={order === value} onClick={() => selectOrder(value)}>{value === "group" ? "グループ順" : "名前順"}</button>)}
      </div>
      {sceneVisibility && <label className="member-picker__hidden-only">
        <input type="checkbox" checked={hiddenOnly} onChange={(event) => sceneVisibility.onHiddenOnlyChange(event.target.checked)} />
        このシーンで非表示の人だけ
      </label>}
    </div>
    <div className="member-toggle-list__rows" aria-label="担当メンバー一覧">
      {rows.length === 0 && <p className="muted-text">{sceneVisibility && hiddenOnly && !query.trim()
        ? "このシーンで非表示の人はいません。「このシーンで非表示の人だけ」を外すと、表示中の人も選べます。"
        : "該当するメンバーはいません。"}</p>}
      {renderRows(rows)}
    </div>
  </div>;
};

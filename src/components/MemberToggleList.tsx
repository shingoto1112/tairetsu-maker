import { Check } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Member, StageObject } from "../types";
import { useMemberPickerOrder } from "../hooks/useMemberPickerOrder";
import { sortMembersForPicker, type MemberGroupIndex } from "../utils/memberOrdering";
import { shownMemberAssignmentNotice, splitBySceneVisibility } from "../utils/assignmentCandidates";
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

type Section = { key: "all" | "hidden" | "shown"; label?: string; members: Member[] };

export const MemberToggleList = ({ members, groupIndex, assignedIds, otherObjectsByMember, onToggle, disabled, searchQuery, onSearchQueryChange, sceneVisibility, resetKey }: Props) => {
  const [localQuery, setLocalQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const setQuery = onSearchQueryChange ?? setLocalQuery;
  const [order, selectOrder] = useMemberPickerOrder();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => { setConfirmId(null); }, [resetKey]);
  const isShown = sceneVisibility?.isShown;
  const hiddenOnly = sceneVisibility?.hiddenOnly ?? false;
  const sections = useMemo<Section[]>(() => {
    const sorted = sortMembersForPicker(
      members.filter((member) => member.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
      order, groupIndex,
    );
    if (!isShown) return [{ key: "all", members: sorted }];
    // Members already assigned to this prop stay listed so they can be unassigned.
    const { hidden, shown } = splitBySceneVisibility(sorted, (member) => isShown(member) && !assignedIds.has(member.id));
    const result: Section[] = [{ key: "hidden", label: "このシーンで非表示の人", members: hidden }];
    if (!hiddenOnly) result.push({ key: "shown", label: "表示中の人（割り当てると非表示になります）", members: shown });
    return result;
  }, [members, query, order, groupIndex, isShown, hiddenOnly, assignedIds]);
  const count = sections.reduce((total, section) => total + section.members.length, 0);
  const confirmMember = confirmId ? members.find((member) => member.id === confirmId) : undefined;

  const renderRows = (section: Section) => section.members.map((member, index) => {
    const membership = groupIndex.get(member.id);
    const groupName = membership?.group.name ?? "未所属";
    const color = membership?.group.color ?? "#94a3b8";
    const other = otherObjectsByMember.get(member.id) ?? [];
    const description = other.length ? `${other.map((object) => object.name).join("、")}も担当` : "";
    const shownSection = section.key === "shown";
    return <Fragment key={member.id}>
      {order === "group" && (index === 0 || membership?.groupIndex !== groupIndex.get(section.members[index - 1].id)?.groupIndex) &&
        <h4 className="member-toggle-list__heading" style={{ borderLeftColor: color }}>{groupName}</h4>}
      <button type="button" className={`member-toggle-list__row${shownSection ? " is-shown-in-scene" : ""}`} disabled={disabled}
        aria-pressed={assignedIds.has(member.id)} aria-label={`${member.name} ${groupName}${shownSection ? " 表示中" : ""}${description ? `・${description}` : ""}`}
        title={description || undefined}
        onClick={() => {
          if (shownSection && !assignedIds.has(member.id)) { setConfirmId(member.id); return; }
          setConfirmId(null);
          onToggle(member.id);
        }}>
        <span className="member-toggle-list__check" aria-hidden="true">{assignedIds.has(member.id) && <Check size={16} />}</span>
        <span className="member-toggle-list__name">{member.name}{order === "name" && <small>{groupName}</small>}</span>
        {shownSection && <em className="member-toggle-list__shown-badge" aria-hidden="true">表示中</em>}
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
      {count === 0 && <p className="muted-text">{sceneVisibility && hiddenOnly && !query.trim()
        ? "このシーンで非表示の人はいません。「このシーンで非表示の人だけ」を外すと、表示中の人も選べます。"
        : "該当するメンバーはいません。"}</p>}
      {sections.map((section) => section.members.length > 0 && <Fragment key={section.key}>
        {section.label && <p className="member-picker__section">{section.label}</p>}
        {renderRows(section)}
      </Fragment>)}
    </div>
  </div>;
};

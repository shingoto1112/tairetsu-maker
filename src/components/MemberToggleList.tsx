import { Check } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { Member, StageObject } from "../types";
import { useMemberPickerOrder } from "../hooks/useMemberPickerOrder";
import { sortMembersForPicker, type MemberGroupIndex } from "../utils/memberOrdering";

type Props = {
  members: Member[];
  groupIndex: MemberGroupIndex;
  assignedIds: ReadonlySet<string>;
  otherObjectsByMember: ReadonlyMap<string, StageObject[]>;
  onToggle: (memberId: string) => void;
  disabled?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
};

export const MemberToggleList = ({ members, groupIndex, assignedIds, otherObjectsByMember, onToggle, disabled, searchQuery, onSearchQueryChange }: Props) => {
  const [localQuery, setLocalQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const setQuery = onSearchQueryChange ?? setLocalQuery;
  const [order, selectOrder] = useMemberPickerOrder();
  const visible = useMemo(() => sortMembersForPicker(
    members.filter((member) => member.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    order, groupIndex,
  ), [members, query, order, groupIndex]);
  return <div className="member-toggle-list">
    <div className="member-toggle-list__controls">
      <input type="search" aria-label="メンバー名を検索" placeholder="メンバー名を検索"
        value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="member-picker__orders" role="group" aria-label="候補の並び順">
        {(["group", "name"] as const).map((value) => <button key={value} type="button"
          aria-pressed={order === value} onClick={() => selectOrder(value)}>{value === "group" ? "グループ順" : "名前順"}</button>)}
      </div>
    </div>
    <div className="member-toggle-list__rows" aria-label="担当メンバー一覧">
      {visible.length === 0 && <p className="muted-text">該当するメンバーはいません。</p>}
      {visible.map((member, index) => {
        const membership = groupIndex.get(member.id);
        const groupName = membership?.group.name ?? "未所属";
        const color = membership?.group.color ?? "#94a3b8";
        const other = otherObjectsByMember.get(member.id) ?? [];
        const description = other.length ? `${other.map((object) => object.name).join("、")}も担当` : "";
        return <Fragment key={member.id}>
          {order === "group" && (index === 0 || membership?.groupIndex !== groupIndex.get(visible[index - 1].id)?.groupIndex) &&
            <h4 className="member-toggle-list__heading" style={{ borderLeftColor: color }}>{groupName}</h4>}
          <button type="button" className="member-toggle-list__row" disabled={disabled}
            aria-pressed={assignedIds.has(member.id)} aria-label={`${member.name} ${groupName}${description ? `・${description}` : ""}`}
            title={description || undefined} onClick={() => onToggle(member.id)}>
            <span className="member-toggle-list__check" aria-hidden="true">{assignedIds.has(member.id) && <Check size={16} />}</span>
            <span className="member-toggle-list__name">{member.name}{order === "name" && <small>{groupName}</small>}</span>
            {other.length > 0 && <small className="member-toggle-list__other">{other[0].name}{other.length > 1 ? `ほか${other.length - 1}件` : ""}も担当</small>}
          </button>
        </Fragment>;
      })}
    </div>
  </div>;
};

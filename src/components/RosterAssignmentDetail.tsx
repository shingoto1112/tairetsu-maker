import { X } from "lucide-react";
import type { Member, StageObject } from "../types";
import type { MemberGroupIndex } from "../utils/memberOrdering";
import { MemberToggleList } from "./MemberToggleList";

type Props = {
  object: StageObject;
  groupName: string;
  members: Member[];
  assigned: Member[];
  assignedIds: ReadonlySet<string>;
  groupIndex: MemberGroupIndex;
  otherObjectsByMember: ReadonlyMap<string, StageObject[]>;
  visible: boolean;
  disabled: boolean;
  onToggle: (memberId: string) => void;
  memberQuery: string;
  onMemberQuery: (query: string) => void;
};
export const RosterAssignmentDetail = ({ object, groupName, members, assigned, assignedIds,
  groupIndex, otherObjectsByMember, visible, disabled, onToggle, memberQuery, onMemberQuery }: Props) => <>
  <header className="roster-assignment-detail__header">
    <span className="color-dot" style={{ backgroundColor: object.color }} aria-hidden="true" />
    <div><h3>{object.name}</h3><small>{groupName}</small></div>
  </header>
  <div className="roster-assignment-assignees">
    <h4>担当（{assigned.length}人）</h4>
    <div className="assignment-chip-list">
      {assigned.length === 0 && <span className="muted-text">担当者なし</span>}
      {assigned.map((member) => <span className="assignment-chip" key={member.id}>
        <span className="assignment-chip__dot" aria-hidden="true" style={{ backgroundColor: groupIndex.get(member.id)?.group.color ?? "#94a3b8" }} />
        {member.name}
        {visible && <button type="button" disabled={disabled} aria-label={`${member.name} の割当を解除`}
          onClick={() => onToggle(member.id)}><X size={14} aria-hidden="true" /></button>}
      </span>)}
    </div>
  </div>
  {visible ? <MemberToggleList members={members} groupIndex={groupIndex} assignedIds={assignedIds}
    otherObjectsByMember={otherObjectsByMember} disabled={disabled} onToggle={onToggle}
    searchQuery={memberQuery} onSearchQueryChange={onMemberQuery} /> :
    <p className="roster-assignment-help">このシーンでは閲覧のみです。隊列表の道具タブで表示にすると割当できます。</p>}
</>;

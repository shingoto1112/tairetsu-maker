import { UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Member } from "../types";
import type { MemberGroupIndex } from "../utils/memberOrdering";
import { MemberPicker, type MemberPickerSceneVisibility } from "./MemberPicker";
import { shownMemberAssignmentNotice } from "../utils/assignmentCandidates";

export type AssignMember = (objectId: string, memberId: string) => boolean | Promise<boolean>;
export type RemoveAssignment = (objectId: string, memberId: string, restoreMember?: boolean) => void | boolean | Promise<boolean>;

type ObjectAssignmentEditorProps = {
  objectId: string;
  members: Member[];
  assignedMemberIds: string[];
  groupIndex: MemberGroupIndex;
  isPickerOpen: boolean;
  onPickerOpenChange: (isOpen: boolean) => void;
  onAssignMember: AssignMember;
  onRemoveAssignment: RemoveAssignment;
  disabled?: boolean;
  readOnlyMessage?: string;
  /** Scene-aware candidate list (hidden members first, "非表示の人だけ"). */
  sceneVisibility?: MemberPickerSceneVisibility;
  /** Clears an unconfirmed choice when the scene changes under the editor. */
  sceneId?: string;
};

export const ObjectAssignmentEditor = ({
  objectId, members, assignedMemberIds, groupIndex, isPickerOpen,
  onPickerOpenChange, onAssignMember, onRemoveAssignment,
  disabled = false, readOnlyMessage, sceneVisibility, sceneId,
}: ObjectAssignmentEditorProps) => {
  const [draftMemberId, setDraftMemberId] = useState("");
  useEffect(() => { setDraftMemberId(""); }, [sceneId]);
  const [isAssigning, setIsAssigning] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { assignedMembers, candidates } = useMemo(() => {
    const assigned = new Set(assignedMemberIds);
    return {
      assignedMembers: members.filter((member) => assigned.has(member.id))
        .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true })),
      // Keep the pending choice available even if an optimistic cloud update already added it.
      candidates: members.filter((member) => !assigned.has(member.id) || member.id === draftMemberId),
    };
  }, [members, assignedMemberIds, draftMemberId]);
  const draftMember = candidates.find((member) => member.id === draftMemberId);
  const validDraft = !!draftMember;
  const draftShown = !!draftMember && !!sceneVisibility?.isShown(draftMember);
  const unavailable = disabled || isAssigning;

  return (
    <div className="object-assignment-editor">
      <div className="assignment-chip-list">
        {assignedMembers.length === 0 ? <span className="muted-text">割当なし</span> : assignedMembers.map((member) => (
          <span className="assignment-chip" key={member.id}>
            <span className="assignment-chip__dot" aria-hidden="true" style={{ backgroundColor: groupIndex.get(member.id)?.group.color ?? "#94a3b8" }} />
            {member.name}
            <button type="button" disabled={unavailable}
              title={disabled ? readOnlyMessage : undefined}
              aria-label={`${member.name} の割当を解除`}
              onClick={(event) => {
                event.stopPropagation();
                if (!unavailable) onRemoveAssignment(objectId, member.id, false);
              }}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="assignment-picker">
        <MemberPicker members={candidates} groupIndex={groupIndex}
          selectedMemberId={validDraft ? draftMemberId : ""}
          isOpen={isPickerOpen} onOpenChange={onPickerOpenChange}
          onSelect={setDraftMemberId} disabled={unavailable || candidates.length === 0}
          title={disabled ? readOnlyMessage : undefined} sceneVisibility={sceneVisibility} />
        <button className="mini-button" type="button" disabled={unavailable || !validDraft}
          title={disabled ? readOnlyMessage : undefined}
          onClick={async (event) => {
            event.stopPropagation();
            if (disabled || pending.current || !validDraft) return;
            pending.current = true;
            setIsAssigning(true);
            try {
              if (await onAssignMember(objectId, draftMemberId) && mounted.current) {
                setDraftMemberId("");
                onPickerOpenChange(false);
              }
            } finally {
              pending.current = false;
              if (mounted.current) setIsAssigning(false);
            }
          }}>
          <UserPlus size={15} />割当
        </button>
      </div>
      {draftShown && draftMember && <p className="assignment-shown-notice" role="status">{shownMemberAssignmentNotice(draftMember.name)}</p>}
    </div>
  );
};

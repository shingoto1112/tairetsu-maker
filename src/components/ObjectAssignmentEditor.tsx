import { UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Member } from "../types";
import type { MemberGroupIndex } from "../utils/memberOrdering";
import { MemberPicker, type MemberPickerSceneVisibility } from "./MemberPicker";
import { shownMembersAssignmentNotice } from "../utils/assignmentCandidates";

export type AssignMember = (objectId: string, memberId: string) => boolean | Promise<boolean>;
export type AssignMembers = (objectId: string, memberIds: string[]) => boolean | Promise<boolean>;
export type RemoveAssignment = (objectId: string, memberId: string, restoreMember?: boolean) => void | boolean | Promise<boolean>;

type ObjectAssignmentEditorProps = {
  objectId: string;
  members: Member[];
  assignedMemberIds: string[];
  groupIndex: MemberGroupIndex;
  isPickerOpen: boolean;
  onPickerOpenChange: (isOpen: boolean) => void;
  onAssignMembers: AssignMembers;
  onRemoveAssignment: RemoveAssignment;
  disabled?: boolean;
  readOnlyMessage?: string;
  /** Scene-aware badges and the optional "非表示の人だけ" filter. */
  sceneVisibility?: MemberPickerSceneVisibility;
  /** Clears an unconfirmed choice when the scene changes under the editor. */
  sceneId?: string;
  projectId?: string;
};

export const ObjectAssignmentEditor = ({
  objectId, members, assignedMemberIds, groupIndex, isPickerOpen,
  onPickerOpenChange, onAssignMembers, onRemoveAssignment,
  disabled = false, readOnlyMessage, sceneVisibility, sceneId, projectId,
}: ObjectAssignmentEditorProps) => {
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState("");
  // A new target gets its own request token; a late response cannot clear its draft.
  const context = useMemo(() => ({}), [projectId, sceneId, objectId, disabled]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const pending = useRef<object | null>(null);
  useEffect(() => {
    setDraftMemberIds([]);
    setError("");
    setIsAssigning(false);
    pending.current = null;
  }, [context]);
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
      candidates: members.filter((member) => !assigned.has(member.id)),
    };
  }, [members, assignedMemberIds]);
  const validIds = draftMemberIds.filter((id) => candidates.some((member) => member.id === id));
  useEffect(() => {
    if (isAssigning) return;
    setDraftMemberIds((ids) => {
      const valid = ids.filter((id) => candidates.some((member) => member.id === id));
      return valid.length === ids.length ? ids : valid;
    });
  }, [candidates, isAssigning]);
  const draftMembers = validIds.map((id) => candidates.find((member) => member.id === id)!);
  const shownCount = draftMembers.filter((member) => sceneVisibility?.isShown(member)).length;
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
          selectionMode="multiple" selectedMemberIds={validIds}
          isOpen={isPickerOpen} onOpenChange={onPickerOpenChange}
          onSelectionChange={(ids) => { setDraftMemberIds(ids); setError(""); }} disabled={unavailable || candidates.length === 0}
          title={disabled ? readOnlyMessage : undefined} sceneVisibility={sceneVisibility} />
        <button className="mini-button" type="button" disabled={unavailable || validIds.length === 0}
          title={disabled ? readOnlyMessage : undefined}
          onClick={async (event) => {
            event.stopPropagation();
            if (disabled || pending.current === context || validIds.length === 0) return;
            const startedContext = context;
            pending.current = startedContext;
            setIsAssigning(true);
            setError("");
            try {
              const applied = await onAssignMembers(objectId, validIds);
              if (!mounted.current || currentContext.current !== startedContext) return;
              if (applied) {
                setDraftMemberIds([]);
                onPickerOpenChange(false);
              } else {
                setError("割当を反映できませんでした。内容を確認して、もう一度お試しください。");
              }
            } catch {
              if (mounted.current && currentContext.current === startedContext)
                setError("割当中にエラーが発生しました。もう一度お試しください。");
            } finally {
              if (pending.current === startedContext) pending.current = null;
              if (mounted.current && currentContext.current === startedContext) setIsAssigning(false);
            }
          }}>
          <UserPlus size={15} />{isAssigning ? "割当中…" : `割当（${validIds.length}人）`}
        </button>
      </div>
      {validIds.length > 0 && <p className="assignment-selection-summary">{validIds.length}人を選択中（検索を変えても選択は残ります）</p>}
      {shownCount > 0 && <p className="assignment-shown-notice" role="status">{shownMembersAssignmentNotice(draftMembers, shownCount)}</p>}
      {error && <p className="assignment-shown-notice" role="alert">{error}</p>}
    </div>
  );
};

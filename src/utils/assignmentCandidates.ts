import type { Member } from "../types";

/**
 * A member is "shown" in a scene when the member itself is visible and the
 * scene snapshot does not hide them. Same rule as the stage drawing; pass the
 * resolved snapshot visibility (getSnapshotForFrame), not a raw frame.
 */
export const isMemberShownInScene = (
  member: Pick<Member, "id" | "visible">,
  memberVisibility: Readonly<Record<string, boolean>>,
): boolean => member.visible !== false && memberVisibility[member.id] !== false;

/** Assigning a member to a prop hides them in that scene (see assignMemberToObject). */
export const shownMemberAssignmentNotice = (name: string): string =>
  `${name}さんは表示中です。割り当てると、このシーンでは非表示になります。`;

export const shownMembersAssignmentNotice = (selected: Member[], shownCount: number): string =>
  selected.length === 1 ? shownMemberAssignmentNotice(selected[0].name)
    : shownCount === selected.length ? `選択した${selected.length}人は表示中です。割り当てると、このシーンでは非表示になります。`
    : `選択した${selected.length}人のうち${shownCount}人は表示中です。割り当てると、このシーンでは非表示になります。`;

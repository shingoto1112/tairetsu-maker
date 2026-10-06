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

import type { Member, MemberGroup } from "../types";

export type MemberPickerOrder = "group" | "name";
export type MemberGroupIndex = Map<
  string,
  { group: MemberGroup; groupIndex: number; indexInGroup: number }
>;

export const buildMemberGroupIndex = (
  memberGroups: readonly MemberGroup[],
): MemberGroupIndex => {
  const index: MemberGroupIndex = new Map();
  memberGroups.forEach((group, groupIndex) => {
    group.memberIds.forEach((memberId, indexInGroup) => {
      if (!index.has(memberId)) {
        index.set(memberId, { group, groupIndex, indexInGroup });
      }
    });
  });
  return index;
};

export const sortMembersForPicker = (
  members: readonly Member[],
  order: MemberPickerOrder,
  index: MemberGroupIndex,
): Member[] => {
  const result = [...members];
  if (order === "name") {
    result.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  } else if (order === "group") {
    result.sort((a, b) => {
      const groupA = index.get(a.id);
      const groupB = index.get(b.id);
      if (!groupA) return groupB ? 1 : 0;
      if (!groupB) return -1;
      return (
        groupA.groupIndex - groupB.groupIndex ||
        groupA.indexInGroup - groupB.indexInGroup
      );
    });
  }
  return result;
};

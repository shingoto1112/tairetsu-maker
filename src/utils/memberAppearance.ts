import {
  FormationFrame,
  Member,
  MemberGroup,
  StageSnapshot,
} from "../types";

const DEFAULT_MEMBER_COLOR = "#14b8a6";

export const getMemberGroupColor = (
  memberId: string,
  groups: MemberGroup[] = [],
): string | undefined =>
  groups.find((group) => group.memberIds.includes(memberId))?.color;

export const getMemberDisplayColor = (
  member: Member,
  options: {
    frame?: FormationFrame | null;
    groups?: MemberGroup[];
    snapshot?: StageSnapshot | null;
  } = {},
): string => {
  const overrideColor =
    options.frame?.memberAppearanceOverrides?.[member.id]?.color ??
    options.snapshot?.memberAppearanceOverrides?.[member.id]?.color;
  return (
    overrideColor ??
    getMemberGroupColor(member.id, options.groups) ??
    member.color ??
    DEFAULT_MEMBER_COLOR
  );
};


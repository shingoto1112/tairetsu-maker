import type { FormationFrame } from "../types";

/** Copy only the requested members; objects retain the existing independent reflection policy. */
export const copyParadeGroupState = (
  source: FormationFrame,
  target: FormationFrame,
  memberIds: ReadonlySet<string>,
): Pick<FormationFrame, "positions" | "memberVisibility" | "memberAppearanceOverrides" | "objectAssignments"> => {
  const positions = { ...target.positions };
  const memberVisibility = { ...target.memberVisibility };
  const memberAppearanceOverrides = { ...target.memberAppearanceOverrides };
  for (const id of memberIds) {
    if (source.positions[id]) positions[id] = { ...source.positions[id] };
    else delete positions[id];
    memberVisibility[id] = source.memberVisibility?.[id] !== false;
    if (source.memberAppearanceOverrides?.[id]) {
      memberAppearanceOverrides[id] = { ...source.memberAppearanceOverrides[id] };
    } else delete memberAppearanceOverrides[id];
  }
  const objectAssignments = Object.fromEntries(
    [...new Set([...Object.keys(target.objectAssignments ?? {}), ...Object.keys(source.objectAssignments ?? {})])]
      .map(id => [id, [
        ...(target.objectAssignments?.[id] ?? []).filter(member => !memberIds.has(member)),
        ...(source.objectAssignments?.[id] ?? []).filter(member => memberIds.has(member)),
      ]]),
  );
  return { positions, memberVisibility, memberAppearanceOverrides, objectAssignments };
};

import type { FormationFrame } from "../types";

type AssignmentPatch = Pick<FormationFrame, "objectAssignments" | "memberVisibility" | "positions">;

/** Optimistic application alone is not a cloud acknowledgement. Keep the UI draft on failure. */
export const runSavedAssignmentUpdate = async (
  save: () => Promise<boolean>,
  wasApplied: () => boolean,
): Promise<boolean> => {
  try {
    const saved = await save();
    return saved && wasApplied();
  } catch {
    return false;
  }
};

/** updateProject may reject a change; only acknowledge the exact patch it applied. */
export const confirmAssignmentUpdate = (
  before: FormationFrame | undefined,
  after: FormationFrame | undefined,
  expected: AssignmentPatch | undefined,
  onApplied: () => void,
): boolean => {
  if (!before || !after || before === after || !expected ||
      after.objectAssignments !== expected.objectAssignments ||
      after.memberVisibility !== expected.memberVisibility ||
      after.positions !== expected.positions) return false;
  onApplied();
  return true;
};

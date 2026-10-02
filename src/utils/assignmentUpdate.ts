import type { FormationFrame } from "../types";

type AssignmentPatch = Pick<FormationFrame, "objectAssignments" | "memberVisibility" | "positions">;

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

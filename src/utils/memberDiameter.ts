/** UI limits differ from the retained legacy storage range (0.2–1.0m). */
export const MEMBER_DIAMETER_MIN = 0.5;
export const STORED_MEMBER_DIAMETER_MIN = 0.2;
export const MEMBER_DIAMETER_MAX = 1;
export const MEMBER_DIAMETER_STEP = 0.05;
export const NEW_MEMBER_DIAMETER = 0.75;
export const MEMBER_DIAMETER_PRESETS = [MEMBER_DIAMETER_MIN, NEW_MEMBER_DIAMETER, MEMBER_DIAMETER_MAX] as const;

export type MemberDiameterAction =
  | { type: "select"; value: number }
  | { type: "step"; direction: -1 | 1 };

export const isSelectableMemberDiameter = (value: number): boolean =>
  Number.isFinite(value) && value >= MEMBER_DIAMETER_MIN && value <= MEMBER_DIAMETER_MAX;

/** Only explicit user actions change a value. Legacy values are never normalized here. */
export const applyMemberDiameterAction = (current: number, action: MemberDiameterAction): number => {
  if (action.type === "select") return isSelectableMemberDiameter(action.value) ? action.value : current;
  if (!Number.isFinite(current)) return current;
  if (current < MEMBER_DIAMETER_MIN) return action.direction === 1 ? MEMBER_DIAMETER_MIN : current;
  return Math.min(MEMBER_DIAMETER_MAX, Math.max(MEMBER_DIAMETER_MIN,
    Math.round((current + action.direction * MEMBER_DIAMETER_STEP) * 100) / 100));
};

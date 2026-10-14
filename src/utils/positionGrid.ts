const EPSILON = 1e-9;
const validStep = (step: number, origin: number) => Number.isFinite(step) && step > 0 && Number.isFinite(origin);
const clean = (value: number) => Number(value.toFixed(9));
// Floating subtraction (e.g. 10.28 - 10.13) must not flip an exact midpoint.
// Ties match Math.round: toward increasing internal coordinates on both axes.
const nearestIndex = (value: number) => Math.floor(value + 0.5 + EPSILON);

/** Position lattice, shared by both axes. Dimensions still use zero-based snapToGrid. */
export const snapPosition = (value: number, step: number, origin: number): number =>
  Number.isFinite(value) && validStep(step, origin) ? clean(origin + nearestIndex((value - origin) / step) * step) : value;

export const snapPositionInBounds = (value: number, step: number, origin: number, min: number, max: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min > max) return value;
  const bounded = Math.min(max, Math.max(min, value));
  if (!validStep(step, origin)) return bounded;
  const first = Math.ceil((min - origin) / step - EPSILON);
  const last = Math.floor((max - origin) / step + EPSILON);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last) return bounded;
  const index = Math.min(last, Math.max(first, nearestIndex((value - origin) / step)));
  return clean(origin + index * step);
};

/** Allowed primary position from the intersection of the entire group's movement bounds. */
export const memberGroupAxisBounds = (primary: number, positions: number[], extent: number): [number, number] => [
  primary + Math.max(...positions.map(value => -value)),
  primary + Math.min(...positions.map(value => extent - value)),
];

export const snapMemberGroupAxis = (requested: number, primary: number, positions: number[], extent: number, step: number, origin: number): number =>
  snapPositionInBounds(requested, step, origin, ...memberGroupAxisBounds(primary, positions, extent));

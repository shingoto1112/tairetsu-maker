/** Order-insensitive objects, ordered arrays; absent and undefined agree. */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(k => left[k] !== undefined), other = Object.keys(right).filter(k => right[k] !== undefined);
  return keys.length === other.length && keys.every(k => Object.prototype.hasOwnProperty.call(right, k) && same(left[k], right[k]));
};

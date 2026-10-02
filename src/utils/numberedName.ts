/** Return the first unused name with a positive integer suffix. */
export const nextNumberedName = (
  baseName: string,
  existingNames: Iterable<string>,
  start = 1,
): string => {
  const names = new Set(existingNames);
  let number = Number.isFinite(start) ? Math.max(1, Math.floor(start)) : 1;
  while (names.has(`${baseName}${number}`)) number += 1;
  return `${baseName}${number}`;
};

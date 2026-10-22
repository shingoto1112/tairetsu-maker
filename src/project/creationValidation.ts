/** Creation-only validation. Legacy normalization and input steps stay separate. */
export const creationNumberError = (
  value: number, label: string, min: number, max?: number,
): string | undefined => {
  if (!Number.isFinite(value) || value < min) return `${label}は${min}以上の数値にしてください。`;
  if (max !== undefined && value > max) return `${label}は${max}以下の数値にしてください。`;
  return undefined;
};

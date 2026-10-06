export const PASSWORD_MIN_LENGTH = 6;

export function validatePasswordChange(current: string, next: string, confirmation: string): string | null {
  if (!current) return "現在のパスワードを入力してください。";
  if (next.length < PASSWORD_MIN_LENGTH) return `新しいパスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください。`;
  if (next !== confirmation) return "新しいパスワードが一致していません。";
  if (current === next) return "現在とは異なるパスワードを設定してください。";
  return null;
}

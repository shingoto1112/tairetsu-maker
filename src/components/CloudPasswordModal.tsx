import { FormEvent, useState } from "react";
import { KeyRound, X } from "lucide-react";

export type CloudPasswordChangeResponse = {
  message: string;
  success: boolean;
};

type CloudPasswordModalProps = {
  isBusy: boolean;
  mode: "change" | "recovery";
  onClose: () => void;
  onSubmit: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<CloudPasswordChangeResponse>;
};

const PASSWORD_MIN_LENGTH = 6;

export const CloudPasswordModal = ({
  isBusy,
  mode,
  onClose,
  onSubmit,
}: CloudPasswordModalProps) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = isBusy || isSubmitting;
  const requiresCurrentPassword = mode === "change";

  const close = () => {
    if (!submitting) {
      onClose();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (requiresCurrentPassword && !currentPassword) {
      setError("現在のパスワードを入力してください。");
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`新しいパスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください。`);
      return;
    }
    if (newPassword !== confirmation) {
      setError("新しいパスワードが一致していません。");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onSubmit(currentPassword, newPassword);
      if (result.success) {
        onClose();
        return;
      }
      setError(result.message);
    } catch {
      setError("パスワードを変更できませんでした。通信状態を確認してください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="app-confirm-backdrop cloud-password-backdrop"
      onPointerDown={close}
      role="presentation"
    >
      <form
        aria-label={mode === "recovery" ? "新しいパスワードを設定" : "パスワードを変更"}
        aria-modal="true"
        className="app-confirm-dialog cloud-password-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <header className="cloud-password-dialog__header">
          <div>
            <p className="modal-kicker">クラウド</p>
            <h2>
              <KeyRound aria-hidden="true" size={20} />
              {mode === "recovery" ? "新しいパスワードを設定" : "パスワードを変更"}
            </h2>
          </div>
          <button
            aria-label="閉じる"
            className="share-export-close"
            disabled={submitting}
            onClick={close}
            type="button"
          >
            <X size={20} />
          </button>
        </header>

        {mode === "recovery" && (
          <p>確認メールから本人確認が完了しました。新しいパスワードを設定してください。</p>
        )}

        {requiresCurrentPassword && (
          <label>
            現在のパスワード
            <input
              aria-label="現在のパスワード"
              autoComplete="current-password"
              disabled={submitting}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              value={currentPassword}
            />
          </label>
        )}
        <label>
          新しいパスワード
          <input
            aria-label="新しいパスワード"
            autoComplete="new-password"
            disabled={submitting}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
          <span className="library-cloud-password-hint">
            {PASSWORD_MIN_LENGTH}文字以上
          </span>
        </label>
        <label>
          新しいパスワード（確認）
          <input
            aria-label="新しいパスワード（確認）"
            autoComplete="new-password"
            disabled={submitting}
            onChange={(event) => setConfirmation(event.target.value)}
            type="password"
            value={confirmation}
          />
        </label>

        {error && <p className="dialog-error">{error}</p>}

        <div className="app-confirm-dialog__actions">
          <button
            className="secondary"
            disabled={submitting}
            onClick={close}
            type="button"
          >
            キャンセル
          </button>
          <button className="primary" disabled={submitting} type="submit">
            {submitting ? "変更中..." : "パスワードを変更"}
          </button>
        </div>
      </form>
    </div>
  );
};

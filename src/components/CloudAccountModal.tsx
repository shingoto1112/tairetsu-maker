import { FormEvent, useState } from "react";
import { ShieldAlert, X } from "lucide-react";

export type CloudAccountDeleteResponse = {
  message: string;
  success: boolean;
};

type CloudAccountModalProps = {
  displayName?: string;
  email?: string;
  isBusy: boolean;
  onClose: () => void;
  onDeleteAccount: (password: string) => Promise<CloudAccountDeleteResponse>;
};

const ACCOUNT_DELETE_CONFIRMATION = "削除";

export const CloudAccountModal = ({
  displayName,
  email,
  isBusy,
  onClose,
  onDeleteAccount,
}: CloudAccountModalProps) => {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = isBusy || isSubmitting;
  const canDelete =
    password.length > 0 && confirmation === ACCOUNT_DELETE_CONFIRMATION;

  const close = () => {
    if (!submitting) {
      onClose();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canDelete || submitting) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onDeleteAccount(password);
      if (result.success) {
        onClose();
        return;
      }
      setError(result.message);
    } catch {
      setError("アカウントを削除できませんでした。通信状態を確認してください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="new-formation-backdrop cloud-account-backdrop"
      onPointerDown={close}
      role="presentation"
    >
      <form
        aria-label="クラウドアカウント管理"
        aria-modal="true"
        className="new-formation-dialog cloud-account-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <header>
          <div>
            <p className="modal-kicker">クラウド</p>
            <h2>アカウント管理</h2>
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

        <div className="cloud-account-identity">
          <strong>{displayName || "名前未設定"}</strong>
          {email && <span>{email}</span>}
        </div>

        <section className="cloud-account-danger" aria-labelledby="delete-account-title">
          <div className="cloud-account-danger__heading">
            <ShieldAlert aria-hidden="true" size={20} />
            <h3 id="delete-account-title">アカウントを完全に削除</h3>
          </div>
          <p>
            アカウント、連絡先、参加情報、自分だけが所有するクラウド隊列表を削除します。
            ほかにも所有者がいる隊列表は別の所有者へ引き継がれます。
          </p>
          <p>
            iPadやブラウザに保存したローカル隊列表は削除されません。必要なクラウド隊列表は、
            先に「ローカルへ複製」してください。この操作は元に戻せません。
          </p>
        </section>

        <label>
          現在のパスワード
          <input
            autoComplete="current-password"
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <label>
          確認のため「削除」と入力
          <input
            autoComplete="off"
            disabled={submitting}
            onChange={(event) => setConfirmation(event.target.value)}
            type="text"
            value={confirmation}
          />
        </label>

        {error && <p className="dialog-error">{error}</p>}

        <footer>
          <button
            className="mini-button"
            disabled={submitting}
            onClick={close}
            type="button"
          >
            キャンセル
          </button>
          <button
            className="mini-button danger"
            disabled={!canDelete || submitting}
            type="submit"
          >
            {submitting ? "確認中..." : "アカウントを削除"}
          </button>
        </footer>
      </form>
    </div>
  );
};

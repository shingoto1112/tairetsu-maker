import { FormEvent, useState } from "react";
import { KeyRound, ShieldAlert, X } from "lucide-react";
import {
  CloudPasswordModal,
  type CloudPasswordChangeResponse,
} from "./CloudPasswordModal";

export type CloudAccountDeleteResponse = {
  message: string;
  success: boolean;
};

type CloudAccountModalProps = {
  displayName?: string;
  email?: string;
  isBusy: boolean;
  onClose: () => void;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<CloudPasswordChangeResponse>;
  onDeleteAccount: (password: string) => Promise<CloudAccountDeleteResponse>;
};

export const CloudAccountModal = ({
  displayName,
  email,
  isBusy,
  onClose,
  onChangePassword,
  onDeleteAccount,
}: CloudAccountModalProps) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = isBusy || isSubmitting;
  const canDelete = password.length > 0;

  const close = () => {
    if (!submitting) {
      onClose();
    }
  };

  const requestDelete = (event: FormEvent) => {
    event.preventDefault();
    if (!canDelete || submitting) {
      return;
    }
    setError(null);
    setIsConfirming(true);
  };

  const deleteAccount = async () => {
    if (!canDelete || submitting) {
      return;
    }
    setIsConfirming(false);
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
    <>
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
          onSubmit={requestDelete}
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

          <section className="cloud-account-security">
            <div>
              <h3>
                <KeyRound aria-hidden="true" size={18} />
                パスワード
              </h3>
              <p>現在のパスワードを確認して、新しいパスワードへ変更します。</p>
            </div>
            <button
              className="mini-button"
              disabled={submitting}
              onClick={() => setIsPasswordModalOpen(true)}
              type="button"
            >
              パスワードを変更
            </button>
          </section>

          <section
            className="cloud-account-danger"
            aria-labelledby="delete-account-title"
          >
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

      {isConfirming && (
        <div
          className="app-confirm-backdrop"
          onPointerDown={() => setIsConfirming(false)}
          role="presentation"
        >
          <section
            aria-label="アカウント削除の確認"
            aria-modal="true"
            className="app-confirm-dialog app-confirm-dialog--danger"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2>本当に削除しますか？</h2>
            <p>
              アカウントと対象のクラウドデータは完全に削除され、元に戻せません。
              端末に保存したローカル隊列表は残ります。
            </p>
            <div className="app-confirm-dialog__actions">
              <button
                autoFocus
                className="secondary"
                onClick={() => setIsConfirming(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="danger"
                onClick={() => void deleteAccount()}
                type="button"
              >
                削除する
              </button>
            </div>
          </section>
        </div>
      )}

      {isPasswordModalOpen && (
        <CloudPasswordModal
          isBusy={isBusy}
          mode="change"
          onClose={() => setIsPasswordModalOpen(false)}
          onSubmit={onChangePassword}
        />
      )}
    </>
  );
};

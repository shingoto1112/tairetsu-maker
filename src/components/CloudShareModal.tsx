import { FormEvent, useMemo, useState } from "react";
import { Copy, RefreshCw, Trash2, X } from "lucide-react";
import type { CloudCollaborationItem } from "../cloud";

type CloudShareModalProps = {
  currentUserId?: string;
  items: CloudCollaborationItem[];
  isBusy: boolean;
  onClose: () => void;
  onCreateInvite: (
    email: string,
    role: "editor" | "viewer",
  ) => Promise<string | null>;
  onRefresh: () => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  onUpdateRole: (
    userId: string,
    role: "editor" | "owner" | "viewer",
  ) => Promise<void>;
  projectTitle: string;
};

const roleLabel = (role: "editor" | "owner" | "viewer"): string => {
  if (role === "owner") return "owner";
  if (role === "editor") return "編集";
  return "閲覧";
};

const inviteStatusLabel = (item: CloudCollaborationItem): string => {
  if (item.acceptedAt) return "参加済み";
  if (item.revokedAt) return "取り消し済み";
  if (item.expiresAt && new Date(item.expiresAt).getTime() < Date.now()) {
    return "期限切れ";
  }
  return "招待中";
};

export const CloudShareModal = ({
  currentUserId,
  items,
  isBusy,
  onClose,
  onCreateInvite,
  onRefresh,
  onRemoveMember,
  onRevokeInvite,
  onUpdateRole,
  projectTitle,
}: CloudShareModalProps) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeInvites = useMemo(
    () =>
      items.filter(
        (item) =>
          item.type === "invite" &&
          !item.acceptedAt &&
          !item.revokedAt &&
          (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()),
      ),
    [items],
  );
  const members = items.filter((item) => item.type === "member");

  const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const inviteLink = await onCreateInvite(email.trim(), role);
    if (!inviteLink) {
      return;
    }
    setLastInviteLink(inviteLink);
    setMessage("招待リンクを作成しました。相手に共有してください。");
    setEmail("");
  };

  const copyInviteLink = async () => {
    if (!lastInviteLink) {
      return;
    }
    await navigator.clipboard.writeText(lastInviteLink);
    setMessage("招待リンクをコピーしました。");
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-modal="true"
        className="cloud-share-modal"
        role="dialog"
        aria-label="クラウド共有管理"
      >
        <header className="modal-header">
          <div>
            <p className="modal-kicker">クラウド共有</p>
            <h2>{projectTitle || "名称未設定"}</h2>
          </div>
          <button
            aria-label="閉じる"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="cloud-share-invite" onSubmit={submitInvite}>
          <label>
            招待するメールアドレス
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="member@example.com"
            />
          </label>
          <label>
            権限
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value === "viewer" ? "viewer" : "editor")
              }
            >
              <option value="editor">編集</option>
              <option value="viewer">閲覧</option>
            </select>
          </label>
          <button className="mini-button primary" disabled={isBusy} type="submit">
            招待リンク作成
          </button>
        </form>

        {lastInviteLink && (
          <div className="cloud-share-link">
            <input readOnly value={lastInviteLink} aria-label="招待リンク" />
            <button
              className="mini-button"
              onClick={() => void copyInviteLink()}
              type="button"
            >
              <Copy size={14} />
              コピー
            </button>
          </div>
        )}

        {message && <p className="library-cloud-message">{message}</p>}

        <div className="cloud-share-section">
          <div className="cloud-share-section__header">
            <h3>参加者</h3>
            <button
              className="mini-button"
              disabled={isBusy}
              onClick={() => void onRefresh()}
              type="button"
            >
              <RefreshCw size={14} />
              更新
            </button>
          </div>
          <div className="cloud-share-list">
            {members.map((item) => (
              <div className="cloud-share-row" key={item.id}>
                <div>
                  <strong>{item.email || item.userId || "参加者"}</strong>
                  <span>{roleLabel(item.role)}</span>
                </div>
                <div className="cloud-share-row__actions">
                  {item.userId && (
                    <select
                      value={item.role}
                      disabled={isBusy}
                      onChange={(event) =>
                        void onUpdateRole(
                          item.userId ?? "",
                          event.target.value as "editor" | "owner" | "viewer",
                        )
                      }
                    >
                      <option value="owner">owner</option>
                      <option value="editor">編集</option>
                      <option value="viewer">閲覧</option>
                    </select>
                  )}
                  {item.userId && item.userId !== currentUserId && (
                    <button
                      aria-label="参加者を削除"
                      className="mini-button danger"
                      disabled={isBusy}
                      onClick={() => void onRemoveMember(item.userId ?? "")}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <p className="library-cloud-message">参加者が取得できませんでした。</p>
            )}
          </div>
        </div>

        <div className="cloud-share-section">
          <h3>未参加の招待</h3>
          <div className="cloud-share-list">
            {activeInvites.map((item) => (
              <div className="cloud-share-row" key={item.id}>
                <div>
                  <strong>{item.email || "招待"}</strong>
                  <span>
                    {roleLabel(item.role)} / {inviteStatusLabel(item)}
                  </span>
                </div>
                <button
                  className="mini-button"
                  disabled={isBusy}
                  onClick={() => void onRevokeInvite(item.id)}
                  type="button"
                >
                  取り消し
                </button>
              </div>
            ))}
            {activeInvites.length === 0 && (
              <p className="library-cloud-message">有効な招待はありません。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

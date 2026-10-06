import { useRef, useState } from "react";
import type { CollaborationUiService } from "../collaboration/uiService";
import { PASSWORD_MIN_LENGTH, validatePasswordChange } from "../cloud/password";

/** Mounted inside the existing dialog; credentials never enter shared UI state. */
export default function CollaborationPasswordForm({ service, busy, cancel }: {
  service: CollaborationUiService; busy: boolean; cancel: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  return <form noValidate onSubmit={event => {
    event.preventDefault();
    if (busy || submitting.current) return;
    const validation = validatePasswordChange(current, next, confirmation);
    setError(validation); if (validation) return;
    submitting.current = true;
    void service.run(async () => {
      try { await service.changePassword(current, next, confirmation); }
      finally { setCurrent(""); setNext(""); setConfirmation(""); submitting.current = false; }
    });
  }}>
    <h3>パスワードを変更</h3>
    {error && <p className="collab-error" role="alert">{error}</p>}
    <label>現在のパスワード<input type="password" autoComplete="current-password" value={current} disabled={busy} onChange={event => setCurrent(event.target.value)} /></label>
    <label>新しいパスワード<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={next} disabled={busy} onChange={event => setNext(event.target.value)} /></label>
    <label>新しいパスワード（確認）<input type="password" autoComplete="new-password" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
    <p className="collab-muted">新しいパスワードは{PASSWORD_MIN_LENGTH}文字以上で、現在とは異なるものを設定してください。</p>
    <div className="collab-actions"><button className="collab-primary" type="submit" disabled={busy}>パスワードを変更する</button>
      <button type="button" disabled={busy} onClick={cancel}>取消</button></div>
  </form>;
}

import { useEffect, useRef, useState } from "react";

export default function InvitationLinkTools({ link, disabled, label, share }: {
  link: string; disabled: boolean; label: string; share?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef(0);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { attempt.current++; setCopied(false); setNotice(""); return () => { attempt.current++; }; }, [link]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    const current = ++attempt.current;
    setCopied(false); setNotice("");
    try {
      await navigator.clipboard.writeText(link); // No initialization await before this call.
      if (current !== attempt.current) return;
      setCopied(true); setNotice("リンクをコピーしました。");
    } catch {
      if (current !== attempt.current) return;
      input.current?.focus(); input.current?.select();
      setNotice("コピーできませんでした。入力欄のリンクを選択してコピーしてください（iPad は長押し、PC は Ctrl+C）。");
    }
  };
  return <div className="collab-issued">
    <label>{label}<input ref={input} aria-label={label} readOnly value={link} /></label>
    <div className="collab-actions">
      <button type="button" disabled={disabled} onClick={() => void copy()}>{copied ? "コピーしました ✓" : "リンクをコピー"}</button>
      {share && <button type="button" disabled={disabled} onClick={share}>共有シートを開く</button>}
    </div>
    <p role="status">{notice}</p>
  </div>;
}

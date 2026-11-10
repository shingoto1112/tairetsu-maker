import { ArchiveRestore, CircleHelp, FileText, HardDrive, LifeBuoy, MoreHorizontal, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PUBLIC_LINKS } from "../config/publicLinks";

export type LibraryHeaderAccount = { label: "アカウント" | "ログイン"; pending: boolean; onClick: () => void };

type Props = {
  onOpenHelp?: () => void;
  account?: LibraryHeaderAccount;
  onOpenStorageManager?: () => void;
  onRefreshCloud?: () => void;
  cloudBusy?: boolean;
  /** On-device draft rescue after old cloud import ended on 2026-11-04. */
  onOpenLegacyImport?: () => void;
};

/**
 * Home header that stays at the top while the list scrolls: 使い方, account and a
 * "…" popover (保存データの管理, cloud refresh, policies). The popover holds plain
 * buttons and links, so it is not a role="menu"; Escape and outside taps close it
 * and focus returns to the trigger.
 */
export const LibraryHeader = ({ onOpenHelp, account, onOpenStorageManager, onRefreshCloud, cloudBusy = false, onOpenLegacyImport }: Props) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (action: () => void) => { setOpen(false); triggerRef.current?.focus(); action(); };
  return <header className="library-header">
    <div className="library-header__title">
      <p className="library-kicker">隊列表作成アプリ</p>
      <h1>隊列メーカー</h1>
    </div>
    <div className="library-header__actions">
      {onOpenHelp && <button type="button" className="library-header-button" onClick={onOpenHelp}>
        <CircleHelp size={17} aria-hidden="true" />使い方
      </button>}
      {account && <button type="button" className="library-header-button" onClick={account.onClick}
        disabled={account.pending} aria-busy={account.pending || undefined}
        title={account.pending ? "ログイン情報を確認しています" : undefined}>
        <UserRound size={17} aria-hidden="true" />{account.label}
      </button>}
      <div className="library-more" ref={rootRef}>
        <button ref={triggerRef} type="button" className="library-header-button library-header-button--icon"
          aria-label="ホームのその他の操作" aria-expanded={open} aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}>
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
        {open && <div className="library-more__panel" id={panelId}>
          {onOpenStorageManager && <button type="button" onClick={() => choose(onOpenStorageManager)}>
            <HardDrive size={16} aria-hidden="true" />保存データの管理
          </button>}
          {onRefreshCloud && <button type="button" disabled={cloudBusy} onClick={() => choose(onRefreshCloud)}>
            <RefreshCw size={16} aria-hidden="true" />クラウドの一覧を更新
          </button>}
          {onOpenLegacyImport && <button type="button" onClick={() => choose(onOpenLegacyImport)}>
            <ArchiveRestore size={16} aria-hidden="true" />旧クラウドの下書きを救出
          </button>}
          <a href={PUBLIC_LINKS.privacy} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <ShieldCheck size={16} aria-hidden="true" />プライバシー
          </a>
          <a href={PUBLIC_LINKS.terms} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <FileText size={16} aria-hidden="true" />利用規約
          </a>
          <a href={PUBLIC_LINKS.support} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <LifeBuoy size={16} aria-hidden="true" />サポート
          </a>
        </div>}
      </div>
    </div>
  </header>;
};

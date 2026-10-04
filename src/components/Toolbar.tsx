import {
  ExternalLink,
  FileText,
  Home,
  LifeBuoy,
  Menu,
  Save,
  Share,
  ShieldCheck,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PUBLIC_LINKS } from "../config/publicLinks";

type ToolbarProps = {
  title: string;
  canEditProject?: boolean;
  canOpenRosterManager?: boolean;
  canEditScene?: boolean;
  canSaveProject?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  localSaveOnly?: boolean;
  collaborationStatus?: ReactNode;
  projectReadOnlyMessage?: string;
  readOnlyMessage?: string;
  sceneReadOnlyMessage?: string;
  onTitleChange: (title: string) => void;
  onBackToLibrary: () => void;
  onSaveProject: () => void;
  onOpenShareExport: () => void;
  onOpenRosterManager: () => void;
};

type AppMenuItemProps = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
};

type AppMenuLinkProps = {
  href: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

const AppMenuItem = ({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
}: AppMenuItemProps) => (
  <button
    className="app-menu-item"
    onClick={onClick}
    disabled={disabled}
    title={title}
    type="button"
  >
    <span className="app-menu-item__icon" aria-hidden="true">
      <Icon size={17} />
    </span>
    <span className="app-menu-item__label">{label}</span>
  </button>
);

const AppMenuLink = ({
  href,
  icon: Icon,
  label,
  onClick,
}: AppMenuLinkProps) => (
  <a
    className="app-menu-link"
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    onClick={onClick}
    aria-label={`${label}（新しいタブで開く）`}
  >
    <span className="app-menu-item__icon" aria-hidden="true">
      <Icon size={16} />
    </span>
    <span className="app-menu-item__label">{label}</span>
    <ExternalLink className="app-menu-link__external" size={14} aria-hidden="true" />
  </a>
);

export const Toolbar = ({
  title,
  canEditProject = true,
  canOpenRosterManager = true,
  canEditScene = true,
  canSaveProject = true,
  isDirty = false,
  isSaving = false,
  localSaveOnly = false,
  collaborationStatus,
  projectReadOnlyMessage,
  readOnlyMessage,
  sceneReadOnlyMessage,
  onTitleChange,
  onBackToLibrary,
  onSaveProject,
  onOpenShareExport,
  onOpenRosterManager,
}: ToolbarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const projectEditMessage =
    projectReadOnlyMessage ??
    readOnlyMessage ??
    "クラウドプロジェクトの全体設定は初期実装では編集できません。";
  const sceneEditMessage =
    sceneReadOnlyMessage ??
    readOnlyMessage ??
    "編集するには、このシーンの編集ロックを取得してください。";
  const saveDisabled = isSaving || !canSaveProject;
  const saveTitle = canSaveProject
    ? localSaveOnly ? "この端末に保存" : isDirty
      ? "変更を保存"
      : "隊列表を保存"
    : sceneEditMessage;

  const closeMenuAndReturnFocus = () => {
    setMenuOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const focusTimeoutId = window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(".app-menu-popover button:not(:disabled)")
        ?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenuAndReturnFocus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimeoutId);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <header className={`toolbar${menuOpen ? " toolbar--menu-open" : ""}`}>
      <div className="toolbar__brand">
        <div className="app-menu" ref={menuRef}>
          <button
            ref={menuButtonRef}
            className="toolbar-menu-button"
            onClick={() => setMenuOpen((previous) => !previous)}
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label="メニューを開く"
          >
            <Menu size={22} />
          </button>
          {menuOpen && (
            <>
              <div
                className="app-menu-backdrop"
                aria-hidden="true"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={closeMenuAndReturnFocus}
              />
              <div id={menuId} className="app-menu-popover" aria-label="メニュー">
                <section className="app-menu-section">
                  <h3>よく使う</h3>
                  <AppMenuItem
                    icon={Table2}
                    label="メンバー/道具の管理"
                    onClick={() => runMenuAction(onOpenRosterManager)}
                    disabled={!canOpenRosterManager}
                    title={!canOpenRosterManager ? "名簿の編集はownerのみ可能です。" : undefined}
                  />
                  <AppMenuItem
                    icon={Save}
                    label={localSaveOnly ? "この端末に保存" : "隊列表を保存"}
                    onClick={() => runMenuAction(onSaveProject)}
                    disabled={saveDisabled}
                    title={saveTitle}
                  />
                  <AppMenuItem
                    icon={Share}
                    label="共有と書き出し"
                    onClick={() => runMenuAction(onOpenShareExport)}
                  />
                </section>

                <section className="app-menu-section app-menu-section--footer">
                  <h3>情報・サポート</h3>
                  <AppMenuLink
                    href={PUBLIC_LINKS.privacy}
                    icon={ShieldCheck}
                    label="プライバシー"
                    onClick={() => setMenuOpen(false)}
                  />
                  <AppMenuLink
                    href={PUBLIC_LINKS.terms}
                    icon={FileText}
                    label="利用規約"
                    onClick={() => setMenuOpen(false)}
                  />
                  <AppMenuLink
                    href={PUBLIC_LINKS.support}
                    icon={LifeBuoy}
                    label="サポート"
                    onClick={() => setMenuOpen(false)}
                  />
                </section>
              </div>
            </>
          )}
        </div>

        <button
          className="mini-button toolbar-label-button"
          onClick={onBackToLibrary}
          type="button"
          title="隊列一覧へ戻る"
          aria-label="隊列一覧へ戻る"
        >
          <Home size={15} aria-hidden="true" />ホーム
        </button>
        <button
          className={`mini-button toolbar-save-button${isDirty ? " is-dirty" : ""}`}
          onClick={onSaveProject}
          type="button"
          disabled={saveDisabled}
          title={saveTitle}
        >
          <Save size={15} />
          {isSaving ? "保存中" : localSaveOnly ? "この端末に保存" : "保存"}
        </button>
        <button
          className="mini-button toolbar-label-button"
          onClick={onOpenShareExport}
          type="button"
          title="共有と書き出し"
          aria-label="共有と書き出し"
        >
          <Share size={15} aria-hidden="true" />共有
        </button>
        <span className="toolbar__logo">隊列メーカー</span>
        <input
          className="toolbar__title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          disabled={!canEditProject}
          title={!canEditProject ? projectEditMessage : undefined}
          aria-label="隊列表名"
        />
        {collaborationStatus}
      </div>
    </header>
  );
};

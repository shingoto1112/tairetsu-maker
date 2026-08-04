import {
  Menu,
  PanelsTopLeft,
  Save,
  Share2,
  Table2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ToolbarProps = {
  title: string;
  canEditProject?: boolean;
  canEditScene?: boolean;
  canSaveProject?: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  projectReadOnlyMessage?: string;
  readOnlyMessage?: string;
  sceneReadOnlyMessage?: string;
  onTitleChange: (title: string) => void;
  onBackToLibrary: () => void;
  onSaveProject: () => void;
  onOpenShareExport: () => void;
  onClearSelection: () => void;
  onCreateGroup: () => void;
  onMirrorSelection: () => void;
  onOpenMemberTools: () => void;
  onOpenRosterManager: () => void;
};

export const Toolbar = ({
  title,
  canEditProject = true,
  canEditScene = true,
  canSaveProject = true,
  isDirty = false,
  isSaving = false,
  projectReadOnlyMessage,
  readOnlyMessage,
  sceneReadOnlyMessage,
  onTitleChange,
  onBackToLibrary,
  onSaveProject,
  onOpenShareExport,
  onClearSelection,
  onCreateGroup,
  onMirrorSelection,
  onOpenMemberTools,
  onOpenRosterManager,
}: ToolbarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
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
    ? isDirty
      ? "変更を保存"
      : "隊列表を保存"
    : sceneEditMessage;

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <div className="app-menu" ref={menuRef}>
          <button
            className="toolbar-menu-button"
            onClick={() => setMenuOpen((previous) => !previous)}
            type="button"
            aria-expanded={menuOpen}
            aria-label="メニューを開く"
          >
            <Menu size={22} />
          </button>
          {menuOpen && (
            <div className="app-menu-popover" role="menu">
              <section className="menu-section">
                <h3>管理</h3>
                <button
                  onClick={() => runMenuAction(onOpenRosterManager)}
                  disabled={!canEditProject}
                  title={!canEditProject ? projectEditMessage : undefined}
                  type="button"
                >
                  <Table2 size={16} />
                  メンバー/道具の管理
                </button>
              </section>

              <section className="menu-section">
                <h3>ファイル</h3>
                <button
                  onClick={() => runMenuAction(onSaveProject)}
                  disabled={saveDisabled}
                  title={saveTitle}
                  type="button"
                >
                  <Save size={16} />
                  隊列表を保存
                </button>
              </section>

              <section className="menu-section">
                <h3>共有・出力</h3>
                <button
                  onClick={() => runMenuAction(onOpenShareExport)}
                  type="button"
                >
                  <Share2 size={16} />
                  共有と書き出し
                </button>
              </section>

              <section className="menu-section">
                <h3>編集補助</h3>
                <button onClick={() => runMenuAction(onClearSelection)} type="button">
                  選択解除
                </button>
                <button
                  onClick={() => runMenuAction(onMirrorSelection)}
                  disabled={!canEditScene}
                  title={!canEditScene ? sceneEditMessage : undefined}
                  type="button"
                >
                  左右反転
                </button>
                <button
                  onClick={() => runMenuAction(onCreateGroup)}
                  disabled={!canEditProject}
                  title={!canEditProject ? projectEditMessage : undefined}
                  type="button"
                >
                  グループ作成
                </button>
                <button
                  onClick={() => runMenuAction(onOpenMemberTools)}
                  disabled={!canEditScene}
                  title={!canEditScene ? sceneEditMessage : undefined}
                  type="button"
                >
                  隊列テンプレート
                </button>
              </section>
            </div>
          )}
        </div>

        <button
          className="mini-button"
          onClick={onBackToLibrary}
          type="button"
          title="隊列一覧へ戻る"
        >
          <PanelsTopLeft size={15} />
          一覧
        </button>
        <button
          className={`mini-button toolbar-save-button${isDirty ? " is-dirty" : ""}`}
          onClick={onSaveProject}
          type="button"
          disabled={saveDisabled}
          title={saveTitle}
        >
          <Save size={15} />
          {isSaving ? "保存中" : "保存"}
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
      </div>

    </header>
  );
};

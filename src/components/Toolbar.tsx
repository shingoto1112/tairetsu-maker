import {
  Eye,
  Grid3X3,
  Menu,
  PanelsTopLeft,
  Save,
  Share2,
  Table2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ToolbarProps = {
  title: string;
  showGrid: boolean;
  showCenterLine: boolean;
  showCenterMarker: boolean;
  showMeterRulers: boolean;
  focusMode: boolean;
  showSnapGuides: boolean;
  snapToGuides: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  onTitleChange: (title: string) => void;
  onBackToLibrary: () => void;
  onSaveProject: () => void;
  onOpenShareExport: () => void;
  onToggleGrid: () => void;
  onToggleCenterLine: () => void;
  onToggleCenterMarker: () => void;
  onToggleMeterRulers: () => void;
  onToggleFocusMode: () => void;
  onToggleSnapGuides: () => void;
  onToggleSnapToGuides: () => void;
  onClearSelection: () => void;
  onCreateGroup: () => void;
  onMirrorSelection: () => void;
  onOpenMemberTools: () => void;
  onOpenRosterManager: () => void;
};

export const Toolbar = ({
  title,
  showGrid,
  showCenterLine,
  showCenterMarker,
  showMeterRulers,
  focusMode,
  showSnapGuides,
  snapToGuides,
  isDirty = false,
  isSaving = false,
  onTitleChange,
  onBackToLibrary,
  onSaveProject,
  onOpenShareExport,
  onToggleGrid,
  onToggleCenterLine,
  onToggleCenterMarker,
  onToggleMeterRulers,
  onToggleFocusMode,
  onToggleSnapGuides,
  onToggleSnapToGuides,
  onClearSelection,
  onCreateGroup,
  onMirrorSelection,
  onOpenMemberTools,
  onOpenRosterManager,
}: ToolbarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
                  type="button"
                >
                  <Table2 size={16} />
                  メンバー/道具の管理
                </button>
              </section>

              <section className="menu-section">
                <h3>ファイル</h3>
                <button onClick={() => runMenuAction(onSaveProject)} type="button">
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
                <h3>表示設定</h3>
                <button onClick={() => runMenuAction(onToggleGrid)} type="button">
                  <Grid3X3 size={16} />
                  グリッド{showGrid ? "OFF" : "ON"}
                </button>
                <button
                  onClick={() => runMenuAction(onToggleCenterLine)}
                  type="button"
                >
                  <Eye size={16} />
                  中央線{showCenterLine ? "OFF" : "ON"}
                </button>
                <button
                  onClick={() => runMenuAction(onToggleCenterMarker)}
                  type="button"
                >
                  センターマーカー{showCenterMarker ? "OFF" : "ON"}
                </button>
                <button
                  onClick={() => runMenuAction(onToggleMeterRulers)}
                  type="button"
                >
                  メートル目盛り{showMeterRulers ? "OFF" : "ON"}
                </button>
                <button
                  onClick={() => runMenuAction(onToggleFocusMode)}
                  type="button"
                >
                  推しカメ{focusMode ? "OFF" : "ON"}
                </button>
                <button
                  onClick={() => runMenuAction(onToggleSnapGuides)}
                  type="button"
                >
                  ガイド線{showSnapGuides ? "OFF" : "ON"}
                </button>
                <button
                  onClick={() => runMenuAction(onToggleSnapToGuides)}
                  type="button"
                >
                  ガイド吸着{snapToGuides ? "OFF" : "ON"}
                </button>
              </section>

              <section className="menu-section">
                <h3>編集補助</h3>
                <button onClick={() => runMenuAction(onClearSelection)} type="button">
                  選択解除
                </button>
                <button onClick={() => runMenuAction(onMirrorSelection)} type="button">
                  左右反転
                </button>
                <button onClick={() => runMenuAction(onCreateGroup)} type="button">
                  グループ作成
                </button>
                <button
                  onClick={() => runMenuAction(onOpenMemberTools)}
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
          disabled={isSaving}
          title={isDirty ? "変更を保存" : "隊列表を保存"}
        >
          <Save size={15} />
          {isSaving ? "保存中" : "保存"}
        </button>
        <span className="toolbar__logo">隊列メーカー</span>
        <input
          className="toolbar__title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          aria-label="隊列表名"
        />
      </div>

    </header>
  );
};

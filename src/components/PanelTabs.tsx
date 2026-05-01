import {
  Box,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ListTodo,
  Music,
  Ruler,
  SlidersHorizontal,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ReactNode } from "react";

export type PanelTabId =
  | "members"
  | "objects"
  | "assignments"
  | "audio"
  | "timeline"
  | "notes"
  | "stage"
  | "animation";

type PanelTab = {
  id: PanelTabId;
  label: string;
  icon: LucideIcon;
};

type PanelTabsProps = {
  activeTab: PanelTabId;
  isOpen: boolean;
  children: ReactNode;
  onChange: (tab: PanelTabId) => void;
  onToggleOpen: () => void;
};

const tabs: PanelTab[] = [
  { id: "timeline", label: "シーン", icon: ListTodo },
  { id: "members", label: "メンバー", icon: Users },
  { id: "objects", label: "道具", icon: Box },
  { id: "assignments", label: "割当", icon: ClipboardList },
  { id: "audio", label: "音源", icon: Music },
  { id: "notes", label: "メモ", icon: StickyNote },
  { id: "stage", label: "ステージ", icon: Ruler },
  { id: "animation", label: "詳細", icon: SlidersHorizontal },
];

export const PanelTabs = ({
  activeTab,
  isOpen,
  children,
  onChange,
  onToggleOpen,
}: PanelTabsProps) => (
  <aside className={isOpen ? "tab-panel" : "tab-panel is-collapsed"}>
    <div className="panel-tabs" role="tablist" aria-label="編集パネル">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            className={tab.id === activeTab ? "panel-tab is-active" : "panel-tab"}
            onClick={() => {
              onChange(tab.id);
              if (!isOpen) onToggleOpen();
            }}
            role="tab"
            aria-selected={tab.id === activeTab}
            type="button"
          >
            <Icon size={18} />
            <span>{tab.label}</span>
          </button>
        );
      })}
      <button
        className="panel-collapse-button"
        onClick={onToggleOpen}
        type="button"
        title={isOpen ? "パネルを閉じる" : "パネルを開く"}
      >
        {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </div>
    {isOpen && <div className="tab-panel__content">{children}</div>}
  </aside>
);

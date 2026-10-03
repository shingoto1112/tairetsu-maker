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
import { ReactNode, useLayoutEffect, useRef } from "react";

import { usePortraitPanelHeight } from "../hooks/usePortraitPanelHeight";
import { PanelResizeHandle } from "./PanelResizeHandle";

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
  portrait?: boolean;
  keyboardOpen?: boolean;
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
  portrait = false,
  keyboardOpen = false,
  activeTab,
  isOpen,
  children,
  onChange,
  onToggleOpen,
}: PanelTabsProps) => {
  const panelRef = useRef<HTMLElement>(null);
  const heightControl = usePortraitPanelHeight(panelRef, portrait, keyboardOpen);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Partial<Record<PanelTabId, number>>>({});

  const rememberScrollPosition = () => {
    const content = contentRef.current;
    if (!content) return;
    scrollPositionsRef.current[activeTab] = content.scrollTop;
  };

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content) content.scrollTop = scrollPositionsRef.current[activeTab] ?? 0;
  }, [activeTab, isOpen]);

  return (
    <aside ref={panelRef} className={isOpen ? "tab-panel" : "tab-panel is-collapsed"}>
      <div className="panel-tabs-header">
        {portrait && <PanelResizeHandle control={heightControl} />}
        <div className="panel-tabs" role="tablist" aria-label="編集パネル">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={tab.id === activeTab ? "panel-tab is-active" : "panel-tab"}
              onClick={() => {
                rememberScrollPosition();
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
        </div>
        <button
          className="panel-collapse-button"
          onClick={() => {
            rememberScrollPosition();
            onToggleOpen();
          }}
          aria-expanded={isOpen}
          type="button"
          title={isOpen ? "編集パネルを閉じる" : "編集パネルを開く"}
          aria-label={isOpen ? "編集パネルを閉じる" : "編集パネルを開く"}
        >
          {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          <span className="panel-collapse-label">
            {isOpen ? "編集を閉じる" : "編集を開く"}
          </span>
        </button>
      </div>
      {isOpen && (
        <div
          className="tab-panel__content"
          ref={contentRef}
          onScroll={rememberScrollPosition}
        >
          {children}
        </div>
      )}
    </aside>
  );
};

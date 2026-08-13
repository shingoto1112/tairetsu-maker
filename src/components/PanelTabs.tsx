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
}: PanelTabsProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Partial<Record<PanelTabId, number>>>({});

  const updateScrollPresentation = () => {
    const content = contentRef.current;
    if (!content) return;

    const maxScrollLeft = Math.max(0, content.scrollWidth - content.clientWidth);
    content.classList.toggle("has-scroll-before", content.scrollLeft > 6);
    content.classList.toggle(
      "has-scroll-after",
      content.scrollLeft < maxScrollLeft - 6,
    );

    const cards = Array.from(
      content.querySelectorAll<HTMLElement>(
        ":scope > .panel-section > *, :scope > .assignment-tab > *, :scope > .details-panel > *, :scope > .timeline > *",
      ),
    ).filter((card) => card.offsetParent !== null);
    const contentLeft = content.getBoundingClientRect().left + 12;
    cards.forEach((card) => {
      card.classList.remove("is-current-portrait-card");
    });
    const nearestCard = cards.reduce<HTMLElement | null>((nearest, card) => {
      if (!nearest) return card;
      const nearestDistance = Math.abs(
        nearest.getBoundingClientRect().left - contentLeft,
      );
      const cardDistance = Math.abs(
        card.getBoundingClientRect().left - contentLeft,
      );
      return cardDistance < nearestDistance ? card : nearest;
    }, null);
    nearestCard?.classList.add("is-current-portrait-card");
  };

  const rememberScrollPosition = () => {
    const content = contentRef.current;
    if (!content) return;
    scrollPositionsRef.current[activeTab] = content.scrollLeft;
    updateScrollPresentation();
  };

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const frame = window.requestAnimationFrame(() => {
      content.scrollLeft = scrollPositionsRef.current[activeTab] ?? 0;
      updateScrollPresentation();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, isOpen]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateScrollPresentation);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(content);
    Array.from(content.children).forEach((child) => observer.observe(child));
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [activeTab, isOpen]);

  return (
    <aside className={isOpen ? "tab-panel" : "tab-panel is-collapsed"}>
      <div className="panel-tabs" role="tablist" aria-label="編集パネル">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={tab.id === activeTab ? "panel-tab is-active" : "panel-tab"}
              onClick={() => {
                if (contentRef.current) {
                  scrollPositionsRef.current[activeTab] = contentRef.current.scrollLeft;
                }
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

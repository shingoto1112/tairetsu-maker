import { ReactNode, RefObject, useEffect, useRef } from "react";

type PanelStickyHeaderProps = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

/** Publishes the header height to the scrolling panel so scrollIntoView targets land below it. */
const useStickyHeightOnPanel = (headerRef: RefObject<HTMLDivElement | null>) => {
  useEffect(() => {
    const header = headerRef.current;
    const panel = header?.closest<HTMLElement>(".tab-panel__content");
    if (!header || !panel || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const sticky = getComputedStyle(header).position === "sticky";
      // Sticky offsets start at the panel's content box; pull the header up by the panel padding
      // (12px on iPad, 14px on web) so scrolled content cannot show through above it.
      const padding = Number.parseFloat(getComputedStyle(panel).paddingTop) || 0;
      header.style.top = sticky ? `${-padding}px` : "";
      panel.style.setProperty("--panel-sticky-height", sticky ? `${header.offsetHeight}px` : "0px");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      panel.style.removeProperty("--panel-sticky-height");
    };
  }, [headerRef]);
};

export const PanelStickyHeader = ({
  title,
  meta,
  actions,
  children,
}: PanelStickyHeaderProps) => {
  const headerRef = useRef<HTMLDivElement | null>(null);
  useStickyHeightOnPanel(headerRef);
  return (
    <div className="panel-sticky-header" ref={headerRef}>
      <div className="panel-sticky-title">
        <h2>{title}</h2>
        {meta && <div className="panel-sticky-meta">{meta}</div>}
      </div>
      {actions && <div className="panel-sticky-actions">{actions}</div>}
      {children}
    </div>
  );
};

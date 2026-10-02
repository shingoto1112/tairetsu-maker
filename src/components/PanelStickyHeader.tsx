import { ReactNode } from "react";

type PanelStickyHeaderProps = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export const PanelStickyHeader = ({
  title,
  meta,
  actions,
  children,
}: PanelStickyHeaderProps) => (
  <div className="panel-sticky-header">
    <div className="panel-sticky-title">
      <h2>{title}</h2>
      {meta && <div className="panel-sticky-meta">{meta}</div>}
    </div>
    {actions && <div className="panel-sticky-actions">{actions}</div>}
    {children}
  </div>
);

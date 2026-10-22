import type { ReactNode, RefObject, CompositionEventHandler } from "react";

type Props = {
  headerRef: RefObject<HTMLDivElement>;
  title: string; visibleCount: number; hiddenCount: number;
  query: string; onQuery: (query: string) => void;
  onCompositionStart: CompositionEventHandler<HTMLInputElement>;
  onCompositionEnd: CompositionEventHandler<HTMLInputElement>;
  actions?: ReactNode;
  onAll: (visible: boolean) => void; disabled?: boolean; low: boolean;
};

export const PortraitPanelHeader = (props: Props) => <div ref={props.headerRef}
  className={`portrait-panel-header ${props.low ? "is-low" : ""}`}>
    <h2><span>{props.title}</span>{" "}<small>表示 {props.visibleCount}・非表示 {props.hiddenCount}</small></h2>
    <input className="portrait-panel-header__search" type="search" aria-label={`${props.title}名を検索`}
      placeholder="名前を検索" value={props.query} onChange={(event) => props.onQuery(event.target.value)}
      onCompositionStart={props.onCompositionStart} onCompositionEnd={props.onCompositionEnd} />
  <div className="portrait-panel-header__bulk">
    <button type="button" className="mini-button" disabled={props.disabled} onClick={() => props.onAll(true)}>すべて表示</button>
    <button type="button" className="mini-button" disabled={props.disabled} onClick={() => props.onAll(false)}>すべて非表示</button>
  </div>
  <div className="portrait-panel-header__actions">{props.actions}</div>
</div>;

export const PortraitManagementTarget = ({ value, onChange }: {
  value: "visible" | "hidden"; onChange: (tab: "visible" | "hidden") => void;
}) => <div className="portrait-management-target">
  <span>管理欄の対象</span>
  <div role="group" aria-label="管理欄の対象" className="member-visibility-tabs">
    {(["visible", "hidden"] as const).map((tab) => <button type="button" key={tab}
      aria-pressed={value === tab} className={value === tab ? "is-active" : ""}
      onClick={() => onChange(tab)}>{tab === "visible" ? "表示" : "非表示"}</button>)}
  </div>
</div>;

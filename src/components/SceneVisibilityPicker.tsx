import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { buildVisibilityBlocks, createVisibilityMemory, normalizeVisibilitySearch, revealVisibilityChip, visibilityRows,
  type VisibilityItem, type VisibilityGroup, type VisibilityMemory } from "../utils/sceneVisibility";
import { SceneVisibilityChip } from "./SceneVisibilityChip";
import { PortraitPanelHeader } from "./PortraitPanelHeader";

type Props = {
  title: string; portrait: boolean; items: VisibilityItem[]; groups: VisibilityGroup[];
  selectedPositionSlot?: ReactNode;
  memory?: VisibilityMemory; actions?: ReactNode; visibilityTab: "visible" | "hidden";
  onVisibilityTab: (tab: "visible" | "hidden") => void;
  onSelect: (id: string) => void; onVisibility: (id: string, visible: boolean) => void;
  onAll: (visible: boolean) => void; disabled?: boolean;
  scrollTarget?: { id: string; token: number } | null;
};

export const SceneVisibilityPicker = (props: Props) => {
  const localMemory = useRef(createVisibilityMemory());
  const memory = props.memory ?? localMemory.current;
  const [input, setInput] = useState(memory.query);
  const [query, setQuery] = useState(memory.query);
  const [rows, setRows] = useState(1);
  const [low, setLow] = useState(false);
  const composing = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const positionRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const restoreScroll = useRef<number | null>(memory.scrollLeft);
  const callbacks = useRef(props);
  callbacks.current = props;
  const select = useCallback((id: string) => callbacks.current.onSelect(id), []);
  const visibility = useCallback((id: string, visible: boolean) => callbacks.current.onVisibility(id, visible), []);
  const allBlocks = useMemo(() => buildVisibilityBlocks(props.items, props.groups), [props.items, props.groups]);
  const searchIndex = useMemo(() => new Map(props.items.map((item) => [item.id, normalizeVisibilitySearch(item.name)])), [props.items]);
  const blocks = useMemo(() => {
    if (!props.portrait || !query) return allBlocks;
    const normalized = normalizeVisibilitySearch(query);
    return allBlocks.map((block) => ({ ...block, items: block.items.filter((item) => searchIndex.get(item.id)?.includes(normalized)) }))
      .filter((block) => block.items.length > 0);
  }, [allBlocks, props.portrait, query, searchIndex]);
  const selectedItems = useMemo(() => props.items.filter((item) => item.selected), [props.items]);
  const selectedId = selectedItems[0]?.id;
  const matchingIds = useMemo(() => new Set(blocks.flatMap((block) => block.items.map((item) => item.id))), [blocks]);
  const selectedHidden = selectedItems.some((item) => !matchingIds.has(item.id));
  const changeQuery = (next: string) => {
    if (!query && next) memory.beforeSearch = scrollRef.current?.scrollLeft ?? 0;
    restoreScroll.current = next ? 0 : memory.beforeSearch;
    memory.query = next;
    setQuery(next);
  };

  useLayoutEffect(() => {
    restoreScroll.current = props.portrait ? memory.scrollLeft : memory.scrollTop;
  }, [props.portrait, memory]);

  useLayoutEffect(() => {
    if (!props.portrait) return;
    const panel = rootRef.current?.closest<HTMLElement>(".tab-panel__content");
    const header = headerRef.current;
    if (!panel || !header) return;
    const measure = () => {
      const style = getComputedStyle(panel);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const manager = rootRef.current?.closest<HTMLElement>(".member-manager, .object-manager");
      const managerStyle = manager ? getComputedStyle(manager) : null;
      const managerPadding = managerStyle ? (parseFloat(managerStyle.paddingTop) || 0) + (parseFloat(managerStyle.paddingBottom) || 0)
        + (parseFloat(managerStyle.borderTopWidth) || 0) + (parseFloat(managerStyle.borderBottomWidth) || 0) : 0;
      const headerStyle = getComputedStyle(header);
      const margins = (parseFloat(headerStyle.marginTop) || 0) + (parseFloat(headerStyle.marginBottom) || 0);
      const gaps = 3 * (parseFloat(managerStyle?.rowGap ?? "0") || 0);
      const scrollPadding = scrollRef.current ? parseFloat(getComputedStyle(scrollRef.current).paddingBottom) || 0 : 0;
      // Only independent layout measurements, never the resulting chip grid height.
      const available = panel.clientHeight - header.offsetHeight - (infoRef.current?.offsetHeight ?? 0) - padding
        - (positionRef.current?.offsetHeight ?? 0) - managerPadding - margins - gaps - scrollPadding - 28 - 16;
      const next = visibilityRows(available);
      const owner = scrollRef.current;
      if (owner) {
        const chips = Array.from(owner.querySelectorAll<HTMLElement>("[data-visibility-id]"));
        const edge = owner.getBoundingClientRect().left;
        const anchor = chips.find((chip) => chip.dataset.visibilityId === selectedId) ??
          chips.find((chip) => chip.getBoundingClientRect().right > edge);
        if (anchor) anchorRef.current = { id: anchor.dataset.visibilityId!, offset: anchor.getBoundingClientRect().left - edge };
      }
      setRows((previous) => previous === next ? previous : next);
      const nextLow = panel.clientHeight < header.offsetHeight + 160;
      setLow((previous) => previous === nextLow ? previous : nextLow);
      const sticky = !nextLow && panel.closest("[data-workspace-keyboard]")?.getAttribute("data-workspace-keyboard") !== "open";
      panel.style.setProperty("--panel-sticky-height", sticky ? `${header.offsetHeight}px` : "0px");
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    observer?.observe(header);
    observer?.observe(infoRef.current!);
    if (positionRef.current) observer?.observe(positionRef.current);
    return () => { observer?.disconnect(); panel.style.removeProperty("--panel-sticky-height"); };
  }, [props.portrait, selectedId]);

  useLayoutEffect(() => {
    const owner = scrollRef.current;
    const anchor = anchorRef.current;
    if (!props.portrait || !owner || !anchor) return;
    const chip = Array.from(owner.querySelectorAll<HTMLElement>("[data-visibility-id]")).find((node) => node.dataset.visibilityId === anchor.id);
    if (chip) owner.scrollLeft += chip.getBoundingClientRect().left - owner.getBoundingClientRect().left - anchor.offset;
    anchorRef.current = null;
  }, [rows, props.portrait]);

  useLayoutEffect(() => {
    const owner = scrollRef.current;
    if (owner && restoreScroll.current !== null) {
      if (props.portrait) {
        owner.scrollLeft = restoreScroll.current;
        memory.scrollLeft = owner.scrollLeft;
      } else {
        owner.scrollTop = restoreScroll.current;
        memory.scrollTop = owner.scrollTop;
      }
      restoreScroll.current = null;
    }
  }, [query, props.portrait, memory]);

  useLayoutEffect(() => {
    const owner = scrollRef.current;
    if (!owner || !props.scrollTarget) return;
    const chip = Array.from(owner.querySelectorAll<HTMLElement>("[data-visibility-id]")).find((node) => node.dataset.visibilityId === props.scrollTarget?.id);
    if (chip) revealVisibilityChip(owner, chip, props.portrait);
  }, [props.scrollTarget, props.portrait]);

  const renderChip = (item: VisibilityItem) => <SceneVisibilityChip key={item.id} item={item} onSelect={select} onVisibility={visibility} />;
  return <section ref={rootRef} className={`scene-visibility-picker ${props.portrait ? "is-portrait" : ""}`} aria-label="このシーンの表示">
    {props.portrait ? <PortraitPanelHeader headerRef={headerRef} title={props.title}
      visibleCount={props.items.filter((item) => item.visible).length} hiddenCount={props.items.filter((item) => !item.visible).length}
      query={input} onQuery={(next) => { setInput(next); if (!composing.current) changeQuery(next); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; setInput(event.currentTarget.value); changeQuery(event.currentTarget.value); }}
      actions={props.actions}
      onAll={props.onAll} disabled={props.disabled} low={low} /> : <>
      <div className="object-visibility-list__header"><strong>このシーンの表示</strong></div>
      <div className="visibility-checklist__actions">
        <button type="button" className="mini-button" disabled={props.disabled} onClick={() => props.onAll(true)}>すべて表示</button>
        <button type="button" className="mini-button" disabled={props.disabled} onClick={() => props.onAll(false)}>すべて非表示</button>
      </div>
    </>}
    {props.portrait && <div ref={positionRef}>{props.selectedPositionSlot}</div>}
    <div className="scene-visibility-picker__edge">
      <div ref={scrollRef} className="scene-visibility-picker__scroll object-visibility-list__items"
        style={{ "--rows": rows } as CSSProperties} data-rows={rows}
        onScroll={() => { if (scrollRef.current) { if (props.portrait) memory.scrollLeft = scrollRef.current.scrollLeft; else memory.scrollTop = scrollRef.current.scrollTop; } }}
        onFocusCapture={(event) => { const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-visibility-id]"); if (chip) revealVisibilityChip(event.currentTarget, chip, props.portrait); }}>
        {blocks.map((block) => <div className="scene-visibility-picker__group" key={block.id} style={{ borderColor: block.color }}>
          <div className="scene-visibility-picker__group-heading"><span aria-hidden="true" style={{ color: block.color ?? "#94a3b8" }}>■</span> {block.name} {props.portrait && query ? `${block.items.length}／${block.total}` : block.total}{props.title === "メンバー" ? "人" : "個"}</div>
          <div className="scene-visibility-picker__grid">{block.items.map(renderChip)}</div>
        </div>)}
        {blocks.length === 0 && <p className="empty-state compact">{props.portrait && query ? "一致する名前がありません" : `${props.title}はまだありません。`}
          {props.portrait && query && <button type="button" className="mini-button" onClick={() => { setInput(""); changeQuery(""); }}>クリア</button>}</p>}
      </div>
    </div>
    <div ref={infoRef} className="scene-visibility-picker__info" aria-live="polite">
      {selectedItems.length ? selectedItems.map((item) => `${item.name}: ${item.fullStatus}`).join(" ／ ") : "☑で表示切替・名前タップで選択"}
      {props.portrait && query && <button type="button" className="mini-button" onClick={() => { setInput(""); changeQuery(""); }}>{selectedHidden ? "選択対象を表示（検索解除）" : "検索解除"}</button>}
    </div>
  </section>;
};

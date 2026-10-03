import { memo, useId } from "react";
import type { VisibilityItem } from "../utils/sceneVisibility";

type Props = { item: VisibilityItem; compact?: boolean; onSelect: (id: string) => void; onVisibility: (id: string, visible: boolean) => void };

export const SceneVisibilityChip = memo(({ item, compact, onSelect, onVisibility }: Props) => {
  const descriptionId = useId();
  return <div data-visibility-id={item.id} className={`scene-visibility-chip object-visibility-item ${item.visible ? "is-visible" : "is-hidden"} ${item.selected ? "is-selected" : ""}`}>
    <label className="scene-visibility-chip__check" title={item.disabledReason}>
      <input type="checkbox" checked={item.visible} disabled={item.disabled}
        aria-label={`${item.name}をこのシーンに表示`} aria-describedby={descriptionId}
        onChange={(event) => onVisibility(item.id, event.target.checked)} />
    </label>
    <button type="button" className="scene-visibility-chip__name" aria-pressed={item.selected}
      aria-describedby={descriptionId} onClick={() => onSelect(item.id)}>
      <span className={`color-dot ${item.square ? "square" : ""}`} style={{ backgroundColor: item.color }} aria-hidden="true" />
      <span className="scene-visibility-chip__text"><span>{item.name}</span>{!compact && <small aria-hidden="true">{item.status}</small>}</span>
      {compact && Boolean(item.detailCount) && <small className="scene-visibility-chip__badge" aria-hidden="true">＋{item.detailCount}</small>}
    </button>
    <span id={descriptionId} className="sr-only">{item.fullStatus}</span>
  </div>;
}, (previous, next) => previous.compact === next.compact && previous.onSelect === next.onSelect && previous.onVisibility === next.onVisibility &&
  (Object.keys(next.item) as (keyof VisibilityItem)[]).every((key) => previous.item[key] === next.item[key]) &&
  Object.keys(previous.item).length === Object.keys(next.item).length);

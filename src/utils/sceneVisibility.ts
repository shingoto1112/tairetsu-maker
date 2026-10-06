export type VisibilityItem = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  selected: boolean;
  status: string;
  fullStatus: string;
  detailCount?: number;
  disabled?: boolean;
  disabledReason?: string;
  square?: boolean;
};

export type VisibilityGroup = { id: string; name: string; color?: string; ids: readonly string[] };
export type VisibilityBlock = VisibilityGroup & { items: VisibilityItem[]; total: number };
export type VisibilityMemory = { query: string; scrollLeft: number; scrollTop: number; beforeSearch: number };
export const createVisibilityMemory = (): VisibilityMemory => ({ query: "", scrollLeft: 0, scrollTop: 0, beforeSearch: 0 });

/** Normalize only the search index, never the saved/displayed name. */
export const normalizeVisibilitySearch = (name: string): string => name.normalize("NFKC").toLocaleLowerCase()
  .replace(/[\u30a1-\u30f6]/g, (kana) => String.fromCharCode(kana.charCodeAt(0) - 0x60));

export const buildVisibilityBlocks = (
  items: readonly VisibilityItem[], groups: readonly VisibilityGroup[], query = "",
): VisibilityBlock[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const added = new Set<string>();
  const normalized = normalizeVisibilitySearch(query);
  const result: VisibilityBlock[] = [];
  const add = (group: VisibilityGroup) => {
    const unique = group.ids.flatMap((id) => {
      const item = byId.get(id);
      if (!item || added.has(id)) return [];
      added.add(id);
      return [item];
    });
    const matches = unique.filter((item) => normalizeVisibilitySearch(item.name).includes(normalized));
    if (matches.length) result.push({ ...group, items: matches, total: unique.length });
  };
  groups.forEach(add);
  add({ id: "__ungrouped__", name: "未所属", ids: items.map((item) => item.id) });
  return result;
};

export const visibilityRows = (available: number): number => Math.max(1, Math.min(6, Math.floor((available + 6) / 50)));

/** Scroll only the picker on its active axis; do not move the panel or steal focus. */
export const revealVisibilityChip = (owner: HTMLElement, chip: HTMLElement, portrait = true) => {
  const bounds = owner.getBoundingClientRect();
  const target = chip.getBoundingClientRect();
  if (!portrait) {
    if (target.top < bounds.top) owner.scrollTop -= bounds.top - target.top;
    else if (target.bottom > bounds.bottom) owner.scrollTop += target.bottom - bounds.bottom;
    return;
  }
  if (target.left < bounds.left) owner.scrollLeft -= bounds.left - target.left;
  else if (target.right > bounds.right) owner.scrollLeft += target.right - bounds.right;
};

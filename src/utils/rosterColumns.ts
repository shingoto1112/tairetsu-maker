import { nextNumberedName } from "./numberedName";

export type RosterMode = "members" | "objects";
export type RosterGroup = {
  id: string;
  name: string;
  color?: string;
  memberIds?: readonly string[];
  objectIds?: readonly string[];
};
export type RosterColumn<T> = {
  id: string;
  groupId: string | null;
  label: string;
  color?: string;
  items: T[];
};

/** Group order, first membership, then the remaining items in source order. */
export const collectGroupedItems = <T extends { id: string }>(
  items: readonly T[],
  groups: readonly RosterGroup[],
  key: "memberIds" | "objectIds",
): RosterColumn<T>[] => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const assignedIds = new Set<string>();
  const columns = groups.map((group) => {
    const groupedItems: T[] = [];
    for (const id of group[key] ?? []) {
      const item = itemById.get(id);
      if (item && !assignedIds.has(id)) {
        assignedIds.add(id);
        groupedItems.push(item);
      }
    }
    return {
      id: group.id, groupId: group.id, label: group.name,
      color: group.color, items: groupedItems,
    };
  });
  return [...columns, {
    id: "ungrouped", groupId: null, label: "未所属",
    items: items.filter((item) => !assignedIds.has(item.id)),
  }];
};

/** Excel/PDF table columns. PNG deliberately keeps collectGroupedItems's empty ungrouped column. */
export const collectRosterTableColumns = <T extends { id: string }>(
  items: readonly T[], groups: readonly RosterGroup[], key: "memberIds" | "objectIds",
): RosterColumn<T>[] => selectRosterTableColumns(collectGroupedItems(items, groups, key));

export const selectRosterTableColumns = <T,>(columns: readonly RosterColumn<T>[]): RosterColumn<T>[] =>
  columns.filter(column => column.groupId !== null || column.items.length > 0 || columns.length === 1);

export const nextRosterItemName = <T extends { id: string; name: string }>(
  items: readonly T[],
  groups: readonly RosterGroup[],
  mode: RosterMode,
  groupId: string | null,
): string => {
  const column = collectGroupedItems(
    items, groups, mode === "members" ? "memberIds" : "objectIds",
  ).find((item) => item.groupId === groupId);
  if (!column) throw new Error("追加先の名簿列が見つかりません。");
  const base = groupId === null
    ? mode === "members" ? "メンバー" : "道具"
    : column.label.trim() || (mode === "members" ? "グループ" : "道具");
  return nextNumberedName(base, items.map((item) => item.name), column.items.length + 1);
};

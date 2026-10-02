import { collectGroupedItems, type RosterColumn, type RosterGroup, type RosterMode } from "./rosterColumns";

export type RosterEntry = { id: string; name: string; no: number };
export type RosterExportSnapshot = {
  title: string;
  mode: RosterMode;
  exportedAt: string;
  totalCount: number;
  columns: RosterColumn<RosterEntry>[];
};

export const rosterTitle = (mode: RosterMode) =>
  mode === "members" ? "メンバー名簿" : "道具名簿";

export const createRosterExportSnapshot = (
  title: string,
  mode: RosterMode,
  items: readonly { id: string; name: string }[],
  groups: readonly RosterGroup[],
  date = new Date(),
): RosterExportSnapshot => ({
  title: title.trim() || "隊列メーカー",
  mode,
  exportedAt: date.toISOString(),
  totalCount: items.length,
  columns: collectGroupedItems(items, groups, mode === "members" ? "memberIds" : "objectIds")
    .map((column) => ({
      ...column,
      items: column.items.map((item, index) => ({ id: item.id, name: item.name, no: index + 1 })),
    })),
});

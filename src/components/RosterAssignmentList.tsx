import type { Member, StageObject } from "../types";
import type { RosterColumn } from "../utils/rosterColumns";

type Props = {
  groups: RosterColumn<StageObject>[];
  visibleIds: ReadonlySet<string>;
  assignments: ReadonlyMap<string, Member[]>;
  selectedId?: string;
  retainedId?: string;
  query: string;
  onQuery: (value: string) => void;
  unassignedOnly: boolean;
  onFilter: (value: boolean) => void;
  hiddenOpen: boolean;
  onHiddenOpen: (value: boolean) => void;
  onSelect: (object: StageObject) => void;
};

export const RosterAssignmentList = ({ groups, visibleIds, assignments, selectedId, retainedId, query, onQuery,
  unassignedOnly, onFilter, hiddenOpen, onHiddenOpen, onSelect }: Props) => {
  const matches = (object: StageObject) => object.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const hidden = groups.flatMap((group) => group.items).filter((object) => !visibleIds.has(object.id));
  const row = (object: StageObject, readOnly = false) => {
    const assigned = assignments.get(object.id) ?? [];
    return <button key={object.id} type="button"
      className={`roster-assignment-row${readOnly ? " is-hidden" : ""}`}
      aria-pressed={selectedId === object.id} aria-label={`${object.name}・${assigned.length}人${readOnly ? "・閲覧のみ" : ""}`}
      onClick={() => onSelect(object)}>
      <span className="color-dot" style={{ backgroundColor: object.color }} aria-hidden="true" />
      <span className="roster-assignment-row__text">
        <strong>{object.name}</strong>
        <span className={`roster-assignment-row__names${assigned.length ? "" : " is-empty"}`}
          title={assigned.map((member) => member.name).join("、")}>
          {assigned.length === 0 ? "担当者なし" : assigned.slice(0, 2).map((member, index) =>
            <span key={member.id}><span className="roster-assignment-row__person">{member.name}</span>{index === 1 && assigned.length > 2 && <small>ほか{assigned.length - 2}人</small>}</span>)}
        </span>
      </span>
      <span className="roster-assignment-count">{assigned.length}人</span>
    </button>;
  };
  const filtered = groups.map((group) => ({ ...group, items: group.items.filter((object) =>
    visibleIds.has(object.id) && matches(object) && (!unassignedOnly || !assignments.get(object.id)?.length || object.id === retainedId),
  ) })).filter((group) => group.items.length > 0);
  return <>
    <div className="roster-assignment-list__controls">
      <input type="search" aria-label="道具名を検索" placeholder="道具名を検索" value={query}
        onChange={(event) => onQuery(event.target.value)} />
      <div className="member-picker__orders" role="group" aria-label="道具の絞り込み">
        <button type="button" aria-pressed={!unassignedOnly} onClick={() => onFilter(false)}>すべて</button>
        <button type="button" aria-pressed={unassignedOnly} onClick={() => onFilter(true)}>担当者なし</button>
      </div>
    </div>
    <div aria-label="道具グループ別一覧">
      {filtered.length === 0 && <p className="empty-state compact">該当する表示中の道具はありません。</p>}
      {filtered.map((group) => <section key={group.id} className="roster-assignment-group">
        <h3 style={{ borderLeftColor: group.color ?? "#94a3b8" }}>{group.label}<small>{group.items.length}個</small></h3>
        {group.items.map((object) => row(object))}
      </section>)}
    </div>
    {hidden.length > 0 && <section className="roster-assignment-hidden">
      <button type="button" className="roster-assignment-hidden__toggle" aria-expanded={hiddenOpen}
        onClick={() => onHiddenOpen(!hiddenOpen)}>{hiddenOpen ? "▾" : "▸"} このシーンで非表示の道具（{hidden.length}）</button>
      {hiddenOpen && <>
        <p className="roster-assignment-help">隊列表の道具タブで表示にすると割当できます。</p>
        {hidden.filter(matches).map((object) => row(object, true))}
      </>}
    </section>}
  </>;
};

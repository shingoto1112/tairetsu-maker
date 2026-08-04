import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Member, MemberGroup, ObjectGroup, StageObject } from "../types";
import { ColorPaletteInput } from "./ColorPaletteInput";

type RosterMode = "members" | "objects";

type RosterManagementModalProps = {
  isOpen: boolean;
  allowedModes?: RosterMode[];
  members: Member[];
  memberGroups: MemberGroup[];
  objects: StageObject[];
  objectGroups: ObjectGroup[];
  onClose: () => void;
  onRenameMember: (memberId: string, name: string) => void;
  onRenameObject: (objectId: string, name: string) => void;
  onAddMember: (groupId: string | null, name: string) => void;
  onAddObject: (groupId: string | null, name: string) => void;
  onCreateMemberGroup: () => void;
  onCreateObjectGroup: () => void;
  onRenameMemberGroup: (groupId: string, name: string) => void;
  onRenameObjectGroup: (groupId: string, name: string) => void;
  onDeleteMember: (memberId: string) => void;
  onDeleteObject: (objectId: string) => void;
  onDeleteMemberGroup: (groupId: string) => void;
  onDeleteObjectGroup: (groupId: string) => void;
  onUpdateMemberGroupColor: (groupId: string, color: string) => void;
  onUpdateObjectGroupColor: (groupId: string, color: string) => void;
};

type RosterColumn<T> = {
  id: string;
  groupId: string | null;
  label: string;
  color?: string;
  items: T[];
};

const getCellKey = (mode: RosterMode, columnId: string, rowIndex: number) =>
  `${mode}:${columnId}:${rowIndex}`;

const collectGroupedItems = <T extends { id: string }>(
  items: T[],
  groups: Array<{ id: string; name: string; color?: string; memberIds?: string[]; objectIds?: string[] }>,
  key: "memberIds" | "objectIds",
): RosterColumn<T>[] => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const assignedIds = new Set<string>();
  const columns = groups.map((group) => {
    const groupedItems = (group[key] ?? [])
      .map((id) => {
        if (assignedIds.has(id)) {
          return null;
        }
        const item = itemById.get(id);
        if (!item) {
          return null;
        }
        assignedIds.add(id);
        return item;
      })
      .filter((item): item is T => Boolean(item));
    return {
      id: group.id,
      groupId: group.id,
      label: group.name,
      color: group.color,
      items: groupedItems,
    };
  });
  const ungrouped = items.filter((item) => !assignedIds.has(item.id));
  return [
    ...columns,
    {
      id: "ungrouped",
      groupId: null,
      label: "未所属",
      items: ungrouped,
    },
  ];
};

export const RosterManagementModal = ({
  isOpen,
  members,
  memberGroups,
  objects,
  objectGroups,
  onClose,
  allowedModes,
  onRenameMember,
  onRenameObject,
  onAddMember,
  onAddObject,
  onCreateMemberGroup,
  onCreateObjectGroup,
  onRenameMemberGroup,
  onRenameObjectGroup,
  onDeleteMember,
  onDeleteObject,
  onDeleteMemberGroup,
  onDeleteObjectGroup,
  onUpdateMemberGroupColor,
  onUpdateObjectGroupColor,
}: RosterManagementModalProps) => {
  const [mode, setMode] = useState<RosterMode>("members");
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [memberGroupDrafts, setMemberGroupDrafts] = useState<Record<string, string>>({});
  const [objectGroupDrafts, setObjectGroupDrafts] = useState<Record<string, string>>({});
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !allowedModes || allowedModes.includes(mode)) {
      return;
    }
    setMode(allowedModes[0] ?? "members");
  }, [allowedModes, isOpen, mode]);

  useEffect(() => {
    setMemberGroupDrafts((previous) => {
      const next: Record<string, string> = {};
      memberGroups.forEach((group) => {
        next[group.id] = previous[group.id] ?? group.name;
      });
      return next;
    });
  }, [memberGroups]);

  useEffect(() => {
    setObjectGroupDrafts((previous) => {
      const next: Record<string, string> = {};
      objectGroups.forEach((group) => {
        next[group.id] = previous[group.id] ?? group.name;
      });
      return next;
    });
  }, [objectGroups]);

  const memberColumns = useMemo(
    () => collectGroupedItems(members, memberGroups, "memberIds"),
    [members, memberGroups],
  );
  const objectColumns = useMemo(
    () => collectGroupedItems(objects, objectGroups, "objectIds"),
    [objects, objectGroups],
  );

  const columns = mode === "members" ? memberColumns : objectColumns;
  const rowCount = Math.max(1, ...columns.map((column) => column.items.length)) + 1;
  const totalCount = mode === "members" ? members.length : objects.length;
  const countUnit = mode === "members" ? "人" : "個";

  if (!isOpen) {
    return null;
  }

  const focusCell = (columnId: string, rowIndex: number) => {
    window.setTimeout(() => {
      inputRefs.current.get(getCellKey(mode, columnId, rowIndex))?.focus();
    }, 0);
  };

  const commitCell = (
    column: RosterColumn<Member | StageObject>,
    rowIndex: number,
  ) => {
    const key = getCellKey(mode, column.id, rowIndex);
    const item = column.items[rowIndex];
    const draft = cellDrafts[key];
    if (draft === undefined) {
      return;
    }
    const nextName = draft.trim();
    if (item) {
      if (!nextName) {
        if (mode === "members") {
          onDeleteMember(item.id);
        } else {
          onDeleteObject(item.id);
        }
        setCellDrafts((previous) => {
          const { [key]: _removed, ...rest } = previous;
          void _removed;
          return rest;
        });
        return;
      }
      if (nextName === item.name) {
        setCellDrafts((previous) => {
          const { [key]: _removed, ...rest } = previous;
          void _removed;
          return rest;
        });
        return;
      }
      if (mode === "members") {
        onRenameMember(item.id, nextName);
      } else {
        onRenameObject(item.id, nextName);
      }
    } else if (nextName) {
      if (mode === "members") {
        onAddMember(column.groupId, nextName);
      } else {
        onAddObject(column.groupId, nextName);
      }
    }
    setCellDrafts((previous) => {
      const { [key]: _removed, ...rest } = previous;
      void _removed;
      return rest;
    });
  };

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    column: RosterColumn<Member | StageObject>,
    rowIndex: number,
  ) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    commitCell(column, rowIndex);
    focusCell(column.id, rowIndex + 1);
  };

  const commitGroupName = (groupId: string) => {
    if (groupId === "ungrouped") {
      return;
    }
    const drafts = mode === "members" ? memberGroupDrafts : objectGroupDrafts;
    const groups = mode === "members" ? memberGroups : objectGroups;
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    const nextName = (drafts[groupId] ?? group.name).trim();
    if (!nextName) {
      if (mode === "members") {
        onDeleteMemberGroup(groupId);
        setMemberGroupDrafts((previous) => ({ ...previous, [groupId]: group.name }));
      } else {
        onDeleteObjectGroup(groupId);
        setObjectGroupDrafts((previous) => ({ ...previous, [groupId]: group.name }));
      }
      return;
    }
    if (nextName === group.name) {
      return;
    }
    if (mode === "members") {
      onRenameMemberGroup(groupId, nextName);
    } else {
      onRenameObjectGroup(groupId, nextName);
    }
  };

  const renderGroupHeader = (column: RosterColumn<Member | StageObject>) => {
    if (column.groupId === null) {
      return <span className="roster-table__ungrouped">{column.label}</span>;
    }
    const drafts = mode === "members" ? memberGroupDrafts : objectGroupDrafts;
    const setDrafts = mode === "members" ? setMemberGroupDrafts : setObjectGroupDrafts;
    const colorValue = column.color ?? "#0f766e";
    return (
      <div className="roster-table__group-heading">
        <ColorPaletteInput
          compact
          label={`${column.label}の色`}
          value={colorValue}
          onChange={(color) => {
            if (mode === "members") {
              onUpdateMemberGroupColor(column.id, color);
            } else {
              onUpdateObjectGroupColor(column.id, color);
            }
          }}
        />
        <input
          aria-label={`${column.label}のグループ名`}
          value={drafts[column.id] ?? column.label}
          onChange={(event) =>
            setDrafts((previous) => ({
              ...previous,
              [column.id]: event.target.value,
            }))
          }
          onBlur={() => commitGroupName(column.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitGroupName(column.id);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    );
  };

  return (
    <div className="roster-manager-backdrop">
      <section
        className="roster-manager-modal"
        aria-modal="true"
        role="dialog"
        aria-labelledby="roster-manager-title"
      >
        <header className="roster-manager-header">
          <button
            className="roster-manager-back"
            onClick={onClose}
            type="button"
          >
            <ArrowLeft size={20} />
            隊列表へ戻る
          </button>
          <div>
            <p>全体名簿</p>
            <h2 id="roster-manager-title">メンバー/道具の管理</h2>
          </div>
        </header>

        <div className="roster-manager-topbar">
          <div className="roster-manager-tabs" role="tablist" aria-label="管理対象">
            <button
              className={mode === "members" ? "is-active" : ""}
              onClick={() => setMode("members")}
              disabled={Boolean(allowedModes && !allowedModes.includes("members"))}
              type="button"
            >
              メンバー管理
            </button>
            <button
              className={mode === "objects" ? "is-active" : ""}
              onClick={() => setMode("objects")}
              disabled={Boolean(allowedModes && !allowedModes.includes("objects"))}
              type="button"
            >
              道具管理
            </button>
          </div>
          <div className="roster-summary" aria-label="名簿の人数">
            <div className="roster-summary__total">
              <span>{mode === "members" ? "全体人数" : "全体数"}</span>
              <strong>
                {totalCount}
                {countUnit}
              </strong>
            </div>
            <div className="roster-summary__groups">
              {columns.map((column) => (
                <span key={column.id} className="roster-summary__chip">
                  <span
                    className="roster-summary__dot"
                    style={{ backgroundColor: column.color ?? "#94a3b8" }}
                  />
                  <span className="roster-summary__name">{column.label}</span>
                  <strong>
                    {column.items.length}
                    {countUnit}
                  </strong>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th className="roster-table__number">No.</th>
                {columns.map((column) => (
                  <th key={column.id}>{renderGroupHeader(column)}</th>
                ))}
                <th className="roster-table__add-group">
                  <button
                    type="button"
                    onClick={
                      mode === "members"
                        ? onCreateMemberGroup
                        : onCreateObjectGroup
                    }
                    aria-label={
                      mode === "members"
                        ? "メンバーグループを追加"
                        : "道具グループを追加"
                    }
                    title={
                      mode === "members"
                        ? "メンバーグループを追加"
                        : "道具グループを追加"
                    }
                  >
                    +
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  <th className="roster-table__number">{rowIndex + 1}</th>
                  {columns.map((column) => {
                    const item = column.items[rowIndex];
                    const key = getCellKey(mode, column.id, rowIndex);
                    const value = cellDrafts[key] ?? item?.name ?? "";
                    return (
                      <td key={column.id}>
                        <input
                          ref={(element) => {
                            if (element) {
                              inputRefs.current.set(key, element);
                            } else {
                              inputRefs.current.delete(key);
                            }
                          }}
                          value={value}
                          placeholder={item ? "" : "追加"}
                          onChange={(event) =>
                            setCellDrafts((previous) => ({
                              ...previous,
                              [key]: event.target.value,
                            }))
                          }
                          onBlur={() => commitCell(column, rowIndex)}
                          onKeyDown={(event) =>
                            handleCellKeyDown(event, column, rowIndex)
                          }
                          aria-label={`${column.label} ${rowIndex + 1}行目`}
                        />
                      </td>
                    );
                  })}
                  <td className="roster-table__add-group-cell" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

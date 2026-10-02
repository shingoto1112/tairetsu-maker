import { ArrowLeft, FileDown } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CSSProperties, KeyboardEvent } from "react";
import type { Member, MemberGroup, ObjectGroup, StageObject } from "../types";
import { ColorPaletteInput } from "./ColorPaletteInput";
import { collectGroupedItems, type RosterColumn, type RosterMode } from "../utils/rosterColumns";
import type { ExportSource } from "../utils/mobileExportTypes";
import type { RosterAssignmentViewProps } from "./RosterAssignmentView";
import { useModalFocus } from "../hooks/useModalFocus";

const RosterAssignmentView = lazy(() => import("./RosterAssignmentView").then((module) => ({ default: module.RosterAssignmentView })));

const DocumentExportSheet = lazy(() => import("./DocumentExportSheet").then((module) => ({ default: module.DocumentExportSheet })));

type RosterManagementModalProps = RosterAssignmentViewProps & {
  isOpen: boolean;
  projectTitle: string;
  onNotice: (message: string) => void;
  initialMode?: RosterMode;
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
  onQuickAddMember: (groupId: string | null) => void;
  onQuickAddObject: (groupId: string | null) => void;
  onCreateMemberGroup: () => void;
  onCreateObjectGroup: () => void;
  onRenameMemberGroup: (groupId: string, name: string) => void;
  onRenameObjectGroup: (groupId: string, name: string) => void;
  onDeleteMember: (memberId: string) => Promise<boolean>;
  onDeleteObject: (objectId: string) => Promise<boolean>;
  onDeleteMemberGroup: (groupId: string) => Promise<boolean>;
  onDeleteObjectGroup: (groupId: string) => Promise<boolean>;
  onUpdateMemberGroupColor: (groupId: string, color: string) => void;
  onUpdateObjectGroupColor: (groupId: string, color: string) => void;
};

const getCellKey = (mode: RosterMode, columnId: string, itemId?: string) =>
  itemId ? `${mode}:item:${itemId}` : `${mode}:${columnId}:new`;

const emptyNameNotice = "名前は空欄にできません。削除は×から行えます。";

export const RosterManagementModal = ({
  isOpen,
  projectTitle,
  onNotice,
  initialMode,
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
  onQuickAddMember,
  onQuickAddObject,
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
  frames,
  currentFrame,
  objectStates,
  previousFrame,
  previousObjectStates,
  canEditAssignments,
  readOnlyMessage,
  onAssignMember,
  onRemoveAssignment,
  onApplyPreviousAssignments,
  onSelectFrame,
  canUndo,
  onUndo,
}: RosterManagementModalProps) => {
  const [mode, setMode] = useState<RosterMode>("members");
  const [objectView, setObjectView] = useState<"names" | "assignments">("names");
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [memberGroupDrafts, setMemberGroupDrafts] = useState<Record<string, string>>({});
  const [objectGroupDrafts, setObjectGroupDrafts] = useState<Record<string, string>>({});
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const cellDraftsRef = useRef<Record<string, string>>({});
  const deleting = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editNotice, setEditNotice] = useState("");
  const wasOpen = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const handleModalTab = useModalFocus(dialogRef, isOpen);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const reportEditNotice = (message: string) => { setEditNotice(message); onNotice(message); };
  const latestData = useRef<ExportSource>({ projectTitle, members, objects, memberGroups, objectGroups, frames, currentFrame, objectStates });
  latestData.current = { projectTitle, members, objects, memberGroups, objectGroups, frames, currentFrame, objectStates };
  const getExportSource = (): ExportSource => {
    if (composing.current) throw new Error("入力を確定してから書き出してください。");
    flushSync(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && dialogRef.current?.contains(active)) active.blur();
    });
    return structuredClone(latestData.current);
  };
  const openExport = () => {
    if (composing.current) {
      setExportNotice("入力を確定してから書き出してください。"); onNotice("入力を確定してから書き出してください。"); return;
    }
    getExportSource(); setExportNotice(""); setExportOpen(true);
  };

  useEffect(() => {
    setObjectView("names");
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen) { composing.current = false; setExportOpen(false); }
    if (isOpen && !wasOpen.current && initialMode) {
      setMode(
        allowedModes && !allowedModes.includes(initialMode)
          ? allowedModes[0] ?? "members"
          : initialMode,
      );
    }
    wasOpen.current = isOpen;
  }, [isOpen, initialMode, allowedModes]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !exportOpen && !deleting.current && !dialogRef.current?.querySelector(".app-confirm-dialog")) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, exportOpen]);

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
      const column = (mode === "members" ? memberColumns : objectColumns).find((item) => item.id === columnId);
      inputRefs.current.get(getCellKey(mode, columnId, column?.items[rowIndex]?.id))?.focus();
    }, 0);
  };

  const commitCell = (
    column: RosterColumn<Member | StageObject>,
    rowIndex: number,
  ) => {
    if (composing.current || deleting.current) return;
    const item = column.items[rowIndex];
    const key = getCellKey(mode, column.id, item?.id);
    const draft = cellDraftsRef.current[key];
    if (draft === undefined) {
      return;
    }
    // Consume synchronously so Enter followed by blur cannot commit twice.
    delete cellDraftsRef.current[key];
    setCellDrafts({ ...cellDraftsRef.current });
    const nextName = draft.trim();
    if (item) {
      if (!nextName) {
        reportEditNotice(emptyNameNotice);
        return;
      }
      if (nextName === item.name) return;
      if (mode === "members") onRenameMember(item.id, nextName);
      else onRenameObject(item.id, nextName);
    } else if (nextName) {
      if (mode === "members") onAddMember(column.groupId, nextName);
      else onAddObject(column.groupId, nextName);
    }
  };

  const requestDelete = async (
    remove: () => Promise<boolean>,
    focusTarget: HTMLInputElement | undefined,
    key?: string,
  ) => {
    if (deleting.current) return;
    if (composing.current) {
      reportEditNotice("入力を確定してから削除してください。");
      return;
    }
    deleting.current = true;
    setEditNotice("");
    setIsDeleting(true);
    try {
      const deleted = await remove();
      if (deleted && key) {
        delete cellDraftsRef.current[key];
        setCellDrafts({ ...cellDraftsRef.current });
      }
      if (!deleted && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    } catch {
      reportEditNotice("削除できませんでした。もう一度お試しください。");
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    } finally {
      deleting.current = false;
      setIsDeleting(false);
    }
  };

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    column: RosterColumn<Member | StageObject>,
    rowIndex: number,
  ) => {
    if (
      event.key !== "Enter" ||
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return;
    }
    event.preventDefault();
    commitCell(column, rowIndex);
    focusCell(column.id, rowIndex + 1);
  };

  const commitGroupName = (groupId: string) => {
    if (composing.current || deleting.current) return;
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
      const setDrafts = mode === "members" ? setMemberGroupDrafts : setObjectGroupDrafts;
      setDrafts((previous) => ({ ...previous, [groupId]: group.name }));
      reportEditNotice(emptyNameNotice);
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
          label={`${column.label}のグループの色`}
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
          onCompositionEnd={(event) => {
            if (document.activeElement !== event.currentTarget) commitGroupName(column.id);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !composing.current &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <button
          className="roster-table__delete"
          type="button"
          aria-label={`${column.label}のグループを削除`}
          disabled={isDeleting}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const input = event.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[aria-label$="のグループ名"]') ?? undefined;
            void requestDelete(
              () => mode === "members" ? onDeleteMemberGroup(column.id) : onDeleteObjectGroup(column.id),
              input,
            );
          }}
        >×</button>
      </div>
    );
  };

  return (
    <div className="roster-manager-backdrop">
      <section
        ref={dialogRef}
        onKeyDown={handleModalTab}
        tabIndex={-1}
        className={`roster-manager-modal${mode === "objects" && objectView === "assignments" ? " is-assignments" : ""}`}
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}
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
          <div className="roster-manager-export">
            <button ref={exportButtonRef} type="button" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={openExport}>
              <FileDown size={18} aria-hidden="true" />書き出し ▾
            </button>
          </div>
          {editNotice && <p className="roster-manager-edit-notice" role="status">{editNotice}</p>}
        </header>
        {exportNotice && <p className="roster-manager-export-notice" role="status">{exportNotice}</p>}

        <div className="roster-manager-topbar">
          <div className="roster-manager-mode-controls">
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
          {mode === "objects" && (
            <div className="roster-assignment-switch" role="group" aria-label="道具管理の表示">
              <button type="button" aria-pressed={objectView === "names"} onClick={() => setObjectView("names")}>名前の編集</button>
              <button type="button" aria-pressed={objectView === "assignments"} onClick={() => setObjectView("assignments")}>道具割当</button>
            </div>
          )}
          </div>
          {!(mode === "objects" && objectView === "assignments") && <div className="roster-summary" aria-label="名簿の人数">
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
          </div>}
        </div>

        {mode === "objects" && objectView === "assignments" ? (
          <Suspense fallback={<p role="status">割当を読み込み中…</p>}>
            <RosterAssignmentView frames={frames} currentFrame={currentFrame}
              objectStates={objectStates} previousFrame={previousFrame} previousObjectStates={previousObjectStates}
              members={members} memberGroups={memberGroups} objects={objects} objectGroups={objectGroups}
              canEditAssignments={canEditAssignments} readOnlyMessage={readOnlyMessage}
              onAssignMember={onAssignMember} onRemoveAssignment={onRemoveAssignment}
              onApplyPreviousAssignments={onApplyPreviousAssignments} onSelectFrame={onSelectFrame}
              canUndo={canUndo} onUndo={onUndo} />
          </Suspense>
        ) : <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th className="roster-table__number">No.</th>
                {columns.map((column) => (
                  <th key={column.id}>
                    <div className="roster-table__column-heading">
                      {renderGroupHeader(column)}
                      <button
                        className="roster-table__quick-add"
                        type="button"
                        aria-label={`${column.label}に${mode === "members" ? "メンバー" : "道具"}を追加`}
                        onClick={(event) => {
                          event.currentTarget.focus({ preventScroll: true });
                          if (mode === "members") onQuickAddMember(column.groupId);
                          else onQuickAddObject(column.groupId);
                        }}
                      >
                        {mode === "members" ? "＋ メンバー追加" : "＋ 道具追加"}
                      </button>
                    </div>
                  </th>
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
                    グループ追加 +
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
                    if (!item && rowIndex > column.items.length) return <td key={column.id} />;
                    const key = getCellKey(mode, column.id, item?.id);
                    const value = cellDrafts[key] ?? item?.name ?? "";
                    return (
                      <td key={column.id}>
                        <div className="roster-table__name-cell">
                        <input
                          key={key}
                          className="roster-table__cell-input"
                          style={{
                            "--roster-group-color": column.color ?? "#94a3b8",
                          } as CSSProperties}
                          ref={(element) => {
                            if (element) {
                              inputRefs.current.set(key, element);
                            } else {
                              inputRefs.current.delete(key);
                            }
                          }}
                          value={value}
                          placeholder={item ? "" : "追加"}
                          onChange={(event) => {
                            cellDraftsRef.current[key] = event.target.value;
                            setCellDrafts({ ...cellDraftsRef.current });
                          }}
                          onBlur={() => commitCell(column, rowIndex)}
                          onCompositionEnd={(event) => {
                            if (document.activeElement !== event.currentTarget) commitCell(column, rowIndex);
                          }}
                          onKeyDown={(event) =>
                            handleCellKeyDown(event, column, rowIndex)
                          }
                          aria-label={`${column.label} ${rowIndex + 1}行目`}
                        />
                        {item && <button
                          className="roster-table__delete"
                          type="button"
                          aria-label={`${item.name}を名簿から削除`}
                          disabled={isDeleting}
                          onPointerDown={(event) => event.preventDefault()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void requestDelete(
                            () => mode === "members" ? onDeleteMember(item.id) : onDeleteObject(item.id),
                            inputRefs.current.get(key), key,
                          )}
                        >×</button>}
                        </div>
                      </td>
                    );
                  })}
                  <td className="roster-table__add-group-cell" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {exportOpen && <Suspense fallback={<p role="status">書き出しを読み込み中…</p>}>
          <DocumentExportSheet initialTarget={mode === "members" ? "members" : objectView === "assignments" ? "assignments" : "objects"} getSource={getExportSource} onClose={() => { setExportOpen(false); exportButtonRef.current?.focus({ preventScroll: true }); }} />
        </Suspense>}
      </section>
    </div>
  );
};

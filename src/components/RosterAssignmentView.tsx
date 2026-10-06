import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormationFrame, Member, MemberGroup, ObjectGroup, ObjectState, Project, StageObject } from "../types";
import { RosterAssignmentSceneStrip } from "./RosterAssignmentSceneStrip";
import { RosterAssignmentStagePreview, rosterPreviewHeight } from "./RosterAssignmentStagePreview";
import { buildMemberGroupIndex } from "../utils/memberOrdering";
import { collectGroupedItems } from "../utils/rosterColumns";
import type { AssignMember, RemoveAssignment } from "./ObjectAssignmentEditor";
import { RosterAssignmentList } from "./RosterAssignmentList";
import { RosterAssignmentDetail } from "./RosterAssignmentDetail";
import { isMemberShownInScene } from "../utils/assignmentCandidates";
import type { MemberPickerSceneVisibility } from "./MemberPicker";

export type RosterAssignmentViewProps = {
  frames: FormationFrame[];
  currentFrame: FormationFrame | null;
  objectStates: Record<string, ObjectState>;
  previousFrame: FormationFrame | null;
  previousObjectStates: Record<string, ObjectState>;
  members: Member[];
  memberGroups: MemberGroup[];
  objects: StageObject[];
  objectGroups: ObjectGroup[];
  canEditAssignments: boolean;
  readOnlyMessage: string;
  onAssignMember: AssignMember;
  onRemoveAssignment: RemoveAssignment;
  onApplyPreviousAssignments: () => void | boolean | Promise<boolean>;
  onSelectFrame: (frameId: string) => void;
  canUndo?: boolean;
  onUndo?: () => void;
  /** Resolved visibility of the selected scene (snapshot), used to order assignment candidates. */
  memberVisibility?: Readonly<Record<string, boolean>>;
  /** Enables the scene strip and the read-only formation preview. */
  project?: Project;
};

const sceneTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export const RosterAssignmentView = (props: RosterAssignmentViewProps) => {
  const { frames, currentFrame, members, memberGroups, objects, objectGroups, objectStates,
    previousFrame, previousObjectStates, canEditAssignments, readOnlyMessage, onSelectFrame, canUndo, onUndo, memberVisibility, project } = props;
  // "非表示の人だけ" starts off when the view opens and survives prop/scene switches.
  const [hiddenMembersOnly, setHiddenMembersOnly] = useState(false);
  const sceneVisibility = useMemo<MemberPickerSceneVisibility | undefined>(() => memberVisibility && ({
    isShown: (member) => isMemberShownInScene(member, memberVisibility),
    hiddenOnly: hiddenMembersOnly,
    onHiddenOnlyChange: setHiddenMembersOnly,
  }), [memberVisibility, hiddenMembersOnly]);
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [rootWidth, setRootWidth] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const listScroll = useRef(0);
  const restoreListFocus = useRef(false);
  const [query, setQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [retainedId, setRetainedId] = useState<string>();
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [selection, setSelection] = useState<{ id: string; wasVisible: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState("");
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnConfirmFocus = useRef(false);
  const groupIndex = useMemo(() => buildMemberGroupIndex(memberGroups), [memberGroups]);
  const catalog = useMemo(() => {
    const memberById = new Map(members.map((member) => [member.id, member]));
    const objectById = new Map(objects.map((object) => [object.id, object]));
    const groups = collectGroupedItems(objects, objectGroups, "objectIds");
    const objectGroupById = new Map(groups.flatMap((group) => group.items.map((object) => [object.id, group] as const)));
    return { memberById, objectById, groups, objectGroupById };
  }, [members, objects, objectGroups]);
  const model = useMemo(() => {
    const { memberById } = catalog;
    const visibleIds = new Set(objects.filter((object) => (objectStates[object.id]?.visible ?? object.visible) !== false).map((object) => object.id));
    const assignments = new Map<string, Member[]>();
    const objectsByMember = new Map<string, StageObject[]>();
    const assigned = new Set<string>();
    const differences: Array<{ id: string; before: string[]; after: string[] }> = [];
    let unassignedCount = 0;
    for (const object of objects) {
      const valid = [...new Set(currentFrame?.objectAssignments?.[object.id] ?? [])].filter((id) => memberById.has(id));
      const validSet = new Set(valid);
      assignments.set(object.id, valid.map((id) => memberById.get(id)!));
      if (!visibleIds.has(object.id)) continue;
      if (!valid.length) unassignedCount++;
      valid.forEach((id) => {
        assigned.add(id);
        const tools = objectsByMember.get(id) ?? [];
        tools.push(object);
        objectsByMember.set(id, tools);
      });
      if (previousFrame && (previousObjectStates[object.id]?.visible ?? object.visible) !== false) {
        const previous = [...new Set(previousFrame.objectAssignments?.[object.id] ?? [])].filter((id) => memberById.has(id));
        if (previous.length && (previous.length !== valid.length || previous.some((id) => !validSet.has(id)))) {
          differences.push({ id: object.id, before: [...valid].sort(), after: previous.sort() });
        }
      }
    }
    return { ...catalog, visibleIds, assignments, objectsByMember,
      assignedCount: assigned.size, unassignedCount, differences,
      overwriteCount: differences.filter((entry) => entry.before.length > 0).length,
      fingerprint: JSON.stringify([currentFrame?.id, previousFrame?.id, differences]),
    };
  }, [catalog, objects, objectStates, currentFrame, previousFrame, previousObjectStates]);
  const initialObjects = model.groups.flatMap((group) => group.items).filter((object) => model.visibleIds.has(object.id));
  const initial = initialObjects.find((object) => !model.assignments.get(object.id)?.length) ?? initialObjects[0];
  const selected = selection && (!selection.wasVisible || model.visibleIds.has(selection.id))
    ? model.objectById.get(selection.id) : undefined;
  // Resolve invalid selection before rendering an editor; the effect makes it persistent.
  const selectedObject = selected ?? initial;
  const selectedVisible = !!selectedObject && model.visibleIds.has(selectedObject.id);
  const assigned = selectedObject ? model.assignments.get(selectedObject.id) ?? [] : [];
  const assignedIds = useMemo(() => new Set(assigned.map((member) => member.id)), [assigned]);
  const otherObjects = useMemo(() => new Map([...model.objectsByMember].map(([id, tools]) =>
    [id, tools.filter((object) => object.id !== selectedObject?.id)],
  )), [model.objectsByMember, selectedObject?.id]);
  const latest = useRef({ props, model });
  latest.current = { props, model };
  const disabled = !canEditAssignments || !currentFrame || busy;
  const sceneIndex = frames.findIndex((frame) => frame.id === currentFrame?.id);

  useEffect(() => {
    if (!selected) {
      setSelection(initial ? { id: initial.id, wasVisible: true } : null);
      setShowDetail(false);
    }
  }, [selected, initial?.id]);
  useEffect(() => {
    setNotice("");
    setRetainedId(undefined);
    confirmResolver.current?.(false);
    confirmResolver.current = null;
    setConfirmCount(null);
  }, [currentFrame?.id]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; confirmResolver.current?.(false); };
  }, []);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = (width: number) => { if (width > 0) { setNarrow(width < 760); setRootWidth(Math.floor(width)); } };
    measure(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => measure(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!narrow || !showDetail) {
      if (listRef.current) listRef.current.scrollTop = listScroll.current;
      if (restoreListFocus.current) {
        restoreListFocus.current = false;
        listRef.current?.querySelector<HTMLButtonElement>('.roster-assignment-row[aria-pressed="true"]')?.focus({ preventScroll: true });
      }
    } else detailRef.current?.focus({ preventScroll: true });
  }, [narrow, showDetail]);
  useEffect(() => {
    if (confirmCount !== null) cancelRef.current?.focus();
    else if (!busy && returnConfirmFocus.current) {
      returnConfirmFocus.current = false;
      const button = rootRef.current?.querySelector<HTMLButtonElement>("[data-apply-previous]");
      if (button && !button.disabled) button.focus({ preventScroll: true });
      else rootRef.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
    }
  }, [confirmCount, busy]);
  const finishConfirm = (value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmCount(null);
    returnConfirmFocus.current = true;
  };
  const run = async (action: () => void | boolean | Promise<boolean | void>) => {
    if (pending.current || !latest.current.props.canEditAssignments || !latest.current.props.currentFrame) return;
    pending.current = true;
    setBusy(true);
    setNotice("");
    const sceneId = latest.current.props.currentFrame.id;
    try {
      const result = await action();
      if (mounted.current && latest.current.props.currentFrame?.id === sceneId && result === false) {
        setNotice("変更は反映されませんでした。現在の割当を確認してください。");
      }
    } catch {
      if (mounted.current && latest.current.props.currentFrame?.id === sceneId) setNotice("変更できませんでした。もう一度お試しください。");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const toggleMember = (id: string) => {
    if (disabled || !selectedObject || !selectedVisible) return;
    if (unassignedOnly && !assignedIds.size) setRetainedId(selectedObject.id);
    void run(() => assignedIds.has(id)
      ? props.onRemoveAssignment(selectedObject.id, id, false)
      : props.onAssignMember(selectedObject.id, id));
  };
  const applyPrevious = () => void run(async () => {
    const frameId = latest.current.props.currentFrame?.id;
    while (mounted.current) {
      const snapshot = latest.current;
      if (!snapshot.props.canEditAssignments || snapshot.props.currentFrame?.id !== frameId || !snapshot.model.differences.length) return;
      if (snapshot.model.overwriteCount) {
        const confirmed = await new Promise<boolean>((resolve) => {
          confirmResolver.current = resolve;
          setConfirmCount(snapshot.model.overwriteCount);
        });
        if (!confirmed || !mounted.current) return;
        if (latest.current.model.fingerprint !== snapshot.model.fingerprint) continue;
      }
      if (!latest.current.props.canEditAssignments || latest.current.props.currentFrame?.id !== frameId) return;
      return latest.current.props.onApplyPreviousAssignments();
    }
  });

  return <section className={`roster-assignment-view${narrow ? " is-narrow" : ""}${project ? " has-scene-preview" : ""}`} ref={rootRef}
    aria-label="道具名簿の割当" aria-busy={busy}
    onKeyDownCapture={(event) => {
      if (confirmCount === null) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishConfirm(false); }
      if (event.key === "Tab") {
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(".app-confirm-dialog button");
        if ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons[1])) {
          event.preventDefault(); buttons[event.shiftKey ? 1 : 0]?.focus();
        }
      }
    }}>
    <header className="roster-assignment-toolbar">
      {!canEditAssignments && <p className="roster-assignment-readonly">{readOnlyMessage}</p>}
      <div className="roster-assignment-scenes">
        <button type="button" disabled={sceneIndex <= 0} onClick={() => onSelectFrame(frames[sceneIndex - 1].id)}>◀ 前のシーン</button>
        <select aria-label="割当するシーン" value={currentFrame?.id ?? ""} disabled={!frames.length}
          onChange={(event) => onSelectFrame(event.target.value)}>
          {!currentFrame && <option value="">シーンを選択</option>}
          {frames.map((frame) => <option key={frame.id} value={frame.id}>{frame.label}・{sceneTime(frame.timeSec)}</option>)}
        </select>
        <span className="roster-assignment-scene-count">{sceneIndex + 1}/{frames.length}</span>
        <button type="button" disabled={sceneIndex < 0 || sceneIndex >= frames.length - 1}
          onClick={() => onSelectFrame(frames[sceneIndex + 1].id)}>次のシーン ▶</button>
      </div>
      <div className="roster-assignment-secondary">
        <span className="roster-assignment-summary" aria-label="割当の集計">表示中 {model.visibleIds.size}個・担当者なし {model.unassignedCount}個・担当者 {model.assignedCount}人</span>
        <div>
          <button type="button" data-apply-previous disabled={disabled || !model.differences.length} onClick={applyPrevious}>前シーンの割当を反映</button>
          <button type="button" disabled={disabled || !canUndo || !onUndo} onClick={() => { if (!disabled && canUndo) void run(() => onUndo?.()); }}>元に戻す</button>
        </div>
      </div>
      {notice && <p role="status" className="roster-assignment-help">{notice}</p>}
    </header>
    {project && (currentFrame || frames.length > 0) && <div className="roster-assignment-media">
      {currentFrame && <RosterAssignmentStagePreview project={project} frame={currentFrame}
        highlightedObjectId={selectedObject?.id} maxWidth={rootWidth * (narrow ? 0.5 : 0.45)}
        maxHeight={rosterPreviewHeight(typeof window === "undefined" ? 900 : window.innerHeight)} />}
      {frames.length > 0 && <RosterAssignmentSceneStrip project={project} frames={frames}
        selectedFrameId={currentFrame?.id ?? null} onSelectFrame={onSelectFrame} />}
    </div>}
    <div className="roster-assignment-body">
      <div className="roster-assignment-list" ref={listRef} hidden={narrow && showDetail}
        onScroll={(event) => { if (!narrow || !showDetail) listScroll.current = event.currentTarget.scrollTop; }}>
        {!objects.length && <p className="empty-state">道具がありません。名前の編集で道具を追加してください。</p>}
        {!!objects.length && !model.visibleIds.size && <p className="empty-state compact">このシーンで表示中の道具はありません。</p>}
        <RosterAssignmentList groups={model.groups} visibleIds={model.visibleIds} assignments={model.assignments}
          selectedId={selectedObject?.id} retainedId={retainedId === selectedObject?.id ? retainedId : undefined}
          query={query} onQuery={setQuery} unassignedOnly={unassignedOnly}
          onFilter={(value) => { setUnassignedOnly(value); if (value !== unassignedOnly) setRetainedId(undefined); }}
          hiddenOpen={hiddenOpen} onHiddenOpen={setHiddenOpen} onSelect={(object) => {
            if (listRef.current) listScroll.current = listRef.current.scrollTop;
            setSelection({ id: object.id, wasVisible: model.visibleIds.has(object.id) });
            setShowDetail(true);
          }} />
      </div>
      <section className="roster-assignment-detail" aria-label="選択中の道具の割当" ref={detailRef} tabIndex={-1} hidden={narrow && !showDetail}>
        {narrow && <button type="button" className="roster-assignment-back" onClick={() => { restoreListFocus.current = true; setShowDetail(false); }}>← 道具一覧</button>}
        {selectedObject ? <RosterAssignmentDetail object={selectedObject} groupName={model.objectGroupById.get(selectedObject.id)?.label ?? "未所属"}
          members={members} assigned={assigned} assignedIds={assignedIds} groupIndex={groupIndex}
          otherObjectsByMember={otherObjects} visible={selectedVisible} disabled={disabled} onToggle={toggleMember}
          memberQuery={memberQuery} onMemberQuery={setMemberQuery}
          sceneVisibility={sceneVisibility} sceneId={currentFrame?.id} /> :
          <p className="empty-state">道具を選択すると、担当メンバーを編集できます。</p>}
        <p className="roster-assignment-help roster-assignment-footnote">割り当てると、このシーンでは隊列外になります。解除しても隊列には戻りません。</p>
      </section>
    </div>
    {confirmCount !== null && <div className="app-confirm-backdrop" onClick={() => finishConfirm(false)}>
      <section className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="前シーンの割当を反映" onClick={(event) => event.stopPropagation()}>
        <h2>前シーンの割当を反映</h2><p>{confirmCount}個の道具の担当が変わります。反映しますか？</p>
        <div className="app-confirm-dialog__actions">
          <button ref={cancelRef} type="button" className="secondary" onClick={() => finishConfirm(false)}>キャンセル</button>
          <button type="button" className="primary" onClick={() => finishConfirm(true)}>反映する</button>
        </div>
      </section>
    </div>}
  </section>;
};

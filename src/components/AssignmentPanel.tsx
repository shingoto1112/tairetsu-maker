import { useEffect, useMemo, useState } from "react";
import {
  FormationFrame,
  Member,
  MemberGroup,
  ObjectState,
  ObjectGroup,
  StageObject,
} from "../types";
import { formatTime } from "../utils/time";
import { PanelStickyHeader } from "./PanelStickyHeader";
import { ObjectAssignmentEditor, type AssignMember } from "./ObjectAssignmentEditor";
import { buildMemberGroupIndex, sortMembersForPicker } from "../utils/memberOrdering";
import { isMemberShownInScene } from "../utils/assignmentCandidates";
import type { MemberPickerSceneVisibility } from "./MemberPicker";

type AssignmentView = "objects" | "members";
type MemberSort = "total" | "assignments" | "hidden" | "group";

type AssignmentPanelProps = {
  memberGroups: MemberGroup[];
  frames: FormationFrame[];
  members: Member[];
  objects: StageObject[];
  objectGroups: ObjectGroup[];
  currentFrame: FormationFrame | null;
  previousFrame: FormationFrame | null;
  objectStates: Record<string, ObjectState>;
  previousObjectStates: Record<string, ObjectState>;
  /** Resolved visibility of the selected scene (snapshot), used to order assignment candidates. */
  memberVisibility?: Readonly<Record<string, boolean>>;
  canEditScene?: boolean;
  sceneReadOnlyMessage?: string;
  onAssignMember: AssignMember;
  onApplyPreviousAssignments: () => void;
  onRemoveAssignment: (
    objectId: string,
    memberId: string,
    restoreMember?: boolean,
  ) => void;
  onSelectFrame: (frameId: string) => void;
};

export const AssignmentPanel = ({
  memberGroups,
  frames,
  members,
  objects,
  objectGroups,
  currentFrame,
  previousFrame,
  objectStates,
  previousObjectStates,
  memberVisibility,
  canEditScene = true,
  sceneReadOnlyMessage = "編集するには、このシーンの編集ロックを取得してください。",
  onAssignMember,
  onApplyPreviousAssignments,
  onRemoveAssignment,
  onSelectFrame,
}: AssignmentPanelProps) => {
  const memberGroupIndex = useMemo(
    () => buildMemberGroupIndex(memberGroups),
    [memberGroups],
  );
  const [openPickerObjectId, setOpenPickerObjectId] = useState<string | null>(null);
  const [view, setView] = useState<AssignmentView>("objects");
  const [memberSort, setMemberSort] = useState<MemberSort>("total");
  // "非表示の人だけ" starts off each time the panel opens and survives prop/scene switches.
  const [hiddenMembersOnly, setHiddenMembersOnly] = useState(false);
  const sceneVisibility = useMemo<MemberPickerSceneVisibility | undefined>(() => memberVisibility && ({
    isShown: (member) => isMemberShownInScene(member, memberVisibility),
    hiddenOnly: hiddenMembersOnly,
    onHiddenOnlyChange: setHiddenMembersOnly,
  }), [memberVisibility, hiddenMembersOnly]);
  useEffect(() => { setOpenPickerObjectId(null); }, [currentFrame?.id, view]);
  const sceneDisabled = !canEditScene;

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const objectsById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const objectOrderById = useMemo(() => {
    const orderById = new Map<string, number>();
    let order = 0;
    objectGroups.forEach((group, groupIndex) => {
      group.objectIds.forEach((objectId, objectIndex) => {
        if (!orderById.has(objectId)) {
          orderById.set(objectId, groupIndex * 10000 + objectIndex);
        }
      });
      order = Math.max(order, (groupIndex + 1) * 10000);
    });
    objects
      .filter((object) => !orderById.has(object.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
      .forEach((object) => {
        orderById.set(object.id, order);
        order += 1;
      });
    return orderById;
  }, [objectGroups, objects]);
  const currentAssignments = currentFrame?.objectAssignments ?? {};
  const visibleObjectsInCurrentFrame = useMemo(
    () =>
      objects
        .filter(
          (object) =>
            (objectStates[object.id]?.visible ?? object.visible ?? true) !== false,
        )
        .sort((a, b) => {
          const orderA = objectOrderById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const orderB = objectOrderById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return (
            orderA - orderB ||
            a.name.localeCompare(b.name, "ja", { numeric: true })
          );
        }),
    [objectOrderById, objectStates, objects],
  );
  const previousAssignments = previousFrame?.objectAssignments ?? {};
  const transferablePreviousAssignmentCount = useMemo(
    () =>
      objects.filter((object) => {
        const currentVisible =
          (objectStates[object.id]?.visible ?? object.visible ?? true) !== false;
        const previousVisible =
          (previousObjectStates[object.id]?.visible ?? object.visible ?? true) !==
          false;
        const hasValidAssignment = (previousAssignments[object.id] ?? []).some(
          (memberId) => membersById.has(memberId),
        );
        return currentVisible && previousVisible && hasValidAssignment;
      }).length,
    [
      membersById,
      objectStates,
      objects,
      previousAssignments,
      previousObjectStates,
    ],
  );

  const memberSummaries = useMemo(() => {
    const summaries = members.map((member) => {
      const assignedScenes = frames
        .map((frame) => {
          const assignedObjects = Object.entries(frame.objectAssignments ?? {})
            .filter(([, memberIds]) => memberIds.includes(member.id))
            .map(([objectId]) => objectsById.get(objectId)?.name ?? "不明な道具");
          return assignedObjects.length > 0
            ? { frame, objectNames: assignedObjects }
            : null;
        })
        .filter(
          (
            item,
          ): item is {
            frame: FormationFrame;
            objectNames: string[];
          } => item !== null,
        );
      const assignedFrameIds = new Set(
        assignedScenes.map(({ frame }) => frame.id),
      );
      const hiddenScenes = frames.filter(
        (frame) =>
          !assignedFrameIds.has(frame.id) &&
          frame.memberVisibility?.[member.id] === false,
      );
      return {
        member,
        assignedScenes,
        hiddenScenes,
        totalCount: assignedScenes.length + hiddenScenes.length,
      };
    });

    if (memberSort === "group") {
      // Same order as the member tab: groups, then order within a group, then ungrouped members.
      const rank = new Map(sortMembersForPicker(members, "group", memberGroupIndex).map((member, index) => [member.id, index]));
      return [...summaries].sort((a, b) => (rank.get(a.member.id) ?? 0) - (rank.get(b.member.id) ?? 0));
    }
    return [...summaries].sort((a, b) => {
      if (memberSort === "assignments") {
        return (
          b.assignedScenes.length - a.assignedScenes.length ||
          a.member.name.localeCompare(b.member.name, "ja")
        );
      }
      if (memberSort === "hidden") {
        return (
          b.hiddenScenes.length - a.hiddenScenes.length ||
          a.member.name.localeCompare(b.member.name, "ja")
        );
      }
      return (
        b.totalCount - a.totalCount ||
        a.member.name.localeCompare(b.member.name, "ja")
      );
    });
  }, [frames, memberSort, members, memberGroupIndex, objectsById]);

  const currentFrameMeta = currentFrame
    ? `現在: ${currentFrame.label} / ${formatTime(currentFrame.timeSec)}`
    : "現在シーンがありません";

  const renderObjectView = () => {
    if (!currentFrame) {
      return (
        <section className="panel-section">
          <p className="muted-text">割当を編集するシーンを選択してください。</p>
        </section>
      );
    }

    return (
      <section className="assignment-tab-list" aria-label="道具別割当">
        <div className="assignment-sync-panel">
          <div>
            <h3>前シーンの割当</h3>
            <p>
              直前シーンでも表示中の道具だけ、同じ割当メンバーを現在シーンへ反映します。
            </p>
            <span>
              {previousFrame
                ? `直前: ${previousFrame.label} / ${formatTime(previousFrame.timeSec)}`
                : "直前シーンがありません"}
            </span>
          </div>
          <button
            className="mini-button"
            type="button"
            disabled={
              sceneDisabled ||
              !previousFrame ||
              transferablePreviousAssignmentCount === 0
            }
            title={sceneDisabled ? sceneReadOnlyMessage : undefined}
            onClick={onApplyPreviousAssignments}
          >
            前シーンの割当を反映
          </button>
          {previousFrame && transferablePreviousAssignmentCount === 0 ? (
            <small>反映できる表示中道具の割当はありません。</small>
          ) : null}
        </div>
        {objects.length === 0 ? (
          <div className="empty-state">道具がありません。</div>
        ) : visibleObjectsInCurrentFrame.length === 0 ? (
          <div className="empty-state">
            このシーンで表示中の道具はありません。表示中の道具だけ割当できます。
          </div>
        ) : (
          visibleObjectsInCurrentFrame.map((object) => {
            const assignedMemberIds = currentAssignments[object.id] ?? [];
            return (
              <article className="list-card assignment-object-card" key={object.id}>
                <div className="list-card__row">
                  <span
                    className="color-dot square"
                    style={{ backgroundColor: object.color }}
                    aria-hidden="true"
                  />
                  <strong>{object.name}</strong>
                </div>
                <ObjectAssignmentEditor
                  key={`${currentFrame.id}:${object.id}`}
                  objectId={object.id}
                  members={members}
                  assignedMemberIds={assignedMemberIds}
                  groupIndex={memberGroupIndex}
                  isPickerOpen={openPickerObjectId === object.id}
                  onPickerOpenChange={(isOpen) => setOpenPickerObjectId(isOpen ? object.id : null)}
                  disabled={sceneDisabled}
                  readOnlyMessage={sceneReadOnlyMessage}
                  onAssignMember={onAssignMember}
                  onRemoveAssignment={onRemoveAssignment}
                  sceneVisibility={sceneVisibility}
                  sceneId={currentFrame.id}
                />
              </article>
            );
          })
        )}
      </section>
    );
  };

  const renderMemberView = () => (
    <section className="assignment-tab-list" aria-label="メンバー別割当">
      <div className="panel-section__header">
        <h3>メンバー別</h3>
        <label className="sticky-select-label">
          並び替え
          <select
            value={memberSort}
            onChange={(event) => setMemberSort(event.target.value as MemberSort)}
          >
            <option value="total">道具＋非表示が多い順</option>
            <option value="assignments">道具担当が多い順</option>
            <option value="hidden">非表示が多い順</option>
            <option value="group">グループ順</option>
          </select>
        </label>
      </div>
      {memberSummaries.map(({ member, assignedScenes, hiddenScenes }) => (
        <article className="list-card assignment-member-card" key={member.id}>
          <div className="list-card__row">
            <span
              className="color-dot"
              style={{ backgroundColor: member.color }}
              aria-hidden="true"
            />
            <strong>{member.name}</strong>
          </div>
          <div className="assignment-member-sections">
            <div>
              <h4>道具</h4>
              <div className="assignment-summary-chip-list">
                {assignedScenes.length === 0 ? (
                  <span className="muted-text">なし</span>
                ) : (
                  assignedScenes.map(({ frame, objectNames }) => (
                    <button
                      className="assignment-summary-chip is-object"
                      type="button"
                      key={frame.id}
                      onClick={() => onSelectFrame(frame.id)}
                    >
                      {frame.label}: {objectNames.join(" / ")}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div>
              <h4>非表示</h4>
              <div className="assignment-summary-chip-list">
                {hiddenScenes.length === 0 ? (
                  <span className="muted-text">なし</span>
                ) : (
                  hiddenScenes.map((frame) => (
                    <button
                      className="assignment-summary-chip is-hidden"
                      type="button"
                      key={frame.id}
                      onClick={() => onSelectFrame(frame.id)}
                    >
                      {frame.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );

  return (
    <div className="assignment-tab">
      <PanelStickyHeader
        title="割当"
        meta={currentFrameMeta}
        actions={
          <>
            <div className="member-visibility-tabs" role="tablist" aria-label="割当表示">
              <button
                className={view === "objects" ? "is-active" : ""}
                type="button"
                onClick={() => setView("objects")}
              >
                道具別
              </button>
              <button
                className={view === "members" ? "is-active" : ""}
                type="button"
                onClick={() => setView("members")}
              >
                メンバー別
              </button>
            </div>
          </>
        }
      />
      {sceneDisabled && <p className="notice warning">{sceneReadOnlyMessage}</p>}
      {view === "objects" ? renderObjectView() : renderMemberView()}
    </div>
  );
};

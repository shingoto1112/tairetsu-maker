import { UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  FormationFrame,
  Member,
  ObjectState,
  StageObject,
} from "../types";
import { formatTime } from "../utils/time";
import { PanelStickyHeader } from "./PanelStickyHeader";

type AssignmentView = "objects" | "members";
type MemberSort = "total" | "assignments" | "hidden" | "name";

type AssignmentPanelProps = {
  frames: FormationFrame[];
  members: Member[];
  objects: StageObject[];
  currentFrame: FormationFrame | null;
  objectStates: Record<string, ObjectState>;
  onAssignMember: (objectId: string, memberId: string) => void;
  onRemoveAssignment: (
    objectId: string,
    memberId: string,
    restoreMember?: boolean,
  ) => void;
  onSelectFrame: (frameId: string) => void;
};

export const AssignmentPanel = ({
  frames,
  members,
  objects,
  currentFrame,
  objectStates,
  onAssignMember,
  onRemoveAssignment,
  onSelectFrame,
}: AssignmentPanelProps) => {
  const [view, setView] = useState<AssignmentView>("objects");
  const [memberSort, setMemberSort] = useState<MemberSort>("total");
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>(
    {},
  );

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const objectsById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const currentAssignments = currentFrame?.objectAssignments ?? {};
  const visibleObjectsInCurrentFrame = useMemo(
    () =>
      objects.filter(
        (object) =>
          (objectStates[object.id]?.visible ?? object.visible ?? true) !== false,
      ),
    [objectStates, objects],
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

    return [...summaries].sort((a, b) => {
      if (memberSort === "name") {
        return a.member.name.localeCompare(b.member.name, "ja");
      }
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
  }, [frames, memberSort, members, objectsById]);

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
        {objects.length === 0 ? (
          <div className="empty-state">道具がありません。</div>
        ) : visibleObjectsInCurrentFrame.length === 0 ? (
          <div className="empty-state">
            このシーンで表示中の道具はありません。表示中の道具だけ割当できます。
          </div>
        ) : (
          visibleObjectsInCurrentFrame.map((object) => {
            const assignedMemberIds = currentAssignments[object.id] ?? [];
            const assignableMembers = members.filter(
              (member) => !assignedMemberIds.includes(member.id),
            );
            const draftMemberId = assignmentDrafts[object.id] ?? "";
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
                <div className="assignment-chip-list">
                  {assignedMemberIds.length === 0 ? (
                    <span className="muted-text">割当なし</span>
                  ) : (
                    assignedMemberIds.map((memberId) => {
                      const member = membersById.get(memberId);
                      if (!member) return null;
                      return (
                        <span className="assignment-chip" key={memberId}>
                          {member.name}
                          <button
                            type="button"
                            onClick={() =>
                              onRemoveAssignment(object.id, memberId, false)
                            }
                            aria-label={`${member.name} の割当を解除`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>
                <div className="assignment-picker">
                  <select
                    value={draftMemberId}
                    disabled={assignableMembers.length === 0}
                    onChange={(event) =>
                      setAssignmentDrafts((previous) => ({
                        ...previous,
                        [object.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">
                      {assignableMembers.length === 0
                        ? "割当できるメンバーなし"
                        : "メンバーを選択"}
                    </option>
                    {assignableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="mini-button"
                    type="button"
                    disabled={!draftMemberId}
                    onClick={() => {
                      if (!draftMemberId) return;
                      onAssignMember(object.id, draftMemberId);
                      setAssignmentDrafts((previous) => ({
                        ...previous,
                        [object.id]: "",
                      }));
                    }}
                  >
                    <UserPlus size={15} />
                    割当
                  </button>
                </div>
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
            <option value="name">名前順</option>
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
        }
      />
      {view === "objects" ? renderObjectView() : renderMemberView()}
    </div>
  );
};

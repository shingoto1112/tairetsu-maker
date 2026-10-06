import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Member } from "../types";
import {
  sortMembersForPicker,
  type MemberGroupIndex,
  type MemberPickerOrder,
} from "../utils/memberOrdering";
import { splitBySceneVisibility } from "../utils/assignmentCandidates";
import "./assignmentMemberSelection.css";

import { useMemberPickerOrder } from "../hooks/useMemberPickerOrder";
const orders: Array<{ value: MemberPickerOrder; label: string }> = [
  { value: "group", label: "グループ順" },
  { value: "name", label: "名前順" },
];

/**
 * Optional scene-aware mode for prop assignment: members hidden in the scene
 * come first, shown members follow (faded, "表示中"), and "非表示の人だけ"
 * narrows the list. The filter state is owned by the caller so it survives
 * switching props/scenes.
 */
export type MemberPickerSceneVisibility = {
  isShown: (member: Member) => boolean;
  hiddenOnly: boolean;
  onHiddenOnlyChange: (hiddenOnly: boolean) => void;
};

type MemberPickerProps = {
  members: Member[];
  groupIndex: MemberGroupIndex;
  selectedMemberId: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (memberId: string) => void;
  disabled?: boolean;
  title?: string;
  sceneVisibility?: MemberPickerSceneVisibility;
};

type Section = { key: "all" | "hidden" | "shown"; label?: string; members: Member[] };

export const MemberPicker = ({
  members,
  groupIndex,
  selectedMemberId,
  isOpen,
  onOpenChange,
  onSelect,
  disabled = false,
  title,
  sceneVisibility,
}: MemberPickerProps) => {
  const [order, selectOrder] = useMemberPickerOrder();
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selectedMember = members.find((member) => member.id === selectedMemberId);
  const unavailable = disabled || members.length === 0;
  const expanded = isOpen && !unavailable;
  const isShown = sceneVisibility?.isShown;
  const hiddenOnly = sceneVisibility?.hiddenOnly ?? false;

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  const sections = useMemo<Section[]>(() => {
    const sorted = sortMembersForPicker(
      members.filter((member) => member.name.includes(query)),
      order,
      groupIndex,
    );
    if (!isShown) return [{ key: "all", members: sorted }];
    const { hidden, shown } = splitBySceneVisibility(sorted, isShown);
    const result: Section[] = [{ key: "hidden", label: "このシーンで非表示の人", members: hidden }];
    if (!hiddenOnly) result.push({ key: "shown", label: "表示中の人（割り当てると非表示になります）", members: shown });
    return result;
  }, [members, query, order, groupIndex, isShown, hiddenOnly]);
  const candidateCount = sections.reduce((total, section) => total + section.members.length, 0);

  const renderMembers = (section: Section) => {
    const counts = new Map<number, number>();
    section.members.forEach((member) => {
      const key = groupIndex.get(member.id)?.groupIndex ?? -1;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const shownSection = section.key === "shown";
    return section.members.map((member, memberIndex) => {
      const membership = groupIndex.get(member.id);
      const key = membership?.groupIndex ?? -1;
      const previousKey = memberIndex > 0
        ? groupIndex.get(section.members[memberIndex - 1].id)?.groupIndex ?? -1
        : undefined;
      const color = membership?.group.color ?? "#94a3b8";
      const groupName = membership?.group.name ?? "未所属";
      return (
        <Fragment key={member.id}>
          {order === "group" && key !== previousKey && (
            <div className="member-picker__heading">
              <span
                className="color-dot"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span>{groupName}</span>
              <small>{counts.get(key)}人</small>
            </div>
          )}
          <button
            className={`member-picker__candidate${shownSection ? " is-shown-in-scene" : ""}`}
            type="button"
            aria-label={`${member.name} ${groupName}${shownSection ? " 表示中" : ""}`}
            style={{ boxShadow: `inset 4px 0 0 ${color}` }}
            onClick={() => {
              onSelect(member.id);
              onOpenChange(false);
              triggerRef.current?.focus();
            }}
          >
            <span>{member.name}</span>
            {shownSection && <em className="member-picker__shown-badge" aria-hidden="true">表示中</em>}
            <small>{groupName}</small>
          </button>
        </Fragment>
      );
    });
  };

  return (
    <div
      className="member-picker"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        className="member-picker__trigger"
        type="button"
        disabled={unavailable}
        title={title}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        style={selectedMember
          ? { borderColor: groupIndex.get(selectedMember.id)?.group.color ?? "#94a3b8" }
          : undefined}
        onClick={() => onOpenChange(!isOpen)}
      >
        {members.length === 0
          ? "割当できるメンバーなし"
          : selectedMember?.name ?? "メンバーを選択"}
      </button>
      {expanded && (
        <div className="member-picker__panel" id={panelId}>
          <input
            type="search"
            aria-label="メンバー名を検索"
            placeholder="名前で検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="member-picker__orders" role="group" aria-label="候補の並び順">
            {orders.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={order === value}
                onClick={() => selectOrder(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {sceneVisibility && (
            <label className="member-picker__hidden-only">
              <input
                type="checkbox"
                checked={hiddenOnly}
                onChange={(event) => sceneVisibility.onHiddenOnlyChange(event.target.checked)}
              />
              このシーンで非表示の人だけ
            </label>
          )}
          <div className="member-picker__list" aria-label="メンバー候補">
            {candidateCount === 0 && (
              <p className="muted-text">
                {sceneVisibility && hiddenOnly && !query
                  ? "このシーンで非表示の人はいません。「このシーンで非表示の人だけ」を外すと、表示中の人も選べます。"
                  : "該当するメンバーはいません。"}
              </p>
            )}
            {sections.map((section) => section.members.length > 0 && (
              <Fragment key={section.key}>
                {section.label && <p className="member-picker__section">{section.label}</p>}
                {renderMembers(section)}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Member } from "../types";
import {
  sortMembersForPicker,
  type MemberGroupIndex,
  type MemberPickerOrder,
} from "../utils/memberOrdering";

import { useMemberPickerOrder } from "../hooks/useMemberPickerOrder";
const orders: Array<{ value: MemberPickerOrder; label: string }> = [
  { value: "group", label: "グループ順" },
  { value: "name", label: "名前順" },
];

type MemberPickerProps = {
  members: Member[];
  groupIndex: MemberGroupIndex;
  selectedMemberId: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (memberId: string) => void;
  disabled?: boolean;
  title?: string;
};

export const MemberPicker = ({
  members,
  groupIndex,
  selectedMemberId,
  isOpen,
  onOpenChange,
  onSelect,
  disabled = false,
  title,
}: MemberPickerProps) => {
  const [order, selectOrder] = useMemberPickerOrder();
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selectedMember = members.find((member) => member.id === selectedMemberId);
  const unavailable = disabled || members.length === 0;
  const expanded = isOpen && !unavailable;

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  const visibleMembers = useMemo(
    () =>
      sortMembersForPicker(
        members.filter((member) => member.name.includes(query)),
        order,
        groupIndex,
      ),
    [members, query, order, groupIndex],
  );
  const groupCounts = useMemo(() => {
    const counts = new Map<number, number>();
    visibleMembers.forEach((member) => {
      const key = groupIndex.get(member.id)?.groupIndex ?? -1;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [visibleMembers, groupIndex]);

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
          <div className="member-picker__list" aria-label="メンバー候補">
            {visibleMembers.length === 0 && (
              <p className="muted-text">該当するメンバーはいません。</p>
            )}
            {visibleMembers.map((member, memberIndex) => {
              const membership = groupIndex.get(member.id);
              const key = membership?.groupIndex ?? -1;
              const previousKey = memberIndex > 0
                ? groupIndex.get(visibleMembers[memberIndex - 1].id)?.groupIndex ?? -1
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
                      <small>{groupCounts.get(key)}人</small>
                    </div>
                  )}
                  <button
                    className="member-picker__candidate"
                    type="button"
                    aria-label={`${member.name} ${groupName}`}
                    style={{ boxShadow: `inset 4px 0 0 ${color}` }}
                    onClick={() => {
                      onSelect(member.id);
                      onOpenChange(false);
                      triggerRef.current?.focus();
                    }}
                  >
                    <span>{member.name}</span>
                    <small>{groupName}</small>
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

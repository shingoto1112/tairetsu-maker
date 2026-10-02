import { collectGroupedItems } from "./rosterColumns";
import type { AssignmentSnapshot, ExportSource } from "./mobileExportTypes";

const sceneTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export const createAssignmentExportSnapshot = (
  source: ExportSource, scope: "current" | "all", date = new Date(),
): AssignmentSnapshot => {
  const frames = [...source.frames].sort((a, b) => a.timeSec - b.timeSec);
  if (scope === "current" && !source.currentFrame) throw new Error("シーンを選択してください。");
  const memberById = new Map(source.members.map((member) => [member.id, member]));
  const memberGroups = collectGroupedItems(source.members, source.memberGroups, "memberIds");
  const groupByMember = new Map(memberGroups.flatMap((group) => group.items.map((member) => [member.id, group.label] as const)));
  const objectGroups = collectGroupedItems(source.objects, source.objectGroups, "objectIds");
  const states = new Map(source.objects.map((object) => [object.id, object.visible]));
  const selected = scope === "all" ? frames : [source.currentFrame!];
  // Visibility inherits missing object states exactly as the canvas does.
  const visibility = new Map<string, Map<string, boolean>>();
  for (const frame of frames) {
    for (const [id, state] of Object.entries(frame.objectStates)) states.set(id, state.visible);
    visibility.set(frame.id, new Map(states));
  }
  const outputIds = new Set<string>();
  const rawScenes = selected.map((frame) => ({
    name: frame.label, time: sceneTime(frame.timeSec),
    groups: objectGroups.map((group) => ({
      name: group.label, color: group.color ?? "#94a3b8",
      tools: group.items.filter((object) => {
        const visible = scope === "current" ? source.objectStates[object.id]?.visible : undefined;
        return (visible ?? visibility.get(frame.id)?.get(object.id) ?? object.visible) !== false;
      }).map((object) => {
        const ids = [...new Set(frame.objectAssignments?.[object.id] ?? [])].filter((id) => memberById.has(id));
        ids.forEach((id) => outputIds.add(id));
        return { name: object.name, color: object.color, ids };
      }),
    })).filter((group) => group.tools.length),
  }));
  const nameCounts = new Map<string, number>();
  outputIds.forEach((id) => {
    const name = memberById.get(id)!.name;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  });
  return {
    title: source.projectTitle.trim() || "隊列メーカー", exportedAt: date.toISOString(),
    totalCount: rawScenes.reduce((sum, scene) => sum + scene.groups.reduce((n, group) => n + group.tools.length, 0), 0),
    scopeLabel: scope === "all" ? "全シーン" : source.currentFrame!.label,
    scenes: rawScenes.map((scene) => ({ ...scene, groups: scene.groups.map((group) => ({ ...group,
      tools: group.tools.map((tool) => ({ name: tool.name, color: tool.color,
        assignees: tool.ids.map((id) => {
          const member = memberById.get(id)!;
          return (nameCounts.get(member.name) ?? 0) > 1 ? `${member.name}（${groupByMember.get(id) ?? "未所属"}）` : member.name;
        }),
      })),
    })) })),
  };
};

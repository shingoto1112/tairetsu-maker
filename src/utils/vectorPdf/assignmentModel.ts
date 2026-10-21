import type { FormationFrame, Project } from "../../types";
import { objectRenderShape } from "../../project/objectAppearance";
import { getAssignmentPrintEntries } from "../printLayout";
import { getMemberDisplayColor, getReadableMemberLabelColor } from "../memberAppearance";
import { CSS_PX_MM, curtainStripes, printObjectShape, UnsupportedVectorLayout, type Drawing, type Rect, type TextLine } from "./model";

// Only CSS grid/flex wrapping and decoration bounds are measured. Data identities,
// visibility, order and colors always come from the existing print rules/project.
export type AssignmentLayout = {
  panel: Rect; gridMm: number;
  emptyText: TextLine[];
  entries: { objectId: string; object: Rect; name: TextLine[];
    members: { memberId: string; rect: Rect; lines: TextLine[]; shadow: Extract<Drawing, { kind: "image" }> }[] }[];
};

export function buildAssignmentDrawings(project: Project, frame: FormationFrame, layout: AssignmentLayout): Drawing[] {
  const { panel } = layout, border = CSS_PX_MM;
  const drawings: Drawing[] = [{ kind: "shape", ...panel, fill: "#ffffff" }];
  // CSS background origin is the inner border edge; gradient stripes repeat from it.
  const grid: Drawing[] = [];
  for (let x = panel.x + border; x < panel.x + panel.width; x += layout.gridMm)
    grid.push({ kind: "shape", x, y: panel.y + border, width: border, height: panel.height - 2 * border, fill: "#64748b", opacity: .14 });
  for (let y = panel.y + border; y < panel.y + panel.height; y += layout.gridMm)
    grid.push({ kind: "shape", x: panel.x + border, y, width: panel.width - 2 * border, height: border, fill: "#64748b", opacity: .14 });
  drawings.push({ kind: "group", id: "assignment-grid", x: 0, y: 0, rotation: 0, clip: panel, children: grid });
  drawings.push({ kind: "shape", x: panel.x + border / 2, y: panel.y + border / 2,
    width: panel.width - border, height: panel.height - border, stroke: "#94a3b8", lineWidth: border });
  const entries = getAssignmentPrintEntries(project, frame);
  if (!entries.length) return [...drawings, ...layout.emptyText];
  if (entries.length !== layout.entries.length) throw new UnsupportedVectorLayout("割当欄の計測件数が一致しません。");
  for (const [i, entry] of entries.entries()) {
    const measured = layout.entries[i];
    if (measured.objectId !== entry.object.id || measured.members.length !== entry.assignedMembers.length)
      throw new UnsupportedVectorLayout("割当欄の順序または人数が一致しません。");
    const shape = printObjectShape(objectRenderShape(entry.object));
    if (!/^#[0-9a-f]{6}$/i.test(entry.object.color)) throw new UnsupportedVectorLayout("割当道具色の形式が未対応です。");
    const r = measured.object, b = 1.4 * CSS_PX_MM;
    const radius = shape === "circle" ? Math.min(r.width, r.height) / 2 : 0;
    drawings.push({ kind: "group", id: `assignment-${entry.object.id}`, x: 0, y: 0, rotation: 0, children: [
      { kind: "shape", x: r.x + b / 2, y: r.y + b / 2, width: r.width - b, height: r.height - b,
        radius: Math.max(0, radius - b / 2), fill: entry.object.color, opacity: 0x24 / 255, stroke: entry.object.color, lineWidth: b },
      ...(shape === "curtain" ? curtainStripes(`assignment-${entry.object.id}`, r, b) : []),
      { kind: "group", id: `assignment-${entry.object.id}-label`, x: 0, y: 0, rotation: 0,
        children: measured.name },
    ] });
    for (const [j, member] of entry.assignedMembers.entries()) {
      const m = measured.members[j];
      if (m.memberId !== member.id) throw new UnsupportedVectorLayout("割当メンバーの計測順序が一致しません。");
      const color = getMemberDisplayColor(member, { frame, groups: project.memberGroups });
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new UnsupportedVectorLayout("割当メンバー色の形式が未対応です。");
      const ring = .45;
      drawings.push({ kind: "group", id: `assignment-${entry.object.id}-${member.id}`, x: 0, y: 0, rotation: 0, children: [
        m.shadow,
        { kind: "shape", ...m.rect, radius: m.rect.width / 2, fill: color },
        { kind: "shape", x: m.rect.x + ring / 2, y: m.rect.y + ring / 2,
          width: m.rect.width - ring, height: m.rect.height - ring, radius: (m.rect.width - ring) / 2,
          stroke: "#ffffff", strokeOpacity: .5, lineWidth: ring },
        ...m.lines.map(l => ({ ...l, color: getReadableMemberLabelColor(color) })),
      ] });
    }
  }
  return drawings;
}

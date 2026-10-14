import type { Project } from "../types";
import { constrainObjectPosition } from "../utils/coordinates";
import { horizontalGridOriginMeters, snapHorizontalPositionInBounds } from "../utils/horizontalGrid";
import { createDefaultObjectState } from "../utils/interpolation";
import { objectBaseSize, objectSizeLimits } from "./objectAppearance";

export type OversizedObjectPolicy = "shrink" | "exclude";
export type RosterCopyOptions = { includeObjects: boolean; oversizedPolicy?: OversizedObjectPolicy };
export type OversizedRosterObject = { id: string; name: string; widthMeters: number; heightMeters: number };

export function oversizedRosterObjects(source: Project, destination: Project): OversizedRosterObject[] {
  const limits = objectSizeLimits(destination);
  return source.stageObjects.flatMap(object => {
    const size = objectBaseSize(source, object);
    return size.widthMeters > limits.widthMeters || size.heightMeters > limits.heightMeters
      ? [{ id: object.id, name: object.name, ...size }] : [];
  });
}

/** Allowlist-only bulk recipe. The caller supplies fresh IDs; neither input is mutated.
 * Destination must be a newly created, empty project. No source scene or attachment is spread. */
export function copyRosterToNewProject(
  destination: Project, source: Project, options: RosterCopyOptions, newId: (prefix: string) => string,
): Project {
  if (destination.members.length || destination.stageObjects.length || destination.frames.length !== 1)
    throw new Error("名簿は空の新しい隊列表にコピーしてください。");
  const oversized = new Set(options.includeObjects ? oversizedRosterObjects(source, destination).map(object => object.id) : []);
  if (oversized.size && !options.oversizedPolicy) throw new Error("ステージに入らない道具の扱いを選んでください。");
  const limits = objectSizeLimits(destination);
  const membersById = new Map(source.members.map(member => [member.id, newId("m")]));
  const objectsToCopy = options.includeObjects ? source.stageObjects.filter(object =>
    options.oversizedPolicy !== "exclude" || !oversized.has(object.id)) : [];
  const objectsById = new Map(objectsToCopy.map(object => [object.id, newId("o")]));
  const remap = (ids: string[], map: Map<string, string>) => [...new Set(ids)].flatMap(id => map.has(id) ? [map.get(id)!] : []);
  const members = source.members.map((member, index) => ({
    id: membersById.get(member.id)!, name: member.name, color: member.color, visible: true, zIndex: 20 + index,
  }));
  const memberGroups = (source.memberGroups ?? []).map(group => ({
    id: newId("g"), name: group.name, color: group.color, memberIds: remap(group.memberIds, membersById),
  }));
  const stageObjects = objectsToCopy.map((object, index) => {
    const base = objectBaseSize(source, object);
    const size = options.oversizedPolicy === "shrink" ? {
      widthMeters: Math.min(base.widthMeters, limits.widthMeters), heightMeters: Math.min(base.heightMeters, limits.heightMeters),
    } : base;
    const position = constrainObjectPosition({ x: limits.widthMeters / 2 - size.widthMeters / 2,
      y: limits.heightMeters / 2 - size.heightMeters / 2 }, size.widthMeters, size.heightMeters, destination.stage);
    return { id: objectsById.get(object.id)!, name: object.name, color: object.color, type: object.type, shape: object.shape,
      ...size, defaultX: position.x, defaultY: position.y, defaultRotation: 0, visible: true, locked: false, zIndex: 10 + index };
  });
  const objectGroups = options.includeObjects ? (source.objectGroups ?? []).map(group => ({
    id: newId("og"), name: group.name, color: group.color, defaultType: group.defaultType, defaultShape: group.defaultShape,
    objectIds: remap(group.objectIds, objectsById),
  })) : [];
  // Same initial placement as a normal roster addition without a saved camera.
  const memberX = snapHorizontalPositionInBounds(limits.widthMeters / 2,
    destination.mode === "parade" ? destination.paradeSettings?.cellSizeMeters ?? destination.stage.gridSizeMeters
      : destination.stage.showGrid ? destination.stage.gridSizeMeters : NaN,
    horizontalGridOriginMeters(limits.widthMeters, destination.mode === "parade"
      ? destination.paradeSettings?.horizontalMeasureMode : destination.stage.horizontalGuideMode), 0, limits.widthMeters);
  const frame = destination.frames[0];
  return { ...destination, members, memberGroups, stageObjects, objectGroups, frames: [{ ...frame,
    positions: Object.fromEntries(members.map(member => [member.id, { x: memberX, y: limits.heightMeters / 2 }])),
    memberVisibility: Object.fromEntries(members.map(member => [member.id, false])),
    objectStates: Object.fromEntries(stageObjects.map(object => [object.id, { ...createDefaultObjectState(object), visible: false }])),
  }] };
}

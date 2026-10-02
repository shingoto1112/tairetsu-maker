import type { FormationFrame, Member, MemberGroup, ObjectGroup, ObjectState, Project, StageObject } from "../types";
import type { RosterExportSnapshot } from "./rosterExportSnapshot";

export type ExportTarget = "formation" | "members" | "objects" | "assignments";
export type ExportRequest = { target: ExportTarget; scope: "current" | "all"; purpose: "mobile" | "a4"; format: "png" | "pdf"; includeDetails?: boolean };
export type ExportSource = {
  projectTitle: string; members: Member[]; memberGroups: MemberGroup[];
  objects: StageObject[]; objectGroups: ObjectGroup[]; frames: FormationFrame[];
  currentFrame: FormationFrame | null; objectStates: Record<string, ObjectState>;
  project?: Project;
};
export type AssignmentTool = { name: string; color: string; assignees: string[] };
export type AssignmentSnapshot = {
  title: string; exportedAt: string; totalCount: number; scopeLabel: string;
  scenes: { name: string; time: string; groups: { name: string; color: string; tools: AssignmentTool[] }[] }[];
};
export type FormationSnapshot = { title: string; exportedAt: string; scopeLabel: string; project: Project };
export type ExportSnapshot = { target: "members" | "objects"; data: RosterExportSnapshot } | { target: "assignments"; data: AssignmentSnapshot } | { target: "formation"; data: FormationSnapshot };
export type GeneratedExport = {
  files: File[]; preview: Blob; targetLabel: string; scopeLabel: string; pageCount: number;
};
export type CompletedExport = Omit<GeneratedExport, "preview"> & { preview: Blob | null };
export type GenerationOptions = { signal: AbortSignal; onProgress: (message: string) => void };

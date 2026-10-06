import type { FormationFrame, Member, MemberGroup, ObjectGroup, ObjectState, Project, StageObject } from "../types";
import type { RosterExportSnapshot } from "./rosterExportSnapshot";

export type ExportTarget = "members";
export type ExportRequest = { target: ExportTarget; scope: "current" | "all"; purpose: "mobile" | "a4"; format: "png" | "pdf"; memberOverflow?: "single" | "readable" };
export type ExportSource = {
  projectTitle: string; members: Member[]; memberGroups: MemberGroup[];
  objects: StageObject[]; objectGroups: ObjectGroup[]; frames: FormationFrame[];
  currentFrame: FormationFrame | null; objectStates: Record<string, ObjectState>;
  project?: Project;
};
export type ExportSnapshot = { target: "members"; data: RosterExportSnapshot };
export type GeneratedExport = {
  files: File[]; preview: Blob; targetLabel: string; scopeLabel: string; pageCount: number;
};
export type CompletedExport = Omit<GeneratedExport, "preview"> & { preview: Blob | null };
export type GenerationOptions = { signal: AbortSignal; onProgress: (message: string) => void };

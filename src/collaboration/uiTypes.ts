import type { CloudConfig } from "../cloud/config";
import type { ProjectRecord, ProjectRepository, ProjectSummary } from "../repositories/types";
import type { Project } from "../types";
import type { SharedSessionController } from "./sharedSessionController";
import type { SharedSessionStore } from "../storage/sharedSessionState";
import type { CollaborationUiService } from "./uiService";
export type CollaborationUiOptions = {
  config: CloudConfig | null; platform: "web" | "ipad"; mock: boolean;
  repository: () => ProjectRepository | null;
  active: () => SharedSessionController | null;
  store: SharedSessionStore;
  open: (record: ProjectRecord, rescued?: { localId: string; projection: Project }) => Promise<boolean>;
  transform: (action: (localId: string) => Promise<ProjectRecord>) => Promise<void>;
  localRemoved: () => Promise<void>;
  summaries: () => ProjectSummary[];
};
export type CollaborationUiBridge = { options: CollaborationUiOptions | null; get: () => Promise<CollaborationUiService> };

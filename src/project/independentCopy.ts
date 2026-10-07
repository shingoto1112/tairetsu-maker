import type { Project } from "../types";
import type { CommitRequest } from "../repositories/types";
import { normalizeProject } from "./normalizeProject";
import { createProjectId } from "./defaults";

/** Copy references and internal IDs, never audio bytes or record attachments. */
export function prepareIndependentProjectCopy(source: Project, title = source.title): CommitRequest {
  const now = new Date().toISOString();
  const project = normalizeProject({ ...JSON.parse(JSON.stringify(source)) as Project,
    id: createProjectId(), title, createdAt: now, updatedAt: now, lastOpenedAt: now });
  return { project, collaboration: null, localRevision: "1", expectedRepositoryRevision: null, operationId: createProjectId() };
}

const canonicalContent = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalContent)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalContent(item)])) : value;

/** Opening/touching and safe missing-field normalization are not new edits.
 * Sort object keys so a CRDT projection of identical content reuses the copy. */
export const sharingContentKey = (project: Project) => {
  const { updatedAt: _updated, lastOpenedAt: _opened, ...content } = normalizeProject(project);
  return JSON.stringify(canonicalContent(content));
};

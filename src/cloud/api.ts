import type { CloudConfig } from "./config";
import type {
  CloudLockTarget,
  CloudProjectDraft,
  CloudProjectParts,
  CloudProjectResourceData,
  CloudProjectResourceDraft,
  CloudSceneDraft,
  CloudResourceKey,
  CloudSceneData,
} from "./types";

type RpcPayload = Record<string, unknown>;

export type CloudRpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export type CloudLockAcquireResult = {
  expires_at: string | null;
  locked_by: string | null;
  reason: string;
  success: boolean;
};

export type CloudHeartbeatResult = {
  expires_at: string | null;
  reason: string;
  success: boolean;
};

export type CloudReleaseResult = {
  reason: string;
  success: boolean;
};

export type CloudSaveResult = {
  reason: string;
  success: boolean;
  updated_at: string | null;
  version: number | null;
};

export type CloudImportResult = {
  reason: string;
  success: boolean;
  updated_at: string | null;
};

export type CloudActionResult = {
  reason: string;
  success: boolean;
};

export type CloudProjectCreateResult = {
  project_id: string | null;
  reason: string;
  success: boolean;
};

export type CloudProjectInviteCreateResult = {
  expires_at: string | null;
  invite_id: string | null;
  reason: string;
  success: boolean;
};

export type CloudProjectInviteAcceptResult = {
  project_id: string | null;
  reason: string;
  role: "editor" | "owner" | "viewer" | null;
  success: boolean;
};

export type CloudProjectSummary = {
  createdAt: string;
  id: string;
  legacyProjectId?: string;
  mode: "stage" | "parade";
  role: "owner" | "editor" | "viewer";
  schemaVersion: number;
  title: string;
  updatedAt: string;
};

type CloudProjectRow = {
  created_at: string;
  id: string;
  legacy_project_id?: string | null;
  mode: "stage" | "parade";
  schema_version: number;
  title: string;
  updated_at: string;
};

type CloudProjectMemberRow = {
  display_name?: string | null;
  hidden_at?: string | null;
  project_id: string;
  role: "owner" | "editor" | "viewer";
};

export type CloudCollaborationItem = {
  acceptedAt: string | null;
  createdAt: string;
  displayName: string | null;
  email: string | null;
  expiresAt: string | null;
  id: string;
  revokedAt: string | null;
  role: "editor" | "owner" | "viewer";
  type: "invite" | "member";
  userId: string | null;
};

type CloudCollaborationRow = {
  accepted_at: string | null;
  created_at: string;
  display_name?: string | null;
  email: string | null;
  expires_at: string | null;
  item_id: string;
  item_type: "invite" | "member";
  revoked_at: string | null;
  role: "editor" | "owner" | "viewer";
  user_id: string | null;
};

export type CloudActiveLockSummary = {
  expiresAt: string;
  lastActivityAt: string;
  lastHeartbeatAt: string;
  lockedAt: string;
  lockedBy: string;
  targetId: string;
  targetType: "project" | "scene";
};

type CloudActiveLockRow = {
  expires_at: string;
  last_activity_at: string;
  last_heartbeat_at: string;
  locked_at: string;
  locked_by: string;
  target_id: string;
  target_type: "project" | "scene";
};

type CloudProjectResourceRow = {
  data: unknown;
  resource_key: CloudResourceKey;
  schema_version: number;
  updated_at: string;
  updated_by?: string | null;
  version: number;
};

type CloudSceneRow = {
  data: unknown;
  scene_id: string;
  schema_version: number;
  updated_at: string;
  updated_by?: string | null;
  version: number;
};

export class CloudApiError extends Error {
  readonly details: CloudRpcError | null;
  readonly status: number;

  constructor(message: string, status: number, details: CloudRpcError | null) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.details = details;
  }
}

export type CloudApiClient = ReturnType<typeof createCloudApiClient>;

const readUserIdFromAccessToken = (accessToken: string | null): string | null => {
  if (!accessToken) {
    return null;
  }

  const payload = accessToken.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof parsed.sub === "string" ? parsed.sub : null;
  } catch {
    return null;
  }
};

const readDisplayName = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "名前未設定" || trimmed.includes("@")) {
    return null;
  }
  return trimmed;
};

export const createCloudApiClient = (
  config: CloudConfig,
  getAccessToken: () => string | null,
) => {
  const getAuthHeaders = (): HeadersInit => {
    const accessToken = getAccessToken();
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken ?? config.anonKey}`,
      "Content-Type": "application/json",
    };
  };

  const readErrorDetails = async (
    response: Response,
  ): Promise<CloudRpcError | null> => {
    try {
      return (await response.json()) as CloudRpcError;
    } catch {
      return null;
    }
  };

  const rpc = async <TResult>(
    functionName: string,
    payload: RpcPayload,
  ): Promise<TResult[]> => {
    const response = await fetch(`${config.url}/rest/v1/rpc/${functionName}`, {
      body: JSON.stringify(payload),
      headers: getAuthHeaders(),
      method: "POST",
    });

    if (!response.ok) {
      const details = await readErrorDetails(response);
      throw new CloudApiError(
        details?.message ?? "クラウド操作に失敗しました。",
        response.status,
        details,
      );
    }

    return (await response.json()) as TResult[];
  };

  const restGet = async <TResult>(path: string): Promise<TResult> => {
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
      headers: getAuthHeaders(),
      method: "GET",
    });

    if (!response.ok) {
      const details = await readErrorDetails(response);
      throw new CloudApiError(
        details?.message ?? "クラウドデータを読み込めませんでした。",
        response.status,
        details,
      );
    }

    return (await response.json()) as TResult;
  };

  const rpcOne = async <TResult>(
    functionName: string,
    payload: RpcPayload,
  ): Promise<TResult> => {
    const rows = await rpc<TResult>(functionName, payload);
    if (rows.length === 0) {
      throw new CloudApiError(
        "クラウド操作の結果が空でした。",
        200,
        null,
      );
    }
    return rows[0];
  };

  return {
    createCloudProject: (draft: CloudProjectDraft) =>
      rpcOne<CloudProjectCreateResult>("create_cloud_project", {
        p_legacy_project_id: draft.project.legacyProjectId ?? null,
        p_mode: draft.project.mode,
        p_resources: draft.resources,
        p_schema_version: draft.project.schemaVersion,
        p_scenes: draft.scenes,
        p_title: draft.project.title,
      }),

    acceptProjectInvite: (inviteToken: string) =>
      rpcOne<CloudProjectInviteAcceptResult>("accept_project_invite", {
        p_invite_token: inviteToken,
      }),

    createProjectInvite: (
      projectId: string,
      invitedEmail: string,
      role: "editor" | "viewer",
      inviteToken: string,
    ) =>
      rpcOne<CloudProjectInviteCreateResult>("create_project_invite", {
        p_invite_token: inviteToken,
        p_invited_email: invitedEmail,
        p_project_id: projectId,
        p_role: role,
      }),

    listCloudProjects: async (): Promise<CloudProjectSummary[]> => {
      const projects = await restGet<CloudProjectRow[]>(
        [
          "projects",
          "?select=id,title,mode,schema_version,legacy_project_id,created_at,updated_at",
          "&deleted_at=is.null",
          "&order=updated_at.desc",
        ].join(""),
      );
      const currentUserId = readUserIdFromAccessToken(getAccessToken());
      const membershipFilter = currentUserId
        ? `&user_id=eq.${encodeURIComponent(currentUserId)}`
        : "";
      let memberships: CloudProjectMemberRow[];
      try {
        memberships = await restGet<CloudProjectMemberRow[]>(
          [
            "project_members?select=project_id,role,display_name,hidden_at",
            membershipFilter,
          ].join(""),
        );
      } catch {
        memberships = await restGet<CloudProjectMemberRow[]>(
          [
            "project_members?select=project_id,role,display_name",
            membershipFilter,
          ].join(""),
        );
      }
      const visibleMemberships = memberships.filter(
        (membership) => !membership.hidden_at,
      );
      const roleByProjectId = new Map(
        visibleMemberships.map((membership) => [
          membership.project_id,
          membership.role,
        ]),
      );

      return projects
        .filter((project) => roleByProjectId.has(project.id))
        .map((project) => ({
          createdAt: project.created_at,
          id: project.id,
          legacyProjectId: project.legacy_project_id ?? undefined,
          mode: project.mode,
          role: roleByProjectId.get(project.id) ?? "viewer",
          schemaVersion: project.schema_version,
          title: project.title,
          updatedAt: project.updated_at,
        }));
    },

    listActiveEditLocks: async (
      projectId: string,
    ): Promise<CloudActiveLockSummary[]> => {
      const encodedProjectId = encodeURIComponent(projectId);
      const rows = await restGet<CloudActiveLockRow[]>(
        [
          "edit_locks",
          "?select=target_type,target_id,locked_by,locked_at,last_heartbeat_at,last_activity_at,expires_at",
          `&project_id=eq.${encodedProjectId}`,
          "&order=locked_at.asc",
        ].join(""),
      );
      return rows.map((row) => ({
        expiresAt: row.expires_at,
        lastActivityAt: row.last_activity_at,
        lastHeartbeatAt: row.last_heartbeat_at,
        lockedAt: row.locked_at,
        lockedBy: row.locked_by,
        targetId: row.target_id,
        targetType: row.target_type,
      }));
    },

    listProjectCollaboration: async (
      projectId: string,
    ): Promise<CloudCollaborationItem[]> => {
      const rows = await rpc<CloudCollaborationRow>(
        "list_project_collaboration",
        {
          p_project_id: projectId,
        },
      );
      return rows.map((row) => ({
        acceptedAt: row.accepted_at,
        createdAt: row.created_at,
        displayName: readDisplayName(row.display_name) ?? readDisplayName(row.email),
        email: row.email,
        expiresAt: row.expires_at,
        id: row.item_id,
        revokedAt: row.revoked_at,
        role: row.role,
        type: row.item_type,
        userId: row.user_id,
      }));
    },

    loadCloudProjectParts: async (
      projectId: string,
    ): Promise<CloudProjectParts> => {
      const encodedProjectId = encodeURIComponent(projectId);
      const projects = await restGet<CloudProjectRow[]>(
        [
          "projects",
          "?select=id,title,mode,schema_version,legacy_project_id,created_at,updated_at",
          `&id=eq.${encodedProjectId}`,
          "&deleted_at=is.null",
          "&limit=1",
        ].join(""),
      );
      const project = projects[0];
      if (!project) {
        throw new CloudApiError(
          "クラウドプロジェクトが見つかりませんでした。",
          404,
          null,
        );
      }

      const [resourceRows, sceneRows] = await Promise.all([
        restGet<CloudProjectResourceRow[]>(
          [
            "project_resources",
            "?select=resource_key,data,version,schema_version,updated_at,updated_by",
            `&project_id=eq.${encodedProjectId}`,
          ].join(""),
        ),
        restGet<CloudSceneRow[]>(
          [
            "scenes",
            "?select=scene_id,data,version,schema_version,updated_at,updated_by",
            `&project_id=eq.${encodedProjectId}`,
            "&order=created_at.asc",
          ].join(""),
        ),
      ]);

      const resources = Object.fromEntries(
        resourceRows.map((resource) => [
          resource.resource_key,
          {
            data: resource.data as CloudProjectResourceData[CloudResourceKey],
            resourceKey: resource.resource_key,
            schemaVersion: resource.schema_version,
            version: resource.version,
          } satisfies CloudProjectResourceDraft,
        ]),
      ) as CloudProjectParts["resources"];

      const scenes: CloudSceneDraft[] = sceneRows.map((scene) => ({
        data: scene.data as CloudSceneData,
        sceneId: scene.scene_id,
        schemaVersion: scene.schema_version,
        version: scene.version,
      }));

      return {
        createdAt: project.created_at,
        id: project.id,
        project: {
          legacyProjectId: project.legacy_project_id ?? undefined,
          mode: project.mode,
          schemaVersion: project.schema_version,
          title: project.title,
        },
        resources,
        scenes,
        updatedAt: project.updated_at,
      };
    },

    acquireEditLock: (
      projectId: string,
      target: CloudLockTarget,
      lockToken: string,
    ) =>
      rpcOne<CloudLockAcquireResult>("acquire_edit_lock", {
        p_lock_token: lockToken,
        p_project_id: projectId,
        p_target_id: target.targetId,
        p_target_type: target.targetType,
      }),

    forceReleaseEditLock: (projectId: string, target: CloudLockTarget) =>
      rpcOne<CloudReleaseResult>("force_release_edit_lock", {
        p_project_id: projectId,
        p_target_id: target.targetId,
        p_target_type: target.targetType,
      }),

    heartbeatEditLock: (
      projectId: string,
      target: CloudLockTarget,
      lockToken: string,
      hasActivity = false,
    ) =>
      rpcOne<CloudHeartbeatResult>("heartbeat_edit_lock", {
        p_has_activity: hasActivity,
        p_lock_token: lockToken,
        p_project_id: projectId,
        p_target_id: target.targetId,
        p_target_type: target.targetType,
      }),

    releaseEditLock: (
      projectId: string,
      target: CloudLockTarget,
      lockToken: string,
    ) =>
      rpcOne<CloudReleaseResult>("release_edit_lock", {
        p_lock_token: lockToken,
        p_project_id: projectId,
        p_target_id: target.targetId,
        p_target_type: target.targetType,
      }),

    requestLockTakeover: (projectId: string, target: CloudLockTarget) =>
      rpcOne<CloudActionResult>("request_lock_takeover", {
        p_project_id: projectId,
        p_target_id: target.targetId,
        p_target_type: target.targetType,
      }),

    deleteCloudProject: (projectId: string) =>
      rpcOne<CloudActionResult>("delete_cloud_project", {
        p_project_id: projectId,
      }),

    hideCloudProject: (projectId: string) =>
      rpcOne<CloudActionResult>("hide_cloud_project", {
        p_project_id: projectId,
      }),

    removeProjectMember: (projectId: string, userId: string) =>
      rpcOne<CloudActionResult>("remove_project_member", {
        p_project_id: projectId,
        p_user_id: userId,
      }),

    revokeProjectInvite: (projectId: string, inviteId: string) =>
      rpcOne<CloudActionResult>("revoke_project_invite", {
        p_invite_id: inviteId,
        p_project_id: projectId,
      }),

    saveProjectResourceWithLock: <TKey extends CloudResourceKey>(
      projectId: string,
      resourceKey: TKey,
      baseVersion: number,
      data: CloudProjectResourceData[TKey],
      lockToken: string,
      schemaVersion: number,
      summary?: string,
    ) =>
      rpcOne<CloudSaveResult>("save_project_resource_with_lock", {
        p_base_version: baseVersion,
        p_data: data,
        p_lock_token: lockToken,
        p_project_id: projectId,
        p_resource_key: resourceKey,
        p_schema_version: schemaVersion,
        p_summary: summary ?? null,
      }),

    importCloudProjectWithLock: (
      projectId: string,
      draft: CloudProjectDraft,
      lockToken: string,
      summary?: string,
    ) =>
      rpcOne<CloudImportResult>("import_cloud_project_with_lock", {
        p_lock_token: lockToken,
        p_mode: draft.project.mode,
        p_project_id: projectId,
        p_resources: draft.resources,
        p_scenes: draft.scenes,
        p_schema_version: draft.project.schemaVersion,
        p_summary: summary ?? null,
        p_title: draft.project.title,
      }),

    saveSceneOrderWithLock: (
      projectId: string,
      baseVersion: number,
      data: CloudProjectResourceData["sceneOrder"],
      newScenes: CloudSceneDraft[],
      deletedSceneIds: string[],
      lockToken: string,
      schemaVersion: number,
      summary?: string,
    ) =>
      rpcOne<CloudSaveResult>("save_scene_order_with_lock", {
        p_base_version: baseVersion,
        p_data: data,
        p_deleted_scene_ids: deletedSceneIds,
        p_lock_token: lockToken,
        p_new_scenes: newScenes,
        p_project_id: projectId,
        p_schema_version: schemaVersion,
        p_summary: summary ?? null,
      }),

    saveSceneWithLock: (
      projectId: string,
      sceneId: string,
      baseVersion: number,
      data: CloudSceneData,
      lockToken: string,
      schemaVersion: number,
      summary?: string,
    ) =>
      rpcOne<CloudSaveResult>("save_scene_with_lock", {
        p_base_version: baseVersion,
        p_data: data,
        p_lock_token: lockToken,
        p_project_id: projectId,
        p_scene_id: sceneId,
        p_schema_version: schemaVersion,
        p_summary: summary ?? null,
      }),

    updateProjectMemberRole: (
      projectId: string,
      userId: string,
      role: "editor" | "owner" | "viewer",
    ) =>
      rpcOne<CloudActionResult>("update_project_member_role", {
        p_project_id: projectId,
        p_role: role,
        p_user_id: userId,
      }),
  };
};

import type { CloudConfig } from "./config";
import type { CloudSceneCellPatchType } from "./projectParts";
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
  holder_client_id?: string | null;
  lease_id?: string | null;
  locked_by: string | null;
  operation_id?: string | null;
  reason: string;
  success: boolean;
};

export type CloudHeartbeatResult = {
  expires_at: string | null;
  reason: string;
  renewed_at?: string | null;
  success: boolean;
};

export type CloudReleaseResult = {
  reason: string;
  success: boolean;
};

export type CloudSaveResult = {
  cell_version?: number | null;
  lease_id?: string | null;
  operation_id?: string | null;
  reason: string;
  success: boolean;
  updated_at: string | null;
  version: number | null;
};

export type CloudLeaseMetadata = {
  holderClientId?: string | null;
  leaseId?: string | null;
  operationId?: string | null;
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

export type CloudContactItem = {
  createdAt: string | null;
  displayName: string | null;
  status: "accepted" | "blocked" | "pending";
  userId: string;
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

type CloudContactRow = {
  contact_user_id: string;
  created_at: string | null;
  display_name?: string | null;
  status: "accepted" | "blocked" | "pending";
};

type CloudContactActionResult = {
  contact_user_id: string | null;
  display_name: string | null;
  reason: string;
  status: "accepted" | "blocked" | "pending" | null;
  success: boolean;
};

type CloudProjectMemberFromContactResult = {
  display_name: string | null;
  reason: string;
  role: "editor" | "viewer" | null;
  success: boolean;
  user_id: string | null;
};

export type CloudActiveLockSummary = {
  expiresAt: string;
  holderClientId: string | null;
  lastActivityAt: string;
  lastHeartbeatAt: string;
  leaseId: string | null;
  lockedAt: string;
  lockedBy: string;
  operationId: string | null;
  renewedAt: string | null;
  targetId: string;
  targetType: "project" | "scene" | "scene_cell";
};

type CloudActiveLockRow = {
  expires_at: string;
  holder_client_id?: string | null;
  last_activity_at: string;
  last_heartbeat_at: string;
  lease_id?: string | null;
  locked_at: string;
  locked_by: string;
  operation_id?: string | null;
  renewed_at?: string | null;
  target_id: string;
  target_type: "project" | "scene" | "scene_cell";
};

export type CloudSceneCellVersion = {
  cellId: string;
  cellKind: CloudSceneCellPatchType;
  sceneId: string;
  updatedAt: string | null;
  updatedBy: string | null;
  version: number;
};

type CloudSceneCellVersionRow = {
  cell_id: string;
  cell_kind: CloudSceneCellPatchType;
  scene_id: string;
  updated_at: string | null;
  updated_by: string | null;
  version: number;
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

const isFutureIsoDate = (value: string | null | undefined): boolean => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) && time > Date.now();
};

const mapContactRow = (row: CloudContactRow): CloudContactItem => ({
  createdAt: row.created_at,
  displayName: readDisplayName(row.display_name),
  status: row.status,
  userId: row.contact_user_id,
});

const addLeaseMetadata = (
  payload: RpcPayload,
  metadata?: CloudLeaseMetadata,
): RpcPayload => {
  if (!metadata) {
    return payload;
  }
  return {
    ...payload,
    p_holder_client_id: metadata.holderClientId ?? null,
    p_lease_id: metadata.leaseId ?? null,
    p_operation_id: metadata.operationId ?? null,
  };
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

    listUserContacts: async (): Promise<CloudContactItem[]> => {
      const rows = await rpc<CloudContactRow>("list_user_contacts", {});
      return rows.map(mapContactRow);
    },

    addContactByEmail: async (email: string): Promise<CloudContactActionResult> => {
      const result = await rpcOne<CloudContactActionResult>("add_contact_by_email", {
        p_email: email,
      });
      return {
        ...result,
        display_name: readDisplayName(result.display_name),
      };
    },

    addProjectMemberFromContact: (
      projectId: string,
      contactUserId: string,
      role: "editor" | "viewer",
    ) =>
      rpcOne<CloudProjectMemberFromContactResult>(
        "add_project_member_from_contact",
        {
          p_contact_user_id: contactUserId,
          p_project_id: projectId,
          p_role: role,
        },
      ),

    addProjectMemberToContacts: async (
      projectId: string,
      contactUserId: string,
    ): Promise<CloudContactActionResult> => {
      const result = await rpcOne<CloudContactActionResult>(
        "add_project_member_to_contacts",
        {
          p_contact_user_id: contactUserId,
          p_project_id: projectId,
        },
      );
      return {
        ...result,
        display_name: readDisplayName(result.display_name),
      };
    },

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
          "?select=target_type,target_id,locked_by,locked_at,last_heartbeat_at,last_activity_at,expires_at,renewed_at,lease_id,operation_id,holder_client_id",
          `&project_id=eq.${encodedProjectId}`,
          "&order=locked_at.asc",
        ].join(""),
      );
      return rows
        .map((row) => ({
          expiresAt: row.expires_at,
          holderClientId: row.holder_client_id ?? null,
          lastActivityAt: row.last_activity_at,
          lastHeartbeatAt: row.last_heartbeat_at,
          leaseId: row.lease_id ?? null,
          lockedAt: row.locked_at,
          lockedBy: row.locked_by,
          operationId: row.operation_id ?? null,
          renewedAt: row.renewed_at ?? null,
          targetId: row.target_id,
          targetType: row.target_type,
        }))
        .filter((lock) => isFutureIsoDate(lock.expiresAt));
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

    listSceneCellVersions: async (
      projectId: string,
    ): Promise<CloudSceneCellVersion[]> => {
      const rows = await rpc<CloudSceneCellVersionRow>(
        "list_scene_cell_versions",
        {
          p_project_id: projectId,
        },
      );
      return rows.map((row) => ({
        cellId: row.cell_id,
        cellKind: row.cell_kind,
        sceneId: row.scene_id,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
        version: row.version,
      }));
    },

    acquireEditLock: (
      projectId: string,
      target: CloudLockTarget,
      lockToken: string,
      metadata?: CloudLeaseMetadata,
    ) =>
      rpcOne<CloudLockAcquireResult>(
        "acquire_edit_lock",
        addLeaseMetadata(
          {
            p_lock_token: lockToken,
            p_project_id: projectId,
            p_target_id: target.targetId,
            p_target_type: target.targetType,
          },
          metadata,
        ),
      ),

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
      metadata?: CloudLeaseMetadata,
    ) =>
      rpcOne<CloudHeartbeatResult>(
        "heartbeat_edit_lock",
        addLeaseMetadata(
          {
            p_has_activity: hasActivity,
            p_lock_token: lockToken,
            p_project_id: projectId,
            p_target_id: target.targetId,
            p_target_type: target.targetType,
          },
          metadata,
        ),
      ),

    releaseEditLock: (
      projectId: string,
      target: CloudLockTarget,
      lockToken: string,
      metadata?: CloudLeaseMetadata,
    ) =>
      rpcOne<CloudReleaseResult>(
        "release_edit_lock",
        addLeaseMetadata(
          {
            p_lock_token: lockToken,
            p_project_id: projectId,
            p_target_id: target.targetId,
            p_target_type: target.targetType,
          },
          metadata,
        ),
      ),

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

    saveSceneCellPatchWithLock: (
      projectId: string,
      sceneId: string,
      patchType: CloudSceneCellPatchType,
      cellId: string,
      value: unknown,
      lockToken: string,
      schemaVersion: number,
      summary?: string,
      expectedBaseVersion?: number,
      metadata?: CloudLeaseMetadata,
    ) =>
      rpcOne<CloudSaveResult>(
        "save_scene_cell_patch_with_lock",
        addLeaseMetadata(
          {
            p_cell_id: cellId,
            p_expected_base_version: expectedBaseVersion ?? null,
            p_lock_token: lockToken,
            p_patch_type: patchType,
            p_project_id: projectId,
            p_scene_id: sceneId,
            p_schema_version: schemaVersion,
            p_summary: summary ?? null,
            p_value: value,
          },
          metadata,
        ),
      ),

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

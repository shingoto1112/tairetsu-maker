import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CloudConfig } from "./config";

type RealtimePayload = {
  eventType: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export type CloudPresenceStatus = "editing" | "project-editing" | "viewing";

export type CloudPresencePayload = {
  displayName: string;
  role: "editor" | "owner" | "viewer";
  sceneId: string | null;
  sceneLabel: string | null;
  status: CloudPresenceStatus;
  targetId: string | null;
  targetType: "project" | "scene" | null;
  updatedAt: string;
  userId: string;
};

export type CloudProjectPresence = CloudPresencePayload & {
  presenceRef: string;
};

export type CloudSaveNotification = {
  actorId: string | null;
  baseCellVersion: number | null;
  cellId: string | null;
  cellVersion: number | null;
  cellLockTargetId: string | null;
  createdAt: string;
  holderClientId: string | null;
  leaseId: string | null;
  operationId: string | null;
  patchType: string | null;
  patchValue: unknown;
  projectId: string;
  summary: string | null;
  targetId: string;
  targetType: "project" | "scene";
  version: number | null;
};

export type CloudPreviewEvent = {
  cellId: string;
  cellKind: string;
  holderClientId: string;
  leaseId: string;
  operationId: string;
  projectId: string;
  sceneId: string;
  seq: number;
  sentAt: string;
  value: unknown;
};

export type CloudCommitEvent = {
  cellId: string;
  cellKind: string;
  cellVersion: number;
  holderClientId: string | null;
  leaseId: string | null;
  operationId: string | null;
  projectId: string;
  sceneId: string;
  sentAt: string;
};

export type CloudLockEvent = {
  actorId: string | null;
  createdAt: string;
  holderClientId: string | null;
  leaseId: string | null;
  operationId: string | null;
  projectId: string;
  targetId: string | null;
  targetType: "project" | "scene" | "scene_cell" | null;
  type: "lock_acquired" | "lock_expired" | "lock_released";
};

export type CloudLockTakeoverRequest = {
  actorId: string | null;
  createdAt: string;
  projectId: string;
  requestId: string | null;
  targetId: string;
  targetType: "project" | "scene" | "scene_cell";
};

export type CloudRealtimeSubscription = {
  sendCommit: (event: CloudCommitEvent) => Promise<void>;
  sendPreview: (event: CloudPreviewEvent) => Promise<void>;
  updatePresence: (presence: CloudPresencePayload | null) => Promise<void>;
  unsubscribe: () => Promise<void>;
};

export const createCloudPreviewSequencer = (): (() => number) => {
  let seq = 0;
  return () => {
    seq = seq >= Number.MAX_SAFE_INTEGER ? 1 : seq + 1;
    return seq;
  };
};

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const parsePresencePayload = (
  value: unknown,
): CloudProjectPresence | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const userId = asString(row.userId);
  const presenceRef = asString(row.presence_ref);
  const status = asString(row.status);
  const role = asString(row.role);
  const updatedAt = asString(row.updatedAt);
  if (
    !userId ||
    !presenceRef ||
    !updatedAt ||
    (status !== "editing" &&
      status !== "project-editing" &&
      status !== "viewing") ||
    (role !== "editor" && role !== "owner" && role !== "viewer")
  ) {
    return null;
  }

  return {
    displayName: asString(row.displayName)?.trim() || "名前未設定",
    presenceRef,
    role,
    sceneId: asString(row.sceneId),
    sceneLabel: asString(row.sceneLabel),
    status,
    targetId: asString(row.targetId),
    targetType:
      row.targetType === "project" || row.targetType === "scene"
        ? row.targetType
        : null,
    updatedAt,
    userId,
  };
};

const readPresenceItems = (channel: {
  presenceState: <T extends Record<string, unknown>>() => Record<string, T[]>;
}): CloudProjectPresence[] => {
  const state = channel.presenceState<Record<string, unknown>>();
  return Object.values(state)
    .flat()
    .map(parsePresencePayload)
    .filter((item): item is CloudProjectPresence => Boolean(item));
};

const parseSaveNotification = (
  payload: RealtimePayload,
): CloudSaveNotification | null => {
  const row = payload.new;
  if (
    !row ||
    (row.action !== "save_success" && row.action !== "cloud_import_success")
  ) {
    return null;
  }
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const projectId = asString(row.project_id);
  const targetType = asString(row.target_type);
  const targetId = asString(row.target_id);
  const createdAt = asString(row.created_at);
  if (
    !projectId ||
    !targetId ||
    !createdAt ||
    (targetType !== "scene" && targetType !== "project")
  ) {
    return null;
  }
  return {
    actorId: asString(row.actor_id),
    baseCellVersion: asNumber(metadata.baseCellVersion),
    cellId: asString(metadata.cellId),
    cellVersion: asNumber(metadata.cellVersion),
    cellLockTargetId: asString(metadata.cellLockTargetId),
    createdAt,
    holderClientId: asString(metadata.holderClientId),
    leaseId: asString(metadata.leaseId),
    operationId: asString(metadata.operationId),
    patchType: asString(metadata.patchType),
    patchValue: "patchValue" in metadata ? metadata.patchValue : null,
    projectId,
    summary: asString(metadata.summary),
    targetId,
    targetType,
    version: asNumber(metadata.version),
  };
};

const parseLockTakeoverRequest = (
  payload: RealtimePayload,
): CloudLockTakeoverRequest | null => {
  const row = payload.new;
  if (!row || row.action !== "lock_takeover_requested") {
    return null;
  }
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const projectId = asString(row.project_id);
  const targetType = asString(row.target_type);
  const targetId = asString(row.target_id);
  const createdAt = asString(row.created_at);
  if (
    !projectId ||
    !targetId ||
    !createdAt ||
    (targetType !== "scene" &&
      targetType !== "project" &&
      targetType !== "scene_cell")
  ) {
    return null;
  }
  return {
    actorId: asString(row.actor_id),
    createdAt,
    projectId,
    requestId: asString(metadata.requestId),
    targetId,
    targetType,
  };
};

const parseLockEvent = (payload: RealtimePayload): CloudLockEvent | null => {
  const row = payload.new;
  if (
    !row ||
    (row.action !== "lock_acquired" &&
      row.action !== "lock_released" &&
      row.action !== "lock_expired")
  ) {
    return null;
  }
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const projectId = asString(row.project_id);
  const createdAt = asString(row.created_at);
  const targetType = asString(row.target_type);
  if (
    !projectId ||
    !createdAt ||
    (targetType !== null &&
      targetType !== "scene" &&
      targetType !== "project" &&
      targetType !== "scene_cell")
  ) {
    return null;
  }

  return {
    actorId: asString(row.actor_id),
    createdAt,
    holderClientId: asString(metadata.holderClientId),
    leaseId: asString(metadata.leaseId),
    operationId: asString(metadata.operationId),
    projectId,
    targetId: asString(row.target_id),
    targetType,
    type: row.action,
  };
};

export const subscribeCloudProjectRealtime = (options: {
  accessToken: string;
  config: CloudConfig;
  onError?: (message: string) => void;
  onLockEvent?: (event: CloudLockEvent) => void;
  onLockChange: () => void;
  onPresenceChange?: (items: CloudProjectPresence[]) => void;
  onCommit?: (event: CloudCommitEvent) => void;
  onPreview?: (event: CloudPreviewEvent) => void;
  onSave: (notification: CloudSaveNotification) => void;
  onTakeoverRequest?: (request: CloudLockTakeoverRequest) => void;
  presence: CloudPresencePayload | null;
  presenceKey: string;
  projectId: string;
}): CloudRealtimeSubscription => {
  const client: SupabaseClient = createClient(
    options.config.url,
    options.config.anonKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
        },
      },
      realtime: {
        params: {
          eventsPerSecond: 15,
        },
      },
    },
  );
  client.realtime.setAuth(options.accessToken);

  let isSubscribed = false;
  let latestPresence = options.presence;

  const emitPresence = () => {
    options.onPresenceChange?.(readPresenceItems(channel));
  };

  const trackLatestPresence = async () => {
    if (!isSubscribed) {
      return;
    }
    if (!latestPresence) {
      await channel.untrack();
      return;
    }
    const result = await channel.track(latestPresence);
    if (result === "error" || result === "timed out") {
      options.onError?.("クラウド閲覧状況の更新に失敗しました。");
    }
  };

  const channel = client
    .channel(`cloud-project:${options.projectId}`, {
      config: {
        presence: {
          key: options.presenceKey,
        },
      },
    })
    .on("presence", { event: "sync" }, emitPresence)
    .on("broadcast", { event: "preview" }, ({ payload }) => {
      const event = payload as CloudPreviewEvent;
      if (event?.projectId === options.projectId) {
        options.onPreview?.(event);
      }
    })
    .on("broadcast", { event: "commit" }, ({ payload }) => {
      const event = payload as CloudCommitEvent;
      if (event?.projectId === options.projectId) {
        options.onCommit?.(event);
      }
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        filter: `project_id=eq.${options.projectId}`,
        schema: "public",
        table: "edit_locks",
      },
      () => {
        options.onLockChange();
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        filter: `project_id=eq.${options.projectId}`,
        schema: "public",
        table: "audit_logs",
      },
      (payload: RealtimePayload) => {
        const notification = parseSaveNotification(payload);
        if (notification) {
          options.onSave(notification);
        }
        const takeoverRequest = parseLockTakeoverRequest(payload);
        if (takeoverRequest) {
          options.onTakeoverRequest?.(takeoverRequest);
        }
        const lockEvent = parseLockEvent(payload);
        if (lockEvent) {
          options.onLockEvent?.(lockEvent);
        }
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        isSubscribed = true;
        void trackLatestPresence();
        return;
      }
      if (status === "CLOSED") {
        isSubscribed = false;
        options.onPresenceChange?.([]);
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        isSubscribed = false;
        options.onError?.("クラウド更新通知の購読に失敗しました。");
      }
    });

  return {
    sendCommit: async (event) => {
      if (!isSubscribed) {
        return;
      }
      await channel.send({
        event: "commit",
        payload: event,
        type: "broadcast",
      });
    },
    sendPreview: async (event) => {
      if (!isSubscribed) {
        return;
      }
      await channel.send({
        event: "preview",
        payload: event,
        type: "broadcast",
      });
    },
    updatePresence: async (presence) => {
      latestPresence = presence;
      await trackLatestPresence();
    },
    unsubscribe: async () => {
      if (isSubscribed) {
        await channel.untrack();
      }
      await channel.unsubscribe();
      client.removeChannel(channel);
      client.realtime.disconnect();
    },
  };
};

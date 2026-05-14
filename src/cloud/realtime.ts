import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CloudConfig } from "./config";

type RealtimePayload = {
  eventType: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export type CloudSaveNotification = {
  actorId: string | null;
  createdAt: string;
  projectId: string;
  summary: string | null;
  targetId: string;
  targetType: "project" | "scene";
  version: number | null;
};

export type CloudRealtimeSubscription = {
  unsubscribe: () => Promise<void>;
};

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const parseSaveNotification = (
  payload: RealtimePayload,
): CloudSaveNotification | null => {
  const row = payload.new;
  if (!row || row.action !== "save_success") {
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
    createdAt,
    projectId,
    summary: asString(metadata.summary),
    targetId,
    targetType,
    version: asNumber(metadata.version),
  };
};

export const subscribeCloudProjectRealtime = (options: {
  accessToken: string;
  config: CloudConfig;
  onError?: (message: string) => void;
  onLockChange: () => void;
  onSave: (notification: CloudSaveNotification) => void;
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
          eventsPerSecond: 5,
        },
      },
    },
  );
  client.realtime.setAuth(options.accessToken);

  const channel = client
    .channel(`cloud-project:${options.projectId}`)
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
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        options.onError?.("クラウド更新通知の購読に失敗しました。");
      }
    });

  return {
    unsubscribe: async () => {
      await channel.unsubscribe();
      client.removeChannel(channel);
      client.realtime.disconnect();
    },
  };
};

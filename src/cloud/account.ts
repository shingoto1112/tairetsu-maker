import type { CloudConfig } from "./config";
import { CloudApiError } from "./errors";
import { withRequestTimeout } from "./requestTimeout";

export type CloudAccountDeleteResult = {
  deleted_project_count: number; transferred_project_count: number;
  reason: string; success: boolean;
};

/** Shared Auth lifecycle RPC, independent of either document API version. */
export async function deleteCurrentAccount(config: CloudConfig, accessToken: string): Promise<CloudAccountDeleteResult> {
  return withRequestTimeout(async signal => {
  const response = await fetch(`${config.url}/rest/v1/rpc/delete_current_account`, {
    signal,
    method: "POST", headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_confirmation: "DELETE_MY_ACCOUNT" }),
  });
  const json: unknown = await response.json();
  if (!response.ok) throw new CloudApiError("アカウントを削除できませんでした。", response.status, null);
  const result = Array.isArray(json) ? json[0] : json;
  if (!result || typeof result !== "object" || typeof result.success !== "boolean") throw new Error("削除結果を確認できませんでした。");
  return result as CloudAccountDeleteResult;
  }, "アカウント削除の応答が時間切れになりました。削除が完了した可能性もあります。再度ログインして状態を確認し、アカウントが残っている場合は削除を再試行してください。");
}

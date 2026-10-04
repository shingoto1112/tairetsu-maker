import type { CloudConfig } from "./config";
import type { CloudAccountDeleteResult } from "./api";
import { CloudApiError } from "./api";

/** Shared Auth lifecycle RPC, independent of either document API version. */
export async function deleteCurrentAccount(config: CloudConfig, accessToken: string): Promise<CloudAccountDeleteResult> {
  const response = await fetch(`${config.url}/rest/v1/rpc/delete_current_account`, {
    method: "POST", headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_confirmation: "DELETE_MY_ACCOUNT" }),
  });
  const json: unknown = await response.json();
  if (!response.ok) throw new CloudApiError("アカウントを削除できませんでした。", response.status, null);
  const result = Array.isArray(json) ? json[0] : json;
  if (!result || typeof result !== "object" || typeof result.success !== "boolean") throw new Error("削除結果を確認できませんでした。");
  return result as CloudAccountDeleteResult;
}

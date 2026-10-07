import type { CloudConfig } from "../cloud/config";
import { withRequestTimeout } from "../cloud/requestTimeout";
import { createCloudAuthClient, CloudAuthError, type CloudAuthSession } from "../cloud/auth";
import { validatePasswordChange } from "../cloud/password";
import type { CloudAccountDeleteResult } from "../cloud/account";
import { deleteCurrentAccount } from "../cloud/account";
import { readCloudAuthSession, saveCloudAuthSession, clearCloudAuthSession, cloudAuthEpoch, waitCloudAuthPersistence } from "../cloud/session";
import { TransportError } from "./transport";

/** Reuses the existing fresh password sign-in and account-delete RPC. The v2
 * Auth FK/trigger does the cloud cascade; no local Repository deletion occurs. */
export function createCollaborationAccountApi(config: CloudConfig, options: {
  read?: () => CloudAuthSession | null; save?: (value: CloudAuthSession) => void; clear?: () => void;
  reauthenticate?: (email: string, password: string) => Promise<CloudAuthSession>;
  epoch?: () => number;
  updatePassword?: (accessToken: string, password: string) => Promise<void>;
  persist?: () => Promise<void>;
  deleteCurrentAccount?: (accessToken: string) => Promise<CloudAccountDeleteResult>;
} = {}) {
  return {
    async changePassword(currentPassword: string, newPassword: string, confirmation: string) {
      const validation = validatePasswordChange(currentPassword, newPassword, confirmation);
      if (validation) throw new Error(validation);
      const read = options.read ?? readCloudAuthSession, current = read();
      const epoch = options.epoch ?? cloudAuthEpoch, expected = epoch();
      if (!current?.user.email || (current as CloudAuthSession & { collaborationGuest?: boolean }).collaborationGuest) throw new TransportError("auth", "PERMANENT_ACCOUNT_REQUIRED");
      const check = () => {
        if (epoch() !== expected || read()?.user.id !== current.user.id) throw new TransportError("auth", "ACCOUNT_CHANGED");
      };
      const client = createCloudAuthClient(config);
      let fresh: CloudAuthSession;
      try { fresh = await (options.reauthenticate ?? client.signInWithPassword)(current.user.email, currentPassword); }
      catch (error) {
        check();
        if (error instanceof CloudAuthError && error.status === 429) throw new Error("試行回数が多いため、しばらく待ってから再試行してください。");
        if (error instanceof CloudAuthError && /invalid_credentials|invalid login credentials/i.test(`${error.details?.error_code} ${error.message}`)) throw new Error("現在のパスワードが正しくありません。");
        throw new Error("本人確認を完了できませんでした。通信を確認して再試行してください。");
      }
      check();
      if (fresh.user.id !== current.user.id) throw new TransportError("auth", "ACCOUNT_CHANGED");
      try { await (options.updatePassword ?? client.updatePassword)(fresh.accessToken, newPassword); }
      catch (error) {
        check();
        if (error instanceof CloudAuthError && error.status === 429) throw new Error("試行回数が多いため、しばらく待ってから再試行してください。");
        if (error instanceof CloudAuthError && error.status < 500) throw new Error("パスワードを変更できませんでした。入力を確認して再試行してください。");
        throw new Error("通信が途切れたため、変更結果を確認できません。再試行で現在のパスワードが通らない場合は、新しいパスワードでログインしてください。");
      }
      // Updating credentials must not change identity or discard shared edits.
      check();
      try {
        (options.save ?? saveCloudAuthSession)(fresh);
        await (options.persist ?? waitCloudAuthPersistence)();
      } catch {
        check();
        return { persistenceFailed: true };
      }
      check();
      return { persistenceFailed: false };
    },
    async deleteAccountWithPassword(password: string, confirmation: "DELETE_MY_ACCOUNT") {
      if (confirmation !== "DELETE_MY_ACCOUNT" || !password) throw new TransportError("validation", "CONFIRMATION_REQUIRED");
      const read = options.read ?? readCloudAuthSession, current = read();
      if (!current?.user.email || (current as CloudAuthSession & { collaborationGuest?: boolean }).collaborationGuest) throw new TransportError("auth", "PERMANENT_ACCOUNT_REQUIRED");
      const fresh = await withRequestTimeout(signal => (options.reauthenticate ?? createCloudAuthClient(config, signal).signInWithPassword)(current.user.email!, password),
        "本人確認の応答が時間切れになりました。通信状態を確認して、アカウント削除を再試行してください。");
      if (fresh.user.id !== current.user.id || read()?.user.id !== current.user.id) throw new TransportError("auth", "ACCOUNT_CHANGED");
      (options.save ?? saveCloudAuthSession)(fresh);
      const result = await (options.deleteCurrentAccount ?? (token => deleteCurrentAccount(config, token)))(fresh.accessToken);
      if (!result.success) throw new TransportError("validation", `ACCOUNT_DELETE_${result.reason}`);
      if (read()?.user.id !== current.user.id) throw new TransportError("auth", "ACCOUNT_CHANGED");
      (options.clear ?? clearCloudAuthSession)();
      return { ...result, localCopiesRetained: true as const };
    },
  };
}

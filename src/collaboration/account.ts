import type { CloudConfig } from "../cloud/config";
import { createCloudAuthClient, type CloudAuthSession } from "../cloud/auth";
import type { CloudAccountDeleteResult } from "../cloud/account";
import { deleteCurrentAccount } from "../cloud/account";
import { readCloudAuthSession, saveCloudAuthSession, clearCloudAuthSession } from "../cloud/session";
import { TransportError } from "./transport";

/** Reuses the existing fresh password sign-in and account-delete RPC. The v2
 * Auth FK/trigger does the cloud cascade; no local Repository deletion occurs. */
export function createCollaborationAccountApi(config: CloudConfig, options: {
  read?: () => CloudAuthSession | null; save?: (value: CloudAuthSession) => void; clear?: () => void;
  reauthenticate?: (email: string, password: string) => Promise<CloudAuthSession>;
  deleteCurrentAccount?: (accessToken: string) => Promise<CloudAccountDeleteResult>;
} = {}) {
  return {
    async deleteAccountWithPassword(password: string, confirmation: "DELETE_MY_ACCOUNT") {
      if (confirmation !== "DELETE_MY_ACCOUNT" || !password) throw new TransportError("validation", "CONFIRMATION_REQUIRED");
      const read = options.read ?? readCloudAuthSession, current = read();
      if (!current?.user.email || (current as CloudAuthSession & { collaborationGuest?: boolean }).collaborationGuest) throw new TransportError("auth", "PERMANENT_ACCOUNT_REQUIRED");
      const fresh = await (options.reauthenticate ?? createCloudAuthClient(config).signInWithPassword)(current.user.email, password);
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

import type { CloudConfig } from "../cloud/config";
import { createCloudAuthClient, type CloudAuthSession } from "../cloud/auth";
import { readCloudAuthSession, saveCloudAuthSession, clearCloudAuthSession, isCloudAuthSessionExpired } from "../cloud/session";
import { createCollaborationRequest } from "./supabaseTransport";
import { displayName } from "./invitations";
import { TransportError, uuid, type Credential } from "./transport";

type GuestSession = CloudAuthSession & { collaborationGuest: true };
const key = "tairetsu.collaboration.guestSession.v1";
export type ParticipantAuthState = { status: "signed-out"; guestRecovery: "new-invite-required" } |
  { status: "signed-in"; userId: string; displayName?: string; isGuest: boolean; sessionPersistence: "browser-data" | "existing-account" };
/** Uses the existing auth refresh and session/Keychain service. Only Web guest
 * sessions get a persistent mirror; permanent-account behavior stays unchanged. */
export function createParticipantAuth(config: CloudConfig, platform: "web" | "ipad", options: {
  fetcher?: typeof fetch; storage?: Storage;
  read?: () => CloudAuthSession | null; save?: (session: CloudAuthSession) => void; clear?: () => void;
  refresh?: (token: string) => Promise<CloudAuthSession>;
} = {}) {
  const read = options.read ?? readCloudAuthSession, save = options.save ?? saveCloudAuthSession;
  const storage = platform === "web" ? options.storage ?? window.localStorage : null;
  const request = createCollaborationRequest(config, options.fetcher);
  const refresh = options.refresh ?? createCloudAuthClient(config).refreshSession;
  let refreshing: Promise<CloudAuthSession> | null = null;
  let guestStart: Promise<ParticipantAuthState> | null = null;
  const isGuest = (s: CloudAuthSession): s is GuestSession => (s as Partial<GuestSession>).collaborationGuest === true;
  const session = (): CloudAuthSession | null => {
    const current = read();
    if (current) {
      // Switching to a permanent account is not guest identity linking. Do not
      // resurrect the old guest after that account later signs out.
      if (storage && !isGuest(current)) storage.removeItem(key);
      return current;
    }
    if (!storage) return null;
    try {
      const raw = JSON.parse(storage.getItem(key) ?? "null") as GuestSession | null;
      if (raw && isGuest(raw) && uuid(raw.user?.id) && raw.accessToken && raw.refreshToken && Number.isFinite(raw.expiresAt)) {
        save(raw); return raw;
      }
    } catch { /* Invalid mirror is not an authenticated session. */ }
    return null;
  };
  const persist = (value: CloudAuthSession | GuestSession) => {
    if (storage && isGuest(value)) storage.setItem(key, JSON.stringify(value));
    save(value);
  };
  const state = (): ParticipantAuthState => {
    const value = session();
    return value ? { status: "signed-in", userId: value.user.id, displayName: value.user.displayName, isGuest: isGuest(value),
      sessionPersistence: isGuest(value) ? "browser-data" : "existing-account" } : { status: "signed-out", guestRecovery: "new-invite-required" };
  };
  return {
    state,
    async credential(signal: AbortSignal): Promise<Credential | null> {
      let value = session(); if (!value || signal.aborted) return null;
      if (isCloudAuthSessionExpired(value)) {
        const previous = value;
        refreshing ??= refresh(previous.refreshToken).then(next => {
          if (read()?.user.id !== previous.user.id) throw new TransportError("auth", "ACCOUNT_CHANGED");
          const updated = isGuest(previous) ? { ...next, user: { ...next.user, displayName: next.user.displayName ?? previous.user.displayName }, collaborationGuest: true as const } : next;
          persist(updated); return updated;
        }).finally(() => { refreshing = null; });
        value = await refreshing;
      }
      if (signal.aborted || read()?.user.id !== value.user.id) throw new TransportError("auth", "ACCOUNT_CHANGED");
      return { accountId: value.user.id, accessToken: value.accessToken };
    },
    async beginGuest(name: string, signal: AbortSignal, captchaToken?: string): Promise<ParticipantAuthState> {
      if (platform !== "web") throw new TransportError("auth", "IPAD_ACCOUNT_REQUIRED");
      if (session()) return state(); // Never replace an already signed-in account.
      guestStart ??= (async () => {
      const result = await request("/auth/v1/signup", { accountId: "", accessToken: config.anonKey }, signal,
        { data: { display_name: displayName(name) }, ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}) }) as {
          access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: string; is_anonymous?: boolean };
        };
      if (!result?.access_token || !result.refresh_token || !uuid(result.user?.id) || result.user?.is_anonymous !== true ||
        !Number.isFinite(result.expires_in) || result.expires_in! <= 0) throw new TransportError("protocol", "INVALID_GUEST_SESSION");
      if (signal.aborted || read()) throw new TransportError("auth", "ACCOUNT_CHANGED");
      persist({ accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in! * 1000,
        tokenType: "bearer", user: { id: result.user.id, displayName: displayName(name) }, collaborationGuest: true });
      return state();
      })().finally(() => { guestStart = null; });
      return guestStart;
    },
    async signOut(signal: AbortSignal) {
      const auth = await this.credential(signal);
      if (auth) await createCloudAuthClient(config).signOut(auth.accessToken);
      storage?.removeItem(key); (options.clear ?? clearCloudAuthSession)();
    },
  };
}

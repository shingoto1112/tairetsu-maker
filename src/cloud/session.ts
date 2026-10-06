import type { CloudAuthSession } from "./auth";
import { createCloudAuthClient } from "./auth";
import type { CloudConfig } from "./config";
import { getAppRuntime } from "../platform/runtime";
import {
  clearNativeSecureSession,
  readNativeSecureSession,
  writeNativeSecureSession,
} from "../platform/secureSession";

const CLOUD_AUTH_SESSION_KEY = "tairetsu.cloud.authSession";
const EXPIRY_LEEWAY_MS = 60_000;
const GUEST_SESSION_KEY = "tairetsu.collaboration.guestSession.v1";
let epoch = 0;
let sessionRevision = 0;
let restoring = getAppRuntime() === "capacitor-ios";
let persistence: Promise<void> = Promise.resolve();
let hydration: Promise<CloudAuthSession | null> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) { try { listener(); } catch { /* An observer does not own authentication. */ } } };
export const cloudAuthIdentity = () => ({ epoch, status: restoring ? "restoring" as const : readCloudAuthSession() ? "signed-in" as const : "signed-out" as const,
  accountId: readCloudAuthSession()?.user.id ?? null });
export const subscribeCloudAuth = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Serialize Keychain writes/deletes, so a late save cannot resurrect logout. */
const enqueue = (operation: () => Promise<void>) => {
  persistence = persistence.catch(() => {}).then(operation);
  void persistence.catch(error => console.warn("iPadのログイン情報を保存・削除できませんでした。", error));
};
export const waitCloudAuthPersistence = () => persistence;
export const cloudAuthEpoch = () => epoch;

export const saveCloudAuthSession = (session: CloudAuthSession): void => {
  sessionRevision++;
  if (readCloudAuthSession()?.user.id !== session.user.id) epoch++;
  const serialized = JSON.stringify(session);
  if ((session as CloudAuthSession & { collaborationGuest?: boolean }).collaborationGuest && getAppRuntime() === "web") window.localStorage.setItem(GUEST_SESSION_KEY, serialized);
  else window.localStorage.removeItem(GUEST_SESSION_KEY);
  window.sessionStorage.setItem(
    CLOUD_AUTH_SESSION_KEY,
    serialized,
  );
  restoring = false;
  enqueue(() => writeNativeSecureSession(serialized)); emit();
};

const parseStoredSession = (raw: string | null): CloudAuthSession | null => {
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as CloudAuthSession;
    if (typeof session.accessToken !== "string" || !session.accessToken || typeof session.refreshToken !== "string" || !session.refreshToken ||
        typeof session.user?.id !== "string" || !session.user.id || !Number.isFinite(session.expiresAt)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

export const readCloudAuthSession = (): CloudAuthSession | null => {
  return parseStoredSession(window.sessionStorage.getItem(CLOUD_AUTH_SESSION_KEY));
};

export const hydrateCloudAuthSessionFromNativeStorage = async (): Promise<
  CloudAuthSession | null
> => {
  hydration ??= (async () => {
    restoring = true; emit(); const expected = epoch;
    try {
      await persistence.catch(() => {});
      const session = parseStoredSession(await readNativeSecureSession());
      if (expected !== epoch) return readCloudAuthSession();
      if (session) { epoch++; window.sessionStorage.setItem(CLOUD_AUTH_SESSION_KEY, JSON.stringify(session)); }
      return session;
    } finally { restoring = false; emit(); }
  })().finally(() => { hydration = null; });
  return hydration;
};

export const clearCloudAuthSession = (): void => {
  epoch++; restoring = false;
  window.sessionStorage.removeItem(CLOUD_AUTH_SESSION_KEY);
  window.localStorage.removeItem(GUEST_SESSION_KEY);
  enqueue(clearNativeSecureSession); emit();
};

// Shared refresh single-flight belongs here, including injected isolated test identities.
const refreshes = new Map<() => CloudAuthSession | null, { token: string; epoch: number; work: Promise<CloudAuthSession> }>();
export async function refreshOwnedCloudAuthSession(previous: CloudAuthSession, refresh: (token: string) => Promise<CloudAuthSession>,
  read = readCloudAuthSession, save: (session: CloudAuthSession) => void = saveCloudAuthSession): Promise<CloudAuthSession> {
  const expected = epoch, revision = sessionRevision, current = refreshes.get(read);
  if (current?.token === previous.refreshToken && current.epoch === expected) return current.work;
  const work = refresh(previous.refreshToken).then(next => {
    if (epoch !== expected || revision !== sessionRevision || read()?.refreshToken !== previous.refreshToken || next.user.id !== previous.user.id) throw new Error("ログイン資格が変更されました。");
    const guest = (previous as CloudAuthSession & { collaborationGuest?: boolean }).collaborationGuest;
    const updated = { ...next, authFlow: previous.authFlow, user: { ...next.user, displayName: next.user.displayName ?? previous.user.displayName }, ...(guest ? { collaborationGuest: true } : {}) };
    save(updated); return updated;
  }).finally(() => { if (refreshes.get(read)?.work === work) refreshes.delete(read); });
  refreshes.set(read, { token: previous.refreshToken, epoch: expected, work }); return work;
}
export async function getValidCloudAuthSession(config: CloudConfig): Promise<CloudAuthSession | null> {
  if (hydration) await hydration;
  const session = readCloudAuthSession();
  return session && isCloudAuthSessionExpired(session) ? refreshOwnedCloudAuthSession(session, createCloudAuthClient(config).refreshSession) : session;
}
export async function waitCloudAuthRestoration() { if (hydration) await hydration; }

export const isCloudAuthSessionExpired = (
  session: CloudAuthSession,
): boolean => session.expiresAt <= Date.now() + EXPIRY_LEEWAY_MS;

export const readCloudAccessToken = (): string | null => {
  const session = readCloudAuthSession();
  if (!session || isCloudAuthSessionExpired(session)) {
    return null;
  }
  return session.accessToken;
};

import type { CloudAuthSession } from "./auth";
import {
  clearNativeSecureSession,
  readNativeSecureSession,
  writeNativeSecureSession,
} from "../platform/secureSession";

const CLOUD_AUTH_SESSION_KEY = "tairetsu.cloud.authSession";
const EXPIRY_LEEWAY_MS = 60_000;

export const saveCloudAuthSession = (session: CloudAuthSession): void => {
  const serialized = JSON.stringify(session);
  window.sessionStorage.setItem(
    CLOUD_AUTH_SESSION_KEY,
    serialized,
  );
  void writeNativeSecureSession(serialized).catch((error) => {
    console.warn("iPadのKeychainへログイン情報を保存できませんでした。", error);
  });
};

const parseStoredSession = (raw: string | null): CloudAuthSession | null => {
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as CloudAuthSession;
    if (!session.accessToken || !session.refreshToken || !session.user?.id) {
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
  const session = parseStoredSession(await readNativeSecureSession());
  if (session) {
    window.sessionStorage.setItem(CLOUD_AUTH_SESSION_KEY, JSON.stringify(session));
  }
  return session;
};

export const clearCloudAuthSession = (): void => {
  window.sessionStorage.removeItem(CLOUD_AUTH_SESSION_KEY);
  void clearNativeSecureSession().catch((error) => {
    console.warn("iPadのKeychainからログイン情報を削除できませんでした。", error);
  });
};

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

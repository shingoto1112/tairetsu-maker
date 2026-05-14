import type { CloudAuthSession } from "./auth";

const CLOUD_AUTH_SESSION_KEY = "tairetsu.cloud.authSession";
const EXPIRY_LEEWAY_MS = 60_000;

export const saveCloudAuthSession = (session: CloudAuthSession): void => {
  window.sessionStorage.setItem(
    CLOUD_AUTH_SESSION_KEY,
    JSON.stringify(session),
  );
};

export const readCloudAuthSession = (): CloudAuthSession | null => {
  try {
    const raw = window.sessionStorage.getItem(CLOUD_AUTH_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as CloudAuthSession;
    if (!session.accessToken || !session.refreshToken || !session.user?.id) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

export const clearCloudAuthSession = (): void => {
  window.sessionStorage.removeItem(CLOUD_AUTH_SESSION_KEY);
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

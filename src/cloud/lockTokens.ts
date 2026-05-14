import type { CloudLockTarget } from "./types";
import { getCloudTargetLabel } from "./projectParts";

const TOKEN_BYTES = 32;
const SESSION_STORAGE_PREFIX = "tairetsu.cloud.lockToken";

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const createCloudLockToken = (): string => {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const hashCloudLockToken = async (lockToken: string): Promise<string> => {
  const encoded = new TextEncoder().encode(lockToken);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(digest);
};

export const getCloudLockSessionStorageKey = (
  projectId: string,
  target: CloudLockTarget,
): string =>
  `${SESSION_STORAGE_PREFIX}:${projectId}:${getCloudTargetLabel(target)}`;

export const saveCloudLockTokenToSession = (
  projectId: string,
  target: CloudLockTarget,
  lockToken: string,
): void => {
  window.sessionStorage.setItem(
    getCloudLockSessionStorageKey(projectId, target),
    lockToken,
  );
};

export const readCloudLockTokenFromSession = (
  projectId: string,
  target: CloudLockTarget,
): string | null =>
  window.sessionStorage.getItem(
    getCloudLockSessionStorageKey(projectId, target),
  );

export const clearCloudLockTokenFromSession = (
  projectId: string,
  target: CloudLockTarget,
): void => {
  window.sessionStorage.removeItem(
    getCloudLockSessionStorageKey(projectId, target),
  );
};

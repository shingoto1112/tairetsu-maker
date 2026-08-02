import {
  KeychainAccess,
  SecureStorage,
} from "@aparajita/capacitor-secure-storage";
import { isIPadNativeApp } from "./runtime";

const CLOUD_SESSION_KEY = "tairetsu.cloud.authSession";

let secureStorageReady: Promise<void> | null = null;

const prepareSecureStorage = (): Promise<void> => {
  if (!secureStorageReady) {
    secureStorageReady = SecureStorage.setDefaultKeychainAccess(
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
  }
  return secureStorageReady;
};

export const readNativeSecureSession = async (): Promise<string | null> => {
  if (!isIPadNativeApp()) {
    return null;
  }
  await prepareSecureStorage();
  return SecureStorage.getItem(CLOUD_SESSION_KEY);
};

export const writeNativeSecureSession = async (value: string): Promise<void> => {
  if (!isIPadNativeApp()) {
    return;
  }
  await prepareSecureStorage();
  await SecureStorage.setItem(CLOUD_SESSION_KEY, value);
};

export const clearNativeSecureSession = async (): Promise<void> => {
  if (!isIPadNativeApp()) {
    return;
  }
  await prepareSecureStorage();
  await SecureStorage.removeItem(CLOUD_SESSION_KEY);
};

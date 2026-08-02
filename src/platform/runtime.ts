import { Capacitor } from "@capacitor/core";

export type AppRuntime = "capacitor-ios" | "tauri" | "web";

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

const isTauriRuntime = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  const tauriWindow = window as TauriWindow;
  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_INTERNALS__);
};

export const getAppRuntime = (): AppRuntime => {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("runtime") === "capacitor-ios"
  ) {
    return "capacitor-ios";
  }
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
    return "capacitor-ios";
  }
  if (isTauriRuntime()) {
    return "tauri";
  }
  return "web";
};

export type AppFeatureFlags = {
  collaboration: boolean;
  nativeFileShare: boolean;
  personalCloud: boolean;
};

export const getAppFeatureFlags = (
  runtime: AppRuntime = getAppRuntime(),
): AppFeatureFlags => ({
  collaboration: runtime !== "capacitor-ios",
  nativeFileShare: runtime === "capacitor-ios",
  personalCloud: true,
});

export const isIPadNativeApp = (): boolean => getAppRuntime() === "capacitor-ios";

import { getAppRuntime } from "../platform";

const DIAGNOSTIC_STORAGE_KEY = "tairetsu.diagnostics.v1";
const MAX_DIAGNOSTICS = 5;

export type AppDiagnostic = {
  componentStack?: string;
  kind: "render" | "runtime" | "unhandled-promise";
  name: string;
  online: boolean;
  orientation: string;
  runtime: string;
  timestamp: string;
  userAgent: string;
  viewport: string;
};

const normalizeComponentStack = (stack?: string): string | undefined =>
  stack
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n");

export const createAppDiagnostic = (
  kind: AppDiagnostic["kind"],
  error: unknown,
  componentStack?: string,
): AppDiagnostic => ({
  componentStack: normalizeComponentStack(componentStack),
  kind,
  name: error instanceof Error ? error.name : "UnknownError",
  online: navigator.onLine,
  orientation: screen.orientation?.type ?? "unknown",
  runtime: getAppRuntime(),
  timestamp: new Date().toISOString(),
  userAgent: navigator.userAgent,
  viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
});

export const saveAppDiagnostic = (diagnostic: AppDiagnostic): void => {
  try {
    const existing = JSON.parse(
      window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) ?? "[]",
    ) as unknown;
    const diagnostics = Array.isArray(existing) ? existing : [];
    window.localStorage.setItem(
      DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify([diagnostic, ...diagnostics].slice(0, MAX_DIAGNOSTICS)),
    );
  } catch {
    // Diagnostics must never prevent the app from recovering.
  }
};

export const formatAppDiagnostic = (diagnostic: AppDiagnostic): string =>
  [
    "隊列メーカー 診断情報",
    `発生日時: ${diagnostic.timestamp}`,
    `種類: ${diagnostic.kind}`,
    `エラー種別: ${diagnostic.name}`,
    `実行環境: ${diagnostic.runtime}`,
    `画面: ${diagnostic.viewport} / ${diagnostic.orientation}`,
    `通信: ${diagnostic.online ? "オンライン" : "オフライン"}`,
    `端末情報: ${diagnostic.userAgent}`,
    diagnostic.componentStack ? `画面構成:\n${diagnostic.componentStack}` : null,
  ]
    .filter(Boolean)
    .join("\n");

export const installGlobalDiagnosticCapture = (): (() => void) => {
  const handleError = (event: ErrorEvent) => {
    saveAppDiagnostic(createAppDiagnostic("runtime", event.error));
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    saveAppDiagnostic(createAppDiagnostic("unhandled-promise", event.reason));
  };
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);
  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
};

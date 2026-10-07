import { createAppDiagnostic, saveAppDiagnostic } from "./utils/diagnostics";

export function showStartupFailure(error: unknown): void {
  try { saveAppDiagnostic(createAppDiagnostic("runtime", error)); } catch { /* Recovery must remain available. */ }
  const root = document.getElementById("root") ?? document.body;
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.style.cssText = "max-width:36rem;margin:12vh auto;padding:24px;font-family:system-ui;line-height:1.8";
  const heading = document.createElement("h1");
  heading.textContent = "隊列メーカーを起動できませんでした";
  const message = document.createElement("p");
  message.textContent = "再読み込みして、もう一度お試しください。";
  const button = document.createElement("button");
  button.textContent = "再読み込み";
  button.style.cssText = "min-height:44px;padding:8px 24px";
  button.addEventListener("click", () => window.location.reload());
  panel.append(heading, message, button);
  root.replaceChildren(panel);
}

export async function startApplication(mount: () => Promise<void>): Promise<void> {
  try { await mount(); } catch (error) { showStartupFailure(error); }
}

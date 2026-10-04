import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { getAppRuntime } from "./platform";
import { installGlobalDiagnosticCapture } from "./utils/diagnostics";
import "./styles.css";
import { getAppFeatureFlags } from "./platform/runtime";
import { invitationOrigins } from "./config/collaborationLinks";
import { rememberInvitation } from "./storage/invitationMemory";

async function mount() {
// Strip the fragment before App effects, diagnostics and StrictMode rendering.
if (getAppFeatureFlags().collaborationV2 && new URLSearchParams(location.hash.slice(1)).has("invite")) {
  const { takeInvitationLink } = await import("./collaboration/invitations");
  try { rememberInvitation(takeInvitationLink(invitationOrigins)); }
  catch {
    const clean = new URL(location.href); clean.hash = "";
    history.replaceState(history.state, "", clean.href); rememberInvitation("", true);
  }
}
document.documentElement.dataset.appRuntime = getAppRuntime();
installGlobalDiagnosticCapture();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
}
void mount();

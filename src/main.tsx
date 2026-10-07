import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { startApplication } from "./startup";
import { getAppRuntime } from "./platform";
import { installGlobalDiagnosticCapture } from "./utils/diagnostics";
import "./styles.css";
import { getAppFeatureFlags } from "./platform/runtime";
import { invitationOrigins } from "./config/collaborationLinks";

async function mount() {
// Strip the fragment before App effects, diagnostics and StrictMode rendering.
if (getAppFeatureFlags().collaborationV2) {
  const { installInvitationRouting } = await import("./collaboration/invitationRouting");
  installInvitationRouting(invitationOrigins);
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
void startApplication(mount);

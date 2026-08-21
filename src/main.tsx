import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { getAppRuntime } from "./platform";
import { installGlobalDiagnosticCapture } from "./utils/diagnostics";
import "./styles.css";

document.documentElement.dataset.appRuntime = getAppRuntime();
installGlobalDiagnosticCapture();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);

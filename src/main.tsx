import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getAppRuntime } from "./platform";
import "./styles.css";

document.documentElement.dataset.appRuntime = getAppRuntime();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

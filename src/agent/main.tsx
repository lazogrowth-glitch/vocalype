import React from "react";
import ReactDOM from "react-dom/client";
import { AgentOverlay } from "./AgentOverlay";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "@/i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AgentOverlay />
    </ErrorBoundary>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import RecordingOverlay from "./RecordingOverlay";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "@/i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RecordingOverlay />
    </ErrorBoundary>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { waitForTauriRuntime } from "./lib/tauri/runtime";
import i18n from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

const rootElement = document.getElementById("root") as HTMLElement | null;

if (!rootElement) {
  throw new Error("Missing root element for desktop app bootstrap");
}

const root = ReactDOM.createRoot(rootElement);

const splashElement = document.getElementById("startup-splash");
const splashMessageElement = document.getElementById("startup-splash-message");

const setSplashMessage = (message: string) => {
  if (splashMessageElement) {
    splashMessageElement.textContent = message;
  }
};

const hideSplash = () => {
  splashElement?.remove();
};

const notifyDesktopUiReady = async () => {
  try {
    await emit("desktop-ui-ready");
  } catch (error) {
    console.warn(
      "Failed to notify desktop runtime that the UI is ready:",
      error,
    );
  }
};

const renderBootstrapMessage = (message: string) => {
  setSplashMessage(message);
  root.render(
    <React.StrictMode>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          textAlign: "center",
          fontSize: "14px",
          color: "#f5f2ed",
          background: "#0a0a0a",
        }}
      >
        {message}
      </div>
    </React.StrictMode>,
  );

  requestAnimationFrame(() => {
    void notifyDesktopUiReady();
  });
};

const renderFatalStartupError = () => {
  renderBootstrapMessage(
    i18n.t("bootstrap.desktopRuntimeUnavailable", {
      defaultValue:
        "Vocalype failed to connect to the desktop runtime. Please restart the app.",
    }),
  );
};

const bootstrap = async () => {
  try {
    setSplashMessage("Connecting to desktop runtime...");
    const tauriReady = await waitForTauriRuntime();

    if (!tauriReady) {
      console.error("Tauri runtime did not become available during startup.");
      renderFatalStartupError();
      return;
    }

    setSplashMessage("Loading app modules...");
    const [{ default: App }, i18nModule, modelStoreModule] = await Promise.all([
      import("./App"),
      import("./i18n"),
      import("./stores/modelStore"),
    ]);

    setSplashMessage("Rendering interface...");
    root.render(
      <React.StrictMode>
        <ErrorBoundary
          fallback={
            <div
              style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                textAlign: "center",
                fontSize: "14px",
                color: "#f5f2ed",
                background: "#0a0a0a",
              }}
            >
              {i18n.t("bootstrap.criticalFallback", {
                defaultValue:
                  "Vocalype encountered a critical error. Please restart the app.",
              })}
            </div>
          }
        >
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );

    requestAnimationFrame(() => {
      hideSplash();
      void notifyDesktopUiReady();
    });

    setSplashMessage("Finishing startup...");
    void Promise.allSettled([
      i18nModule.syncLanguageFromSettings(),
      modelStoreModule.useModelStore.getState().initialize(),
    ]).then((results) => {
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const label = index === 0 ? "language sync" : "model store init";
          console.warn(`Deferred startup task failed: ${label}`, result.reason);
        }
      });
    });
  } catch (error) {
    console.error("Fatal bootstrap error:", error);
    renderBootstrapMessage(
      `Vocalype startup error: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
};

window.addEventListener("error", (event) => {
  const message = event.error?.message || event.message || "unknown error";
  console.error("Unhandled startup error:", event.error || event.message);
  renderBootstrapMessage(`Vocalype frontend error: ${message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason =
    event.reason instanceof Error
      ? event.reason.message
      : typeof event.reason === "string"
        ? event.reason
        : "unknown rejection";
  console.error("Unhandled startup rejection:", event.reason);
  renderBootstrapMessage(`Vocalype frontend rejection: ${reason}`);
});

void bootstrap();

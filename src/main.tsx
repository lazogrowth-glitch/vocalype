import React from "react";
import ReactDOM from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { waitForTauriRuntime } from "./lib/tauri/runtime";
import i18n from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getUserFacingErrorMessage } from "./lib/userFacingErrors";
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
    const [{ default: App }, i18nModule] = await Promise.all([
      import("./App"),
      import("./i18n"),
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
    void i18nModule.syncLanguageFromSettings().catch((error) => {
      console.warn("Deferred startup task failed: language sync", error);
    });

    const startDeferredModelInit = () => {
      void import("./stores/modelStore")
        .then((modelStoreModule) =>
          modelStoreModule.useModelStore
            .getState()
            .initialize()
            .then(() => {
              const store = modelStoreModule.useModelStore.getState();
              if (store.isFirstRun) {
                void store.downloadModel("parakeet-tdt-0.6b-v3-multilingual");
              }
            }),
        )
        .catch((error) => {
          console.warn("Deferred startup task failed: model store init", error);
        });
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => {
        startDeferredModelInit();
      });
    } else {
      globalThis.setTimeout(() => {
        startDeferredModelInit();
      }, 150);
    }
  } catch (error) {
    console.error("Fatal bootstrap error:", error);
    renderBootstrapMessage(
      getUserFacingErrorMessage(error, { t: i18n.t.bind(i18n) }),
    );
  }
};

window.addEventListener("error", (event) => {
  console.error("Unhandled startup error:", event.error || event.message);
  renderBootstrapMessage(
    getUserFacingErrorMessage(event.error || event.message, {
      t: i18n.t.bind(i18n),
    }),
  );
});

window.addEventListener("unhandledrejection", (event) => {
  const reason =
    event.reason instanceof Error
      ? event.reason.message
      : typeof event.reason === "string"
        ? event.reason
        : "unknown rejection";
  console.error("Unhandled startup rejection:", event.reason);
  renderBootstrapMessage(
    getUserFacingErrorMessage(reason, { t: i18n.t.bind(i18n) }),
  );
});

void bootstrap();

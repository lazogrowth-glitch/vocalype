import { useCallback, useEffect, useState, useRef } from "react";
import { toast, Toaster } from "sonner";
import { useTranslation } from "react-i18next";
import { platform } from "@tauri-apps/plugin-os";
import { getIdentifier } from "@tauri-apps/api/app";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { AuthPortal } from "./components/auth/AuthPortal";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import Onboarding, { AccessibilityOnboarding } from "./components/onboarding";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { authClient } from "@/lib/auth/client";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import type { RuntimeErrorEvent } from "@/types/runtimeObservability";

type OnboardingStep = "accessibility" | "model" | "done";

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return <ActiveComponent />;
};

function App() {
  const { i18n, t } = useTranslation();
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  // Track if this is a returning user who just needs to grant permissions
  // (vs a new user who needs full onboarding including model selection)
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("general");
  const { settings, updateSetting } = useSettings();
  const direction = getLanguageDirection(i18n.language);
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const hasCompletedPostOnboardingInit = useRef(false);
  const lastRuntimeErrorRef = useRef<{ key: string; at: number } | null>(null);

  const applySession = useCallback((nextSession: AuthSession | null) => {
    setSession(nextSession);
    setAuthError(null);

    if (nextSession) {
      void authClient.setStoredSession(nextSession);
      return;
    }

    void authClient.clearStoredSession();
    setOnboardingStep(null);
    hasCompletedPostOnboardingInit.current = false;
  }, []);

  const refreshSession = useCallback(async () => {
    const persistedSession = await authClient.hydrateStoredSession();
    if (persistedSession) {
      setSession(persistedSession);
    }

    const token = authClient.getStoredToken();

    if (!token) {
      applySession(null);
      setAuthLoading(false);
      return;
    }

    try {
      const nextSession = await authClient.getSession(token);
      applySession(nextSession);
    } catch (error) {
      console.error("Failed to refresh auth session:", error);
      const status = authClient.getErrorStatus(error);

      if (status === 401 || status === 403) {
        applySession(null);
        setAuthError(t("auth.sessionExpired"));
      } else {
        // Network error or server unavailable — keep cached session silently
        // so the user can still use the app if they were previously authenticated.
        if (!persistedSession) {
          setAuthError(
            error instanceof Error
              ? error.message
              : t("auth.errors.networkError"),
          );
        }
      }
    } finally {
      setAuthLoading(false);
    }
  }, [applySession, t]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Refresh the short-lived access token periodically while the app stays open.
  useEffect(() => {
    const FIVE_MINUTES = 5 * 60 * 1000;
    const interval = setInterval(() => {
      const token = authClient.getStoredToken();
      if (!token) return;
      authClient
        .getSession(token)
        .then((nextSession) => applySession(nextSession))
        .catch((error) => {
          const status = authClient.getErrorStatus(error);
          if (status === 401 || status === 403) {
            applySession(null);
          }
        });
    }, FIVE_MINUTES);
    return () => clearInterval(interval);
  }, [applySession]);

  // Initialize RTL direction when language changes
  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    if (authLoading || !session?.subscription.has_access) {
      return;
    }

    checkOnboardingStatus();
  }, [authLoading, session?.subscription.has_access]);

  // Initialize Enigo, shortcuts, and refresh audio devices when main app loads
  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      Promise.all([
        commands.initializeEnigo(),
        commands.initializeShortcuts(),
      ]).catch((e) => {
        console.warn("Failed to initialize:", e);
      });
      refreshAudioDevices();
      refreshOutputDevices();
    }
  }, [onboardingStep, refreshAudioDevices, refreshOutputDevices]);

  // Handle keyboard shortcuts for debug mode toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+D (Windows/Linux) or Cmd+Shift+D (macOS)
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  // Listen for backend navigation events (e.g., "Show History" shortcut)
  useEffect(() => {
    const unlisten = listen<string>("navigate-to-section", (event) => {
      const section = event.payload as SidebarSection;
      if (section in SECTIONS_CONFIG) {
        setCurrentSection(section);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("whisper-gpu-unavailable", () => {
      toast.warning(t("warnings.whisperGpuUnavailable"), {
        duration: 8000,
        description: t("warnings.whisperGpuUnavailableDesc"),
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<{
      reason?: string;
      copied_to_clipboard?: boolean;
    }>("paste-failed", (event) => {
      const copiedToClipboard = event.payload?.copied_to_clipboard ?? false;
      toast.error(
        copiedToClipboard
          ? t("warnings.pasteFailedCopied")
          : t("warnings.pasteFailed"),
        {
          duration: 8000,
          description: t("warnings.pasteFailedDesc", {
            reason: event.payload?.reason ?? "unknown error",
          }),
        },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<RuntimeErrorEvent>("runtime-error", (event) => {
      const payload = event.payload;
      if (!payload) return;

      const reason = `[${payload.stage}] ${payload.code}: ${payload.message}`;
      const dedupeKey = `${payload.code}:${payload.message}`;
      const now = Date.now();
      const last = lastRuntimeErrorRef.current;

      if (last && last.key === dedupeKey && now - last.at < 1500) {
        return;
      }

      lastRuntimeErrorRef.current = { key: dedupeKey, at: now };

      if (payload.recoverable) {
        toast.warning(
          t("warnings.runtimeIssue", { defaultValue: "Transcription issue" }),
          {
            duration: 8000,
            description: reason,
          },
        );
        return;
      }

      toast.error(
        t("warnings.runtimeFailure", { defaultValue: "Transcription failed" }),
        {
          duration: 8000,
          description: reason,
        },
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  const checkOnboardingStatus = async () => {
    try {
      const appIdentifier = await getIdentifier();
      const isDevFlavor = appIdentifier.endsWith(".dev");

      // Check if they have any models available
      const result = await commands.hasAnyModelsAvailable();
      const hasModels = result.status === "ok" && result.data;

      if (hasModels) {
        // Returning user - but check if they need to grant permissions on macOS
        setIsReturningUser(true);
        if (platform() === "macos" && !isDevFlavor) {
          try {
            const [hasAccessibility, hasMicrophone] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
            ]);
            if (!hasAccessibility || !hasMicrophone) {
              // Missing permissions - show accessibility onboarding
              setOnboardingStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check permissions:", e);
            // If we can't check, proceed to main app and let them fix it there
          }
        }
        setOnboardingStep("done");
      } else {
        // New user - dev flavor skips permissions (can't grant to debug binary)
        setIsReturningUser(false);
        setOnboardingStep(isDevFlavor ? "model" : "accessibility");
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setOnboardingStep("accessibility");
    }
  };

  const handleAccessibilityComplete = () => {
    // Returning users already have models, skip to main app
    // New users need to select a model
    setOnboardingStep(isReturningUser ? "done" : "model");
  };

  const handleModelSelected = () => {
    // Transition to main app - user has started a download
    setOnboardingStep("done");
  };

  const authenticate = useCallback(
    async (
      handler: (payload: AuthPayload) => Promise<AuthSession>,
      payload: AuthPayload,
    ) => {
      setAuthSubmitting(true);
      setAuthError(null);

      try {
        const nextSession = await handler(payload);
        applySession(nextSession);
      } catch (error) {
        console.error("Authentication failed:", error);
        setAuthError(
          error instanceof Error ? error.message : "Authentication failed",
        );
      } finally {
        setAuthSubmitting(false);
      }
    },
    [applySession],
  );

  const handleLogin = useCallback(
    async (payload: AuthPayload) => {
      await authenticate(authClient.login, payload);
    },
    [authenticate],
  );

  const handleRegister = useCallback(
    async (payload: AuthPayload) => {
      await authenticate(authClient.register, payload);
    },
    [authenticate],
  );

  const handleStartCheckout = useCallback(async () => {
    const token = authClient.getStoredToken();
    if (!token) {
      throw new Error("You must be logged in first");
    }

    const result = await authClient.createCheckout(token);
    return result.url;
  }, []);

  const handleOpenBillingPortal = useCallback(async () => {
    const token = authClient.getStoredToken();
    if (!token) {
      throw new Error("You must be logged in first");
    }

    const result = await authClient.createPortal(token);
    return result.url;
  }, []);

  const handleLogout = useCallback(() => {
    applySession(null);
    setAuthLoading(false);
  }, [applySession]);

  // Still checking onboarding status
  if (authLoading) {
    return (
      <div
        dir={direction}
        className="h-screen flex items-center justify-center text-sm text-mid-gray"
      >
        {t("common.loading")}
      </div>
    );
  }

  if (!session?.subscription.has_access) {
    return (
      <AuthPortal
        error={authError}
        isLoading={authLoading}
        isSubmitting={authSubmitting}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onOpenBillingPortal={handleOpenBillingPortal}
        onRefreshSession={refreshSession}
        onRegister={handleRegister}
        onStartCheckout={handleStartCheckout}
        session={session}
      />
    );
  }

  if (onboardingStep === null) {
    return (
      <div
        dir={direction}
        className="h-screen flex items-center justify-center text-sm text-mid-gray"
      >
        {t("common.loading")}
      </div>
    );
  }

  if (onboardingStep === "accessibility") {
    return <AccessibilityOnboarding onComplete={handleAccessibilityComplete} />;
  }

  if (onboardingStep === "model") {
    return <Onboarding onModelSelected={handleModelSelected} />;
  }

  return (
    <div dir={direction} style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: "#0f0f0f", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "inherit" }}>
      <Toaster
        theme="system"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              "bg-background border border-mid-gray/20 rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 text-sm",
            title: "font-medium",
            description: "text-mid-gray",
          },
        }}
      />
      <Sidebar
        activeSection={currentSection}
        onSectionChange={setCurrentSection}
      />

      <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px 28px", minWidth: 0, background: "#0f0f0f" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.3px", color: "#fff", marginBottom: 20 }}>
          {SECTIONS_CONFIG[currentSection]
            ? t(SECTIONS_CONFIG[currentSection].labelKey)
            : t(SECTIONS_CONFIG.general.labelKey)}
        </h1>
        {renderSettingsContent(currentSection)}
      </main>
    </div>
  );
}

export default App;

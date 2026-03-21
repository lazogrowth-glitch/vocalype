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
import { TrialWelcomeModal } from "./components/onboarding/TrialWelcomeModal";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { authClient } from "@/lib/auth/client";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
import { licenseClient } from "@/lib/license/client";
import type { LicenseRuntimeState } from "@/lib/license/types";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import type { RuntimeErrorEvent } from "@/types/runtimeObservability";
import type { StartupWarmupStatusSnapshot } from "@/types/startupWarmup";
import { PlanContext } from "@/lib/plan/context";

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
  const [licenseState, setLicenseState] = useState<LicenseRuntimeState | null>(
    null,
  );
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
  const [showTrialWelcome, setShowTrialWelcome] = useState(false);
  const lastRuntimeErrorRef = useRef<{ key: string; at: number } | null>(null);
  const commandModeCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasAnyAccess =
    licenseState?.state === "online_valid" ||
    licenseState?.state === "offline_valid";

  // Plan comes from the session (authoritative) or falls back to license bundle plan field
  const currentTier = session?.subscription?.tier ?? null;
  const isBasicTier = hasAnyAccess && currentTier === "basic";
  const hasPremiumAccess = hasAnyAccess && currentTier === "premium";
  const isTrialing = session?.subscription?.status === "trialing" && hasPremiumAccess;
  const trialEndsAt = isTrialing ? (session?.subscription?.trial_ends_at ?? null) : null;

  const applySession = useCallback((nextSession: AuthSession | null) => {
    setSession(nextSession);
    setAuthError(null);

    if (nextSession) {
      void authClient.setStoredSession(nextSession);
      return;
    }

    void authClient.clearStoredSession();
    void licenseClient.clearStoredBundle();
    setLicenseState({ state: "expired", reason: "Logged out" });
    setOnboardingStep(null);
    hasCompletedPostOnboardingInit.current = false;
  }, []);

  const syncLicenseForSession = useCallback(
    async (
      nextSession: AuthSession | null,
      options?: { mode?: "issue" | "refresh"; allowOfflineFallback?: boolean },
    ) => {
      if (!nextSession) {
        await licenseClient.clearStoredBundle();
        setLicenseState({ state: "expired", reason: "No session" });
        return;
      }

      if (!nextSession.subscription.has_access) {
        await licenseClient.clearStoredBundle();
        setLicenseState({
          state: "expired",
          reason: "Subscription access inactive",
        });
        return;
      }

      const token = nextSession.token;
      const mode = options?.mode ?? "refresh";

      try {
        if (mode === "issue") {
          await licenseClient.issue(token);
        } else {
          await licenseClient.refresh(token);
        }
      } catch (error) {
        const status = authClient.getErrorStatus(error);
        if (
          options?.allowOfflineFallback &&
          status !== 401 &&
          status !== 403
        ) {
          const runtime = await licenseClient.getRuntimeState();
          setLicenseState(runtime);
          return;
        }

        if (status === 403) {
          await licenseClient.clearStoredBundle();
          setLicenseState({
            state: "expired",
            reason:
              error instanceof Error
                ? error.message
                : "Premium access expired",
          });
          return;
        }

        throw error;
      }

      const runtime = await licenseClient.getRuntimeState();
      setLicenseState(runtime);
    },
    [],
  );

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
      await syncLicenseForSession(nextSession, {
        mode: "refresh",
        allowOfflineFallback: true,
      });
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
          setLicenseState(await licenseClient.getRuntimeState());
        } else {
          setLicenseState(await licenseClient.getRuntimeState());
        }
      }
    } finally {
      setAuthLoading(false);
    }
  }, [applySession, syncLicenseForSession, t]);

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

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Refresh the short-lived access token periodically while the app stays open.
  useEffect(() => {
    const SEVENTEEN_MINUTES = 17 * 60 * 1000;
    const interval = setInterval(() => {
      const token = authClient.getStoredToken();
      if (!token) return;
      authClient
        .getSession(token)
        .then(async (nextSession) => {
          applySession(nextSession);
          await syncLicenseForSession(nextSession, {
            mode: "refresh",
            allowOfflineFallback: true,
          });
        })
        .catch((error) => {
          const status = authClient.getErrorStatus(error);
          if (status === 401 || status === 403) {
            applySession(null);
          }
        });
    }, SEVENTEEN_MINUTES);
    return () => clearInterval(interval);
  }, [applySession, syncLicenseForSession]);

  // Initialize RTL direction when language changes
  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    if (authLoading || !hasAnyAccess) {
      return;
    }

    checkOnboardingStatus();
  }, [authLoading, hasAnyAccess]);

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

  useEffect(() => {
    const unlisten = listen<string | StartupWarmupStatusSnapshot>(
      "transcription-warmup-blocked",
      (event) => {
        const message =
          typeof event.payload === "string"
            ? event.payload
            : event.payload?.message || "Preparation du micro...";

        toast(message, {
          duration: 3000,
          description:
            "La dictee sera disponible automatiquement des que le moteur est pret.",
        });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // J12 trial reminder — shown once when the backend flags show_trial_reminder.
  const trialReminderShownRef = useRef(false);
  useEffect(() => {
    if (session?.show_trial_reminder && !trialReminderShownRef.current) {
      trialReminderShownRef.current = true;
      toast.warning(
        t("trial.reminder.title", { defaultValue: "Ton trial expire bientôt" }),
        {
          duration: Infinity,
          description: t("trial.reminder.desc", {
            defaultValue: "Passe à Premium pour garder l'injection native, tes raccourcis et tes transcriptions illimitées.",
          }),
          action: {
            label: t("trial.reminder.cta", { defaultValue: "Passer à Premium →" }),
            onClick: () => {
              handleStartCheckout()
                .then((url) => { if (url) window.open(url, "_blank"); })
                .catch(() => {});
            },
          },
        },
      );
    }
  }, [session?.show_trial_reminder, t, handleStartCheckout]);

  useEffect(() => {
    const unlisten = listen("basic-copied-to-clipboard", () => {
      toast.info(t("basic.copiedToClipboard", { defaultValue: "Texte copié dans le presse-papier" }), {
        duration: 5000,
        description: t("basic.copiedToClipboardDesc", {
          defaultValue: "L'injection directe est réservée au plan Premium.",
        }),
        action: {
          label: t("basic.seePremium", { defaultValue: "Voir Premium →" }),
          onClick: () => {
            handleStartCheckout()
              .then((url) => { if (url) window.open(url, "_blank"); })
              .catch(() => {});
          },
        },
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, handleStartCheckout]);

  useEffect(() => {
    const unlisten = listen<{ count: number; limit: number }>(
      "transcription-quota-exceeded",
      (event) => {
        const { count, limit } = event.payload;
        toast.error(
          t("basic.quotaExceeded", { defaultValue: "Limite atteinte pour cette semaine" }),
          {
            duration: Infinity,
            description: t("basic.quotaExceededDesc", {
              defaultValue: "Passe à Premium pour dicter sans limite.",
            }),
            action: {
              label: t("basic.upgradeCta", { defaultValue: "Passer à Premium →" }),
              onClick: () => {
                handleStartCheckout()
                  .then((url) => { if (url) window.open(url, "_blank"); })
                  .catch(() => {});
              },
            },
          },
        );
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<string>("premium-access-denied", async (event) => {
      const runtime = await licenseClient.getRuntimeState();
      setLicenseState(runtime);
      toast.error(
        t("auth.locked", { defaultValue: "Premium access required" }),
        {
          duration: 8000,
          description:
            event.payload ||
            t("auth.errors.networkError", {
              defaultValue: "Reconnect to validate your subscription.",
            }),
        },
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // ── Command Mode event listeners ──────────────────────────────────────────

  /** Clears the countdown interval if one is running. */
  const clearCommandModeCountdown = useCallback(() => {
    if (commandModeCountdownRef.current !== null) {
      clearInterval(commandModeCountdownRef.current);
      commandModeCountdownRef.current = null;
    }
  }, []);

  // command-mode-started → loading toast with live countdown
  useEffect(() => {
    const unlisten = listen<{ max_duration_secs: number }>(
      "command-mode-started",
      (event) => {
        const maxSecs = event.payload?.max_duration_secs ?? 8;
        let remaining = maxSecs;

        clearCommandModeCountdown();

        toast.loading(
          t("commandMode.recording", { count: remaining, defaultValue: `Parle maintenant… (${remaining}s)` }),
          { id: "command-mode", duration: Infinity },
        );

        commandModeCountdownRef.current = setInterval(() => {
          remaining -= 1;
          if (remaining > 0) {
            toast.loading(
              t("commandMode.recording", { count: remaining, defaultValue: `Parle maintenant… (${remaining}s)` }),
              { id: "command-mode", duration: Infinity },
            );
          } else {
            clearCommandModeCountdown();
          }
        }, 1000);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, clearCommandModeCountdown]);

  // command-mode-processing → swap to spinner "Traitement en cours…"
  useEffect(() => {
    const unlisten = listen("command-mode-processing", () => {
      clearCommandModeCountdown();
      toast.loading(
        t("commandMode.processing", { defaultValue: "Traitement en cours…" }),
        { id: "command-mode", duration: Infinity },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, clearCommandModeCountdown]);

  // command-mode-finished → dismiss the loading toast silently
  useEffect(() => {
    const unlisten = listen("command-mode-finished", () => {
      clearCommandModeCountdown();
      toast.dismiss("command-mode");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [clearCommandModeCountdown]);

  // command-mode-error → dismiss loading toast + show error toast
  useEffect(() => {
    const unlisten = listen<{ message: string }>("command-mode-error", (event) => {
      clearCommandModeCountdown();
      toast.dismiss("command-mode");
      toast.error(
        t("commandMode.errorTitle", { defaultValue: "Command Mode — erreur" }),
        {
          duration: 6000,
          description: event.payload?.message,
        },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, clearCommandModeCountdown]);

  // ── End Command Mode listeners ─────────────────────────────────────────────

  // ── Whisper Mode event listeners ──────────────────────────────────────────

  // whisper-mode-changed → brief success toast with current state
  useEffect(() => {
    const unlisten = listen<boolean>("whisper-mode-changed", (event) => {
      const enabled = event.payload;
      if (enabled) {
        toast.success(t("whisperMode.enabled", { defaultValue: "Whisper Mode on" }), {
          duration: 2500,
        });
      } else {
        toast(t("whisperMode.disabled", { defaultValue: "Whisper Mode off" }), {
          duration: 2500,
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // whisper-mode-error → error toast
  useEffect(() => {
    const unlisten = listen<string>("whisper-mode-error", (event) => {
      toast.error(t("whisperMode.errorTitle", { defaultValue: "Whisper Mode — error" }), {
        duration: 6000,
        description: event.payload,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // ── End Whisper Mode listeners ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const reportIfNeeded = async () => {
      const token = authClient.getStoredToken();
      if (!token) return;

      const runtime = await licenseClient.getRuntimeState();
      if (cancelled) return;

      if (
        runtime.reason?.includes("Binary integrity changed") ||
        (runtime.integrity_anomalies?.length ?? 0) > 0
      ) {
        try {
          const integrity = await licenseClient.getIntegritySnapshot();
          await licenseClient.reportAnomaly(token, "desktop_integrity_runtime", {
            runtime,
            integrity,
          });
        } catch (error) {
          console.warn("Failed to report integrity anomaly:", error);
        }
      }
    };

    void reportIfNeeded();

    return () => {
      cancelled = true;
    };
  }, [licenseState]);

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
        await syncLicenseForSession(nextSession, { mode: "issue" });
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
    [applySession, syncLicenseForSession],
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
      // Show the trial welcome modal on first registration if user is trialing
      const newSession = authClient.getStoredSession();
      if (newSession?.subscription.status === "trialing") {
        const seen = await authClient.hasSeenTrialWelcome();
        if (!seen) setShowTrialWelcome(true);
      }
    },
    [authenticate],
  );

  const handleDismissTrialWelcome = useCallback(async () => {
    setShowTrialWelcome(false);
    await authClient.markTrialWelcomeSeen();
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

  if (!session || !hasAnyAccess) {
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
    return (
      <>
        <Onboarding onModelSelected={handleModelSelected} />
        {showTrialWelcome && (
          <TrialWelcomeModal onDismiss={handleDismissTrialWelcome} />
        )}
      </>
    );
  }

  return (
    <PlanContext.Provider
      value={{
        isBasicTier,
        isTrialing,
        trialEndsAt,
        quota: session?.subscription?.quota ?? null,
        onStartCheckout: handleStartCheckout,
      }}
    >
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
    </PlanContext.Provider>
  );
}

export default App;

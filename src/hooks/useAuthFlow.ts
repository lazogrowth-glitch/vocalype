import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { authClient } from "@/lib/auth/client";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
import { licenseClient } from "@/lib/license/client";
import type { LicenseRuntimeState } from "@/lib/license/types";

export function useAuthFlow(t: (key: string, options?: Record<string, unknown>) => string) {
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [licenseState, setLicenseState] = useState<LicenseRuntimeState | null>(null);
  const [showTrialWelcome, setShowTrialWelcome] = useState(false);
  const hasCompletedPostOnboardingInit = useRef(false);
  const trialReminderShownRef = useRef(false);

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
        if (options?.allowOfflineFallback && status !== 401 && status !== 403) {
          const runtime = await licenseClient.getRuntimeState();
          setLicenseState(runtime);
          return;
        }

        if (status === 403) {
          await licenseClient.clearStoredBundle();
          setLicenseState({
            state: "expired",
            reason:
              error instanceof Error ? error.message : "Premium access expired",
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

  // Initial session load on mount
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Refresh short-lived token every 17 minutes
  useEffect(() => {
    const SEVENTEEN_MINUTES = 17 * 60 * 1000;
    let isRefreshing = false;
    const interval = setInterval(() => {
      if (isRefreshing) return;
      const token = authClient.getStoredToken();
      if (!token) return;
      isRefreshing = true;
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
        })
        .finally(() => {
          isRefreshing = false;
        });
    }, SEVENTEEN_MINUTES);
    return () => clearInterval(interval);
  }, [applySession, syncLicenseForSession]);

  // J12 trial reminder
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

  // Basic plan: text copied to clipboard instead of injected
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

  // Basic plan: weekly quota exceeded
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
        void count; void limit;
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t, handleStartCheckout]);

  // Premium access denied: refresh license state and show error
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

  // Integrity anomaly reporting
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

  return {
    session,
    authLoading,
    authSubmitting,
    authError,
    licenseState,
    showTrialWelcome,
    hasCompletedPostOnboardingInit,
    applySession,
    refreshSession,
    handleLogin,
    handleRegister,
    handleLogout,
    handleDismissTrialWelcome,
    handleStartCheckout,
    handleOpenBillingPortal,
  };
}

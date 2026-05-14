import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { authClient } from "@/lib/auth/client";
import type {
  AuthPayload,
  AuthSession,
  BillingCheckoutRequest,
} from "@/lib/auth/types";
import { licenseClient } from "@/lib/license/client";
import type { LicenseRuntimeState } from "@/lib/license/types";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { useSessionRefresh } from "./useSessionRefresh";

export type ActivationStatus =
  | "logged_out"
  | "checking_activation"
  | "subscription_inactive"
  | "activation_failed"
  | "ready";

const isExpectedMissingLicenseMessage = (value: unknown) => {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "";
  return message.toLowerCase().includes("no stored license bundle");
};

const deriveActivationStatus = ({
  session,
  licenseState,
  authLoading,
  authSubmitting,
  authError,
}: {
  session: AuthSession | null;
  licenseState: LicenseRuntimeState | null;
  authLoading: boolean;
  authSubmitting: boolean;
  authError: string | null;
}): ActivationStatus => {
  if (!session) return "logged_out";
  if (!session.subscription.has_access) return "subscription_inactive";

  if (
    licenseState?.state === "online_valid" ||
    licenseState?.state === "offline_valid"
  ) {
    return "ready";
  }

  if (authLoading || authSubmitting) return "checking_activation";
  if (authError || licenseState?.reason === "Activation failed") {
    return "activation_failed";
  }

  return "checking_activation";
};

export function useAuthFlow(
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [licenseState, setLicenseState] = useState<LicenseRuntimeState | null>(
    null,
  );
  const [showTrialWelcome, setShowTrialWelcome] = useState(false);
  const hasCompletedPostOnboardingInit = useRef(false);
  const trialReminderShownRef = useRef(false);
  const reportedIntegritySignatureRef = useRef<string | null>(null);

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
          try {
            await licenseClient.refresh(token);
          } catch (refreshError) {
            const refreshStatus = authClient.getErrorStatus(refreshError);
            if (refreshStatus !== 401 && refreshStatus !== 403) {
              // No existing license to refresh — try issuing a new one
              await licenseClient.issue(token);
            } else {
              throw refreshError;
            }
          }
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
      try {
        await syncLicenseForSession(nextSession, {
          mode: "refresh",
          allowOfflineFallback: true,
        });
      } catch (licenseError) {
        console.warn(
          "License sync failed after session refresh:",
          licenseError,
        );
        if (!isExpectedMissingLicenseMessage(licenseError)) {
          setAuthError(
            getUserFacingErrorMessage(licenseError, { t, context: "auth" }),
          );
        }
        try {
          setLicenseState(await licenseClient.getRuntimeState());
        } catch {
          setLicenseState({
            state: "expired",
            reason: "Activation failed",
          });
        }
      }
    } catch (error) {
      const status = authClient.getErrorStatus(error);

      if (status === 401 || status === 403) {
        // Access token expired — try silent refresh with the refresh token.
        if (authClient.getStoredRefreshToken()) {
          try {
            const refreshed = await authClient.refreshAccessToken();
            applySession(refreshed);
            await syncLicenseForSession(refreshed, {
              mode: "refresh",
              allowOfflineFallback: true,
            });
            return; // Silently recovered — user sees nothing.
          } catch {
            // Refresh token also expired/revoked — fall through to offline/logout.
          }
        }

        // No usable refresh token — try staying alive with the offline license.
        try {
          const offlineRuntime = await licenseClient.getRuntimeState();
          if (offlineRuntime.state === "offline_valid" && persistedSession) {
            setLicenseState(offlineRuntime);
            toast(
              t("auth.sessionExpiredNotice", {
                defaultValue:
                  "Session expirée — reconnectez-vous pour continuer",
              }),
              {
                action: {
                  label: t("auth.reconnect", {
                    defaultValue: "Se reconnecter",
                  }),
                  onClick: () => applySession(null),
                },
                duration: 8000,
              },
            );
            return;
          }
        } catch {
          // Can't read offline license — fall through to logout.
        }
      }

      // Nothing worked — clear everything and show login.
      applySession(null);
      setAuthError("auth.sessionExpired");
      void authClient.clearStoredToken();
    } finally {
      setAuthLoading(false);
    }
  }, [applySession, syncLicenseForSession, setLicenseState, t]);

  const handleStartCheckout = useCallback(
    async (selection?: BillingCheckoutRequest) => {
      const token = authClient.getStoredToken();
      if (!token) {
        throw new Error("You must be logged in first");
      }
      const result = await authClient.createCheckout(token, selection);
      return result.url;
    },
    [],
  );

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
        setAuthError(getUserFacingErrorMessage(error, { t, context: "auth" }));
      } finally {
        setAuthSubmitting(false);
      }
    },
    [applySession, syncLicenseForSession],
  );

  const handleDeepLinkAuth = useCallback(
    async (token: string) => {
      setAuthSubmitting(true);
      setAuthError(null);
      try {
        await authClient.setStoredToken(token);
        const nextSession = await authClient.getSession(token);
        applySession(nextSession);
        try {
          await syncLicenseForSession(nextSession, { mode: "issue" });
        } catch (licenseError) {
          if (!isExpectedMissingLicenseMessage(licenseError)) {
            setAuthError(
              getUserFacingErrorMessage(licenseError, { t, context: "auth" }),
            );
          }
          try {
            setLicenseState(await licenseClient.getRuntimeState());
          } catch {
            setLicenseState({
              state: "expired",
              reason: "Activation failed",
            });
          }
        }
      } catch (error) {
        setAuthError(getUserFacingErrorMessage(error, { t, context: "auth" }));
      } finally {
        setAuthLoading(false);
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

  // Keep the session alive: refreshes every 17 min and on visibility change.
  useSessionRefresh({ applySession, syncLicenseForSession });

  // When the Rust side detects a 401 from vocalype-cloud (expired JWT),
  // silently refresh the session so the next cloud call succeeds.
  useEffect(() => {
    const unlisten = listen("vocalype:cloud-session-expired", () => {
      refreshSession();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshSession]);

  // J12 trial reminder
  useEffect(() => {
    if (session?.show_trial_reminder && !trialReminderShownRef.current) {
      trialReminderShownRef.current = true;
      toast.warning(
        t("trial.reminder.title", { defaultValue: "Ton trial expire bientôt" }),
        {
          duration: Infinity,
          description: t("trial.reminder.desc", {
            defaultValue:
              "Passe à Premium pour garder l'injection native, tes raccourcis et tes transcriptions illimitées.",
          }),
          action: {
            label: t("trial.reminder.cta", {
              defaultValue: "Passer à Premium →",
            }),
            onClick: () => {
              handleStartCheckout()
                .then((url) => {
                  if (url) window.open(url, "_blank");
                })
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
      toast.info(
        t("basic.copiedToClipboard", {
          defaultValue: "Texte copié dans le presse-papier",
        }),
        {
          duration: 5000,
          description: t("basic.copiedToClipboardDesc", {
            defaultValue: "L'injection directe est réservée au plan Premium.",
          }),
          action: {
            label: t("basic.seePremium", { defaultValue: "Voir Premium →" }),
            onClick: () => {
              handleStartCheckout()
                .then((url) => {
                  if (url) window.open(url, "_blank");
                })
                .catch(() => {});
            },
          },
        },
      );
    });
    return () => {
      unlisten.then((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, [t, handleStartCheckout]);

  // Basic plan: weekly quota exceeded
  useEffect(() => {
    const unlisten = listen<{ count: number; limit: number }>(
      "transcription-quota-exceeded",
      (event) => {
        const { count, limit } = event.payload;
        toast.error(
          t("basic.quotaExceeded", {
            defaultValue: "Limite atteinte pour cette semaine",
          }),
          {
            duration: Infinity,
            description: t("basic.quotaExceededDesc", {
              defaultValue: "Passe à Premium pour dicter sans limite.",
            }),
            action: {
              label: t("basic.upgradeCta", {
                defaultValue: "Passer à Premium →",
              }),
              onClick: () => {
                handleStartCheckout()
                  .then((url) => {
                    if (url) window.open(url, "_blank");
                  })
                  .catch(() => {});
              },
            },
          },
        );
        void count;
        void limit;
      },
    );
    return () => {
      unlisten.then((fn) => {
        try {
          fn();
        } catch {}
      });
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
          description: getUserFacingErrorMessage(event.payload, {
            t,
            context: "auth",
            fallback: t("auth.errors.networkError", {
              defaultValue: "Reconnectez-vous pour valider votre abonnement.",
            }),
          }),
        },
      );
    });
    return () => {
      unlisten.then((fn) => {
        try {
          fn();
        } catch {}
      });
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
        const signature = JSON.stringify({
          reason: runtime.reason ?? null,
          anomalies: runtime.integrity_anomalies ?? [],
        });
        if (reportedIntegritySignatureRef.current === signature) {
          return;
        }
        try {
          const integrity = await licenseClient.getIntegritySnapshot();
          await licenseClient.reportAnomaly(
            token,
            "desktop_integrity_runtime",
            {
              runtime,
              integrity,
            },
          );
          reportedIntegritySignatureRef.current = signature;
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

  const activationStatus = deriveActivationStatus({
    session,
    licenseState,
    authLoading,
    authSubmitting,
    authError,
  });

  return {
    session,
    authLoading,
    authSubmitting,
    authError,
    activationStatus,
    licenseState,
    showTrialWelcome,
    hasCompletedPostOnboardingInit,
    applySession,
    refreshSession,
    handleDeepLinkAuth,
    handleLogin,
    handleRegister,
    handleLogout,
    handleDismissTrialWelcome,
    handleStartCheckout,
    handleOpenBillingPortal,
  };
}

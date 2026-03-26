/**
 * useSessionRefresh — keeps the auth session alive in the background.
 *
 * Runs a periodic refresh every 17 minutes AND immediately whenever the app
 * becomes visible again (wake from sleep, window focus after tab switch).
 *
 * This hook is intentionally stateless: it delegates all state mutations to
 * the `applySession` and `syncLicenseForSession` callbacks supplied by the
 * parent hook (`useAuthFlow`).
 */
import { useEffect } from "react";
import { authClient } from "@/lib/auth/client";
import { licenseClient } from "@/lib/license/client";
import type { AuthSession } from "@/lib/auth/types";

const REFRESH_INTERVAL_MS = 17 * 60 * 1000;

interface UseSessionRefreshOptions {
  applySession: (session: AuthSession | null) => void;
  syncLicenseForSession: (
    session: AuthSession | null,
    options?: { mode?: "issue" | "refresh"; allowOfflineFallback?: boolean },
  ) => Promise<void>;
}

export function useSessionRefresh({
  applySession,
  syncLicenseForSession,
}: UseSessionRefreshOptions): void {
  useEffect(() => {
    let isRefreshing = false;

    const doRefresh = () => {
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
            // Token expired — only log out if the offline license also expired.
            licenseClient
              .getRuntimeState()
              .then((runtime) => {
                if (runtime.state !== "offline_valid") {
                  applySession(null);
                }
                // else: offline license still valid, stay quiet and keep session
              })
              .catch(() => applySession(null));
          }
        })
        .finally(() => {
          isRefreshing = false;
        });
    };

    const interval = setInterval(doRefresh, REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        doRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [applySession, syncLicenseForSession]);
}

/* eslint-disable i18next/no-literal-string */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { commands } from "@/bindings";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";

interface AuthPortalProps {
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  session: AuthSession | null;
  onLogin: (payload: AuthPayload) => Promise<void>;
  onRegister: (payload: AuthPayload) => Promise<void>;
  onStartCheckout: () => Promise<string>;
  onOpenBillingPortal: () => Promise<string>;
  onRefreshSession: () => Promise<void>;
  onLogout: () => void;
}

const AUTH_SIGNUP_URL = "https://vocalype.com/signup?source=desktop";
const AUTH_LOGIN_URL = "https://vocalype.com/login?source=desktop";
const PRIVACY_URL = "https://vocalype.com/privacy";
const TERMS_URL = "https://vocalype.com/terms";

const buildBrowserAuthUrl = (intent: "signup" | "login", state: string) => {
  const url = new URL(intent === "signup" ? AUTH_SIGNUP_URL : AUTH_LOGIN_URL);
  url.searchParams.set("source", "desktop");
  url.searchParams.set("state", state);
  return url.toString();
};

const buttonBaseStyle: CSSProperties = {
  width: "100%",
  borderRadius: 8,
  padding: "13px 16px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 800,
  transition: "opacity 160ms ease, background 160ms ease, transform 160ms ease",
};

const getStatusText = (session: AuthSession | null, isRefreshing: boolean) => {
  if (isRefreshing) return "Synchronisation de votre acces...";
  if (!session) return "Connectez-vous pour activer Vocalype sur ce PC.";
  if (session.subscription.has_access) {
    return "Compte detecte. Activation en cours...";
  }
  return "Compte detecte. Finalisez l'abonnement dans le navigateur.";
};

export const AuthPortal = ({
  isLoading,
  isSubmitting,
  error,
  session,
  onStartCheckout,
  onRefreshSession,
  onLogout,
}: AuthPortalProps) => {
  const [browserBusy, setBrowserBusy] = useState<"signup" | "login" | null>(
    null,
  );
  const [billingBusy, setBillingBusy] = useState(false);
  const [autoRefreshBusy, setAutoRefreshBusy] = useState(false);
  const refreshAttemptRef = useRef(0);

  const hasAccess = session?.subscription.has_access ?? false;
  const canInteract =
    !isLoading && !isSubmitting && !autoRefreshBusy && browserBusy === null;
  const displayError = error?.trim() ?? null;

  useEffect(() => {
    if (!session) {
      refreshAttemptRef.current = 0;
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const refresh = async () => {
      if (cancelled || refreshAttemptRef.current >= 8) return;
      refreshAttemptRef.current += 1;
      setAutoRefreshBusy(true);
      try {
        await onRefreshSession();
      } catch {
        // Keep the auth screen calm. A visible error from the auth flow still renders below.
      } finally {
        if (!cancelled) setAutoRefreshBusy(false);
      }

      if (!cancelled && refreshAttemptRef.current < 8) {
        timer = window.setTimeout(refresh, 2500);
      }
    };

    void refresh();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [session?.user.email, session?.subscription.status, onRefreshSession]);

  const openBrowserAuth = async (intent: "signup" | "login") => {
    setBrowserBusy(intent);
    try {
      const result = await commands.startBrowserAuth();
      if (result.status !== "ok") {
        throw new Error(result.error);
      }
      await openUrl(buildBrowserAuthUrl(intent, result.data));
    } catch (openError) {
      const message =
        openError instanceof Error
          ? openError.message
          : "Impossible d'ouvrir le navigateur.";
      toast.error("Ouverture impossible", { description: message });
    } finally {
      setBrowserBusy(null);
    }
  };

  const openBillingLink = async (action: () => Promise<string>) => {
    setBillingBusy(true);
    try {
      const url = await action();
      await openUrl(url);
    } catch (billingError) {
      const message =
        billingError instanceof Error
          ? billingError.message
          : "Impossible d'ouvrir la facturation.";
      toast.error("Ouverture impossible", { description: message });
    } finally {
      setBillingBusy(false);
    }
  };

  const primaryAction =
    session && hasAccess ? (
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          border: "1px solid rgba(136,224,189,0.2)",
          background: "rgba(136,224,189,0.1)",
          color: "#88e0bd",
          cursor: "default",
        }}
        disabled
      >
        <Loader2 size={16} className="animate-spin" />
        Activation automatique...
      </button>
    ) : session ? (
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          border: "1px solid rgba(231,201,119,0.24)",
          background: "#d5b45b",
          color: "#080808",
          opacity: billingBusy ? 0.7 : 1,
        }}
        disabled={billingBusy}
        onClick={() => openBillingLink(onStartCheckout)}
      >
        {billingBusy ? <Loader2 size={16} className="animate-spin" /> : null}
        Activer Vocalype
      </button>
    ) : (
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          border: "1px solid rgba(231,201,119,0.24)",
          background: "#d5b45b",
          color: "#080808",
          opacity: browserBusy === "signup" ? 0.7 : 1,
        }}
        disabled={!canInteract}
        onClick={() => openBrowserAuth("signup")}
      >
        {browserBusy === "signup" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ExternalLink size={16} />
        )}
        Creer un compte
      </button>
    );

  return (
    <main
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background:
          "linear-gradient(180deg, #0d0d0d 0%, #080808 52%, #050505 100%)",
        color: "#f3ecdf",
        fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif',
        display: "grid",
        placeItems: "center",
        padding: "clamp(16px, 4vw, 36px)",
        boxSizing: "border-box",
        overscrollBehavior: "none",
      }}
    >
      <section
        style={{
          width: "min(100%, 420px)",
          maxHeight: "100%",
          overflowY: "auto",
          overscrollBehavior: "contain",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          background: "rgba(255,255,255,0.035)",
          padding: "clamp(18px, 4vw, 28px)",
          boxSizing: "border-box",
          boxShadow: "0 24px 70px rgba(0,0,0,0.34)",
        }}
      >
        <div
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 28,
            fontWeight: 800,
            color: "#f6efe4",
            marginBottom: 18,
          }}
        >
          Vocal<span style={{ color: "#d5b45b" }}>ype</span>
        </div>

        <h1
          style={{
            margin: 0,
            marginBottom: 10,
            fontFamily: "'Syne', sans-serif",
            fontSize: "clamp(28px, 8vw, 40px)",
            lineHeight: 1,
            color: "#f7f1e7",
          }}
        >
          Connectez-vous.
        </h1>

        <p
          style={{
            margin: 0,
            marginBottom: 22,
            fontSize: 14,
            lineHeight: 1.55,
            color: "rgba(243,236,223,0.62)",
          }}
        >
          Vocalype s'active automatiquement apres la connexion dans le
          navigateur.
        </p>

        {session ? (
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              background: "rgba(0,0,0,0.22)",
              padding: 14,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "#f7f1e7",
                overflowWrap: "anywhere",
              }}
            >
              {session.user.email}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 13,
                lineHeight: 1.45,
                color: hasAccess ? "#88e0bd" : "rgba(243,236,223,0.58)",
              }}
            >
              {getStatusText(session, autoRefreshBusy)}
            </div>
          </div>
        ) : null}

        {displayError ? (
          <div
            style={{
              marginBottom: 14,
              borderRadius: 8,
              border: "1px solid rgba(248,113,113,0.2)",
              background: "rgba(248,113,113,0.08)",
              color: "#f7b0b0",
              padding: "12px 13px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <ShieldAlert size={17} style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ lineHeight: 1.45, fontSize: 13 }}>{displayError}</div>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 8 }}>
          {primaryAction}

          {!session ? (
            <button
              type="button"
              style={{
                ...buttonBaseStyle,
                border: "1px solid rgba(255,255,255,0.09)",
                background: "rgba(255,255,255,0.055)",
                color: "#f3ecdf",
                opacity: browserBusy === "login" ? 0.7 : 1,
              }}
              disabled={!canInteract}
              onClick={() => openBrowserAuth("login")}
            >
              {browserBusy === "login" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ExternalLink size={16} />
              )}
              J'ai deja un compte
            </button>
          ) : (
            <button
              type="button"
              style={{
                ...buttonBaseStyle,
                border: "1px solid rgba(255,255,255,0.09)",
                background: "transparent",
                color: "rgba(243,236,223,0.74)",
              }}
              onClick={onLogout}
            >
              <LogOut size={16} />
              Se deconnecter
            </button>
          )}
        </div>

        <p
          style={{
            margin: "16px 0 0",
            fontSize: 12,
            lineHeight: 1.55,
            color: "rgba(243,236,223,0.4)",
          }}
        >
          En continuant, vous acceptez les{" "}
          <button
            type="button"
            style={{
              background: "transparent",
              border: "none",
              color: "#d5b45b",
              padding: 0,
              cursor: "pointer",
              font: "inherit",
            }}
            onClick={() => openUrl(TERMS_URL)}
          >
            Conditions
          </button>{" "}
          et la{" "}
          <button
            type="button"
            style={{
              background: "transparent",
              border: "none",
              color: "#d5b45b",
              padding: 0,
              cursor: "pointer",
              font: "inherit",
            }}
            onClick={() => openUrl(PRIVACY_URL)}
          >
            Confidentialite
          </button>
          .
        </p>
      </section>
    </main>
  );
};

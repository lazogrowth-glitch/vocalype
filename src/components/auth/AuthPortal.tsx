/* eslint-disable i18next/no-literal-string */
import { useEffect, useRef, useState, useMemo } from "react";
import { Loader2, RefreshCw, ShieldAlert, LogOut } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type {
  AuthPayload,
  AuthSession,
  BillingCheckoutRequest,
} from "@/lib/auth/types";
import type { ActivationStatus } from "@/hooks/useAuthFlow";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import appLogo from "@/assets/logo.png";
import { useModelStore } from "@/stores/modelStore";
import "./AuthPortal.css";

const MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";

// ── Typewriter phrases ─────────────────────────────────────────────────────────
const PHRASES = [
  "Salut Alex, je viens de finir la prep du pitch — je t'envoie le deck dans la soirée.",
  "Note pour moi : revoir la grille tarifaire avant la réunion de mardi.",
  "Peux-tu valider le wireframe avant 17 h ? J'aimerais lancer le dev demain matin.",
];

// ── Model download badge (bottom-fixed) ───────────────────────────────────────
const ModelDownloadBadge: React.FC = () => {
  const {
    downloadingModels,
    extractingModels,
    getDownloadProgress,
    isFirstRun,
  } = useModelStore();
  const isDownloading = MODEL_ID in downloadingModels;
  const isExtracting = MODEL_ID in extractingModels;
  if (!isFirstRun && !isDownloading && !isExtracting) return null;
  const progress = getDownloadProgress(MODEL_ID);
  const pct = progress?.percentage ?? 0;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(100% - 32px, 360px)",
        zIndex: 20,
      }}
    >
      <div
        style={{
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(18,18,18,0.95)",
          padding: "10px 14px",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 6,
          }}
        >
          <span>
            {isExtracting
              ? "Préparation du modèle…"
              : "Téléchargement du modèle vocal"}
          </span>
          {isDownloading && !isExtracting && pct > 0 && (
            <span>{Math.round(pct)}%</span>
          )}
        </div>
        <div
          style={{
            height: 3,
            borderRadius: 99,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 99,
              background: "rgba(100,140,255,0.7)",
              width: isExtracting ? "100%" : `${pct}%`,
              transition: "width 0.3s ease",
              opacity: isExtracting ? 0.5 : 1,
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ── Waveform ──────────────────────────────────────────────────────────────────
const Waveform: React.FC = () => {
  const bars = useMemo(
    () =>
      Array.from({ length: 52 }, () => ({
        delay: (Math.random() * 1.1).toFixed(2),
        duration: (0.7 + Math.random() * 1.0).toFixed(2),
        opacity: (0.4 + Math.random() * 0.6).toFixed(2),
      })),
    [],
  );
  return (
    <div
      style={{
        marginTop: 14,
        height: 48,
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "0 4px",
      }}
    >
      {bars.map((b, i) => (
        <div
          key={i}
          className="auth-wave-bar"
          style={{
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            opacity: Number(b.opacity),
          }}
        />
      ))}
    </div>
  );
};

// ── Typewriter ────────────────────────────────────────────────────────────────
const Typewriter: React.FC = () => {
  const [typed, setTyped] = useState("");
  const stateRef = useRef({ pi: 0, ci: 0, deleting: false });

  useEffect(() => {
    let timer: number;
    const tick = () => {
      const s = stateRef.current;
      const p = PHRASES[s.pi];
      if (!s.deleting) {
        s.ci++;
        setTyped(p.slice(0, s.ci));
        if (s.ci >= p.length) {
          s.deleting = true;
          timer = window.setTimeout(tick, 1800);
          return;
        }
        timer = window.setTimeout(tick, 28 + Math.random() * 28);
      } else {
        s.ci = Math.max(0, s.ci - 4);
        setTyped(p.slice(0, s.ci));
        if (s.ci <= 0) {
          s.deleting = false;
          s.pi = (s.pi + 1) % PHRASES.length;
          timer = window.setTimeout(tick, 350);
          return;
        }
        timer = window.setTimeout(tick, 14);
      }
    };
    timer = window.setTimeout(tick, 600);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        marginTop: 14,
        padding: "14px 16px",
        background: "#0c0c0e",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        minHeight: 96,
        fontSize: 15,
        lineHeight: 1.6,
        color: "#b6b6bd",
        position: "relative",
      }}
    >
      <span style={{ color: "#ededee" }}>{typed}</span>
      <span className="auth-cursor" />
    </div>
  );
};

// ── Showcase (left panel) ──────────────────────────────────────────────────────
const Showcase: React.FC = () => (
  <aside className="auth-showcase">
    {/* Brand */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        position: "relative",
        zIndex: 2,
        flexShrink: 0,
      }}
    >
      <img
        src={appLogo}
        alt="Vocalype"
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: "-0.005em",
          color: "#ededee",
        }}
      >
        Vocal<span style={{ color: "#d4a858" }}>ype</span>
      </div>
      <div
        style={{
          marginLeft: "auto",
          fontSize: 11,
          letterSpacing: "0.14em",
          fontWeight: 600,
          color: "#82828b",
          textTransform: "uppercase",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span className="auth-live-dot" />
        Service en ligne
      </div>
    </div>

    {/* Hero */}
    <div
      style={{
        marginTop: "clamp(20px, 4vh, 48px)",
        position: "relative",
        zIndex: 2,
        maxWidth: 540,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 26,
          padding: "0 11px",
          border: "1px solid rgba(212,168,88,0.32)",
          background: "rgba(212,168,88,0.14)",
          color: "#d4a858",
          borderRadius: 999,
          fontSize: 11.5,
          letterSpacing: "0.08em",
          fontWeight: 600,
          textTransform: "uppercase",
        }}
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x={9} y={3} width={6} height={12} rx={3} />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1={12} y1={18} x2={12} y2={22} />
        </svg>
        La dictée qui te ressemble
      </span>

      <h1
        style={{
          margin: "clamp(10px, 2vh, 18px) 0 0",
          fontSize: "clamp(32px, 4.5vw, 54px)",
          lineHeight: 1.04,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: "#ededee",
        }}
      >
        Parle.
        <br />
        Vocalype{" "}
        <em
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontStyle: "italic",
            fontWeight: 400,
            color: "#d4a858",
            letterSpacing: "-0.01em",
          }}
        >
          écrit
        </em>
        .
      </h1>

      <p
        style={{
          margin: "clamp(10px, 2vh, 18px) 0 0",
          fontSize: "clamp(13px, 1.3vw, 16px)",
          lineHeight: 1.55,
          color: "#82828b",
          maxWidth: 460,
        }}
      >
        Appuie sur ton raccourci dans n'importe quelle app — ton texte est
        transcrit, nettoyé et inséré au curseur. Trois fois plus vite que ta
        vraie vitesse de frappe.
      </p>
    </div>

    {/* Demo card */}
    <div
      style={{
        marginTop: "clamp(16px, 3vh, 36px)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.02), transparent 70%), #16161a",
        padding: 18,
        position: "relative",
        zIndex: 2,
        boxShadow:
          "0 24px 60px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingBottom: 14,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span className="auth-rec-dot" />
        <span
          style={{
            fontSize: 12,
            color: "#d4a858",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Enregistrement
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: "#82828b",
          }}
        >
          actif dans{" "}
          <span
            style={{
              padding: "2px 7px",
              border: "1px solid rgba(255,255,255,0.06)",
              background: "#1c1c22",
              borderRadius: 5,
              fontSize: 10.5,
              color: "#b6b6bd",
              fontWeight: 500,
            }}
          >
            Slack
          </span>
        </span>
      </div>

      <Waveform />
      <Typewriter />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 14,
          color: "#82828b",
          fontSize: 12,
        }}
      >
        {["Ctrl", "Space"].map((k, i) => (
          <>
            <span
              key={k}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                fontWeight: 500,
                color: "#d4a858",
                background: "rgba(212,168,88,0.14)",
                border: "1px solid rgba(212,168,88,0.32)",
                borderBottomWidth: 2,
                padding: "2px 7px",
                borderRadius: 5,
              }}
            >
              {k}
            </span>
            {i === 0 && <span style={{ color: "#56565e" }}>+</span>}
          </>
        ))}
        <span style={{ color: "#56565e" }}>·</span>
        <span>
          profil <b style={{ color: "#b6b6bd", fontWeight: 500 }}>Travail</b>
        </span>
        <span style={{ marginLeft: "auto", color: "#6cce8c", fontWeight: 500 }}>
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#6cce8c",
              marginRight: 6,
              verticalAlign: 1,
            }}
          />
          3,2× plus rapide
        </span>
      </div>
    </div>

    {/* Trust strip */}
    <div
      style={{
        marginTop: "clamp(16px, 2.5vh, 22px)",
        paddingTop: "clamp(12px, 2vh, 22px)",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        display: "flex",
        flexWrap: "wrap",
        gap: "10px 22px",
        color: "#82828b",
        fontSize: 12,
        position: "relative",
        zIndex: 2,
        flexShrink: 0,
      }}
    >
      {[
        { label: "Chiffré de bout en bout" },
        { label: "Sans audio stocké" },
      ].map((item) => (
        <span
          key={item.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            color: "#82828b",
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d4a858"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx={12} cy={12} r={9} />
            <polyline points="9 12 11 14 15 10" />
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  </aside>
);

// ── Auth panel props ───────────────────────────────────────────────────────────
interface AuthPortalProps {
  activationStatus: ActivationStatus;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  session: AuthSession | null;
  onLogin: (payload: AuthPayload) => Promise<void>;
  onRegister: (payload: AuthPayload) => Promise<void>;
  onStartCheckout: (selection?: BillingCheckoutRequest) => Promise<string>;
  onOpenBillingPortal: () => Promise<string>;
  onRefreshSession: () => Promise<void>;
  onLogout: () => void;
}

const AUTH_SIGNUP_URL = "https://vocalype.com/signup?source=desktop";
const AUTH_LOGIN_URL = "https://vocalype.com/login?source=desktop";
const AUTH_FORGOT_URL = "https://vocalype.com/forgot-password?source=desktop";
const PRIVACY_URL = "https://vocalype.com/privacy";
const TERMS_URL = "https://vocalype.com/terms";

const buildBrowserAuthUrl = (intent: "signup" | "login", state: string) => {
  const url = new URL(intent === "signup" ? AUTH_SIGNUP_URL : AUTH_LOGIN_URL);
  url.searchParams.set("source", "desktop");
  url.searchParams.set("state", state);
  return url.toString();
};

const isExpectedMissingLicenseMessage = (v: string | null) =>
  v?.toLowerCase().includes("no stored license bundle") ?? false;

// ── Auth panel (right side) ────────────────────────────────────────────────────
const AuthPanel: React.FC<AuthPortalProps> = ({
  activationStatus,
  isLoading,
  isSubmitting,
  error,
  session,
  onLogin,
  onRegister,
  onStartCheckout,
  onRefreshSession,
  onLogout,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [browserBusy, setBrowserBusy] = useState<"signup" | "login" | null>(
    null,
  );
  const [billingBusy, setBillingBusy] = useState(false);
  const [autoRefreshBusy, setAutoRefreshBusy] = useState(false);
  const refreshAttemptRef = useRef(0);

  const hasAccess = session?.subscription.has_access ?? false;
  const busy =
    isSubmitting || autoRefreshBusy || browserBusy !== null || billingBusy;
  const canInteract = !isLoading && !busy;

  const displayError =
    error && !isExpectedMissingLicenseMessage(error)
      ? getUserFacingErrorMessage(error, { t, context: "auth" })
      : null;
  const activationFailedFallback =
    activationStatus === "activation_failed" && !displayError
      ? "L'activation sur ce PC n'a pas abouti. Cliquez sur « Réessayer » ou reconnectez-vous."
      : null;
  const localSignupError =
    mode === "signup" && confirmPassword && password !== confirmPassword
      ? t("auth.errors.passwordsDoNotMatch")
      : null;
  const visibleError =
    localSignupError ?? displayError ?? activationFailedFallback;

  // Auto-refresh loop when a session is detected (same logic as before)
  useEffect(() => {
    if (!session) {
      refreshAttemptRef.current = 0;
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      if (cancelled || refreshAttemptRef.current >= 8) return;
      refreshAttemptRef.current++;
      setAutoRefreshBusy(true);
      try {
        await onRefreshSession();
      } catch {
        /* surface via visibleError */
      } finally {
        if (!cancelled) setAutoRefreshBusy(false);
      }
      if (!cancelled && refreshAttemptRef.current < 8)
        timer = window.setTimeout(refresh, 2500);
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [session?.user.email, session?.subscription.status, onRefreshSession]);

  const handleRetry = async () => {
    refreshAttemptRef.current = 0;
    setAutoRefreshBusy(true);
    try {
      await onRefreshSession();
    } catch {
      /* handled via visibleError */
    } finally {
      setAutoRefreshBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canInteract || !email.trim() || !password) return;
    if (mode === "signup") {
      if (password !== confirmPassword) return;
      await onRegister({ email: email.trim(), password });
    } else {
      await onLogin({ email: email.trim(), password });
    }
  };

  const handleForgotPassword = () => {
    void openUrl(AUTH_FORGOT_URL);
  };

  const openBrowserAuth = async (intent: "signup" | "login") => {
    setBrowserBusy(intent);
    try {
      const result = await commands.startBrowserAuth();
      if (result.status !== "ok") throw new Error(result.error);
      await openUrl(buildBrowserAuthUrl(intent, result.data));
    } catch (openError) {
      toast.error("Ouverture impossible", {
        description: getUserFacingErrorMessage(openError, {
          t,
          context: "auth",
          fallback:
            "Impossible d'ouvrir le navigateur. Réessayez dans un instant.",
        }),
      });
    } finally {
      setBrowserBusy(null);
    }
  };

  const openBillingLink = async (action: () => Promise<string>) => {
    setBillingBusy(true);
    try {
      await openUrl(await action());
    } catch (err) {
      toast.error("Ouverture impossible", {
        description: getUserFacingErrorMessage(err, {
          t,
          context: "auth",
          fallback:
            "Impossible d'ouvrir la facturation. Réessayez dans un instant.",
        }),
      });
    } finally {
      setBillingBusy(false);
    }
  };

  // ── Derive primary action (logged-in states) ─────────────────────────────────
  let loggedInAction: React.ReactNode = null;
  if (session && hasAccess && activationStatus === "activation_failed") {
    loggedInAction = (
      <button
        type="button"
        className="auth-warn"
        disabled={autoRefreshBusy}
        onClick={handleRetry}
      >
        {autoRefreshBusy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <RefreshCw size={16} />
        )}
        Réessayer l'activation
      </button>
    );
  } else if (session && hasAccess) {
    loggedInAction = (
      <div className="auth-ready">
        <Loader2 size={16} className="animate-spin" />
        Activation automatique…
      </div>
    );
  } else if (session) {
    loggedInAction = (
      <button
        type="button"
        className="auth-submit"
        disabled={billingBusy}
        onClick={() => openBillingLink(onStartCheckout)}
      >
        {billingBusy && <Loader2 size={16} className="animate-spin" />}
        Activer Vocalype
      </button>
    );
  }

  const isSignedIn = Boolean(session);
  const statusTone =
    activationStatus === "ready"
      ? "#6cce8c"
      : activationStatus === "activation_failed" ||
          activationStatus === "subscription_inactive"
        ? "#f3c98b"
        : "#82828b";

  const statusText =
    autoRefreshBusy && activationStatus !== "ready"
      ? "Connexion détectée. Vérification de l'activation…"
      : activationStatus === "subscription_inactive"
        ? "Compte détecté, mais aucun abonnement actif trouvé."
        : activationStatus === "activation_failed"
          ? "Compte détecté, mais l'activation n'a pas abouti."
          : activationStatus === "ready"
            ? "Compte détecté. Vocalype est prêt sur ce PC."
            : "Compte détecté. Activation en cours…";

  return (
    <div className="auth-panel-wrap">
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title */}
        <h2
          style={{
            margin: 0,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#ededee",
          }}
        >
          {isSignedIn
            ? "En cours d'activation."
            : mode === "signup"
              ? "Crée ton compte."
              : "Bon retour."}
        </h2>
        <p
          style={{
            margin: "10px 0 0",
            color: "#82828b",
            fontSize: 14.5,
            lineHeight: 1.55,
          }}
        >
          {isSignedIn
            ? "Vocalype s'active automatiquement sur ce poste."
            : mode === "signup"
              ? "14 jours d'essai. Aucune carte requise."
              : "Vocalype s'active automatiquement sur ce poste après la connexion."}
        </p>

        {/* Session card (logged in) */}
        {session && (
          <div
            style={{
              marginTop: 22,
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#ededee",
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
                color: statusTone,
              }}
            >
              {statusText}
            </div>
          </div>
        )}

        {/* Logged-in actions */}
        {isSignedIn && (
          <div style={{ display: "grid", gap: 8, marginTop: 22 }}>
            {loggedInAction}
            <button type="button" className="auth-secondary" onClick={onLogout}>
              <LogOut size={15} />
              Se déconnecter
            </button>
          </div>
        )}

        {/* ── Logged-out form ── */}
        {!isSignedIn && (
          <>
            {/* Segmented control */}
            <div
              className="auth-seg"
              style={{
                marginTop: 26,
                display: "flex",
                background: "#16161a",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                padding: 3,
              }}
            >
              <button
                className={mode === "signin" ? "active" : ""}
                onClick={() => {
                  setMode("signin");
                  setConfirmPassword("");
                  setShowConfirmPw(false);
                }}
              >
                Se connecter
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                onClick={() => setMode("signup")}
              >
                Créer un compte{" "}
                <span
                  style={{
                    fontSize: 9.5,
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(212,168,88,0.14)",
                    color: "#d4a858",
                    border: "1px solid rgba(212,168,88,0.32)",
                  }}
                >
                  14 j gratuits
                </span>
              </button>
            </div>

            {/* Email / password form — opens browser on submit */}
            <form
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              {/* Email */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "#b6b6bd",
                    fontWeight: 500,
                    marginBottom: 6,
                  }}
                >
                  Email
                </div>
                <div className="auth-input-wrap">
                  <span style={{ padding: "0 4px 0 14px", color: "#56565e" }}>
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x={3} y={5} width={18} height={14} rx={2} />
                      <polyline points="3 7 12 13 21 7" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    placeholder="alex@exemple.io"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                    color: "#b6b6bd",
                    fontWeight: 500,
                    marginBottom: 6,
                  }}
                >
                  <span>Mot de passe</span>
                  {mode === "signin" && (
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        color: "#d4a858",
                        fontSize: 11.5,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                      onClick={handleForgotPassword}
                    >
                      Mot de passe oublié ?
                    </button>
                  )}
                </div>
                <div className="auth-input-wrap">
                  <span style={{ padding: "0 4px 0 14px", color: "#56565e" }}>
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x={4} y={11} width={16} height={10} rx={2} />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </span>
                  <input
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    required
                    minLength={mode === "signup" ? 6 : 1}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((p) => !p)}
                    style={{
                      background: "none",
                      border: 0,
                      padding: "0 14px",
                      color: "#82828b",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {showPw ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1={1} y1={1} x2={23} y2={23} />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx={12} cy={12} r={3} />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#b6b6bd",
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    {t("auth.confirmPassword")}
                  </div>
                  <div className="auth-input-wrap">
                    <span style={{ padding: "0 4px 0 14px", color: "#56565e" }}>
                      <svg
                        width={16}
                        height={16}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x={4} y={11} width={16} height={10} rx={2} />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    </span>
                    <input
                      type={showConfirmPw ? "text" : "password"}
                      placeholder="••••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw((p) => !p)}
                      style={{
                        background: "none",
                        border: 0,
                        padding: "0 14px",
                        color: "#82828b",
                        cursor: "pointer",
                      }}
                    >
                      <svg
                        width={16}
                        height={16}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {showConfirmPw ? (
                          <>
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1={1} y1={1} x2={23} y2={23} />
                          </>
                        ) : (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx={12} cy={12} r={3} />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                className="auth-submit"
                disabled={
                  !canInteract ||
                  !email.trim() ||
                  !password ||
                  (mode === "signup" &&
                    (!confirmPassword || password !== confirmPassword))
                }
              >
                {isSubmitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1={4} y1={12} x2={20} y2={12} />
                    <polyline points="14 6 20 12 14 18" />
                  </svg>
                )}
                {mode === "signup" ? "Créer mon compte" : "Se connecter"}
              </button>
            </form>
          </>
        )}

        {/* Error */}
        {visibleError && (
          <div
            style={{
              marginTop: 14,
              borderRadius: 10,
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
            <div style={{ lineHeight: 1.45, fontSize: 13 }}>{visibleError}</div>
          </div>
        )}

        {/* Footer */}
        <p
          style={{
            marginTop: 24,
            textAlign: "center",
            color: "#56565e",
            fontSize: 11.5,
            lineHeight: 1.6,
          }}
        >
          En continuant, tu acceptes les{" "}
          <button
            type="button"
            style={{
              background: "none",
              border: 0,
              color: "#82828b",
              padding: 0,
              cursor: "pointer",
              fontSize: "inherit",
              fontFamily: "inherit",
            }}
            onClick={() => openUrl(TERMS_URL)}
          >
            Conditions
          </button>{" "}
          et la{" "}
          <button
            type="button"
            style={{
              background: "none",
              border: 0,
              color: "#82828b",
              padding: 0,
              cursor: "pointer",
              fontSize: "inherit",
              fontFamily: "inherit",
            }}
            onClick={() => openUrl(PRIVACY_URL)}
          >
            Politique de confidentialité
          </button>
          .<br />
          Besoin d'aide ?{" "}
          <button
            type="button"
            style={{
              background: "none",
              border: 0,
              color: "#d4a858",
              padding: 0,
              cursor: "pointer",
              fontSize: "inherit",
              fontFamily: "inherit",
            }}
            onClick={() => openUrl("https://vocalype.com/support")}
          >
            Contacter le support
          </button>
        </p>
      </div>
    </div>
  );
};

// ── Root export ────────────────────────────────────────────────────────────────
export const AuthPortal: React.FC<AuthPortalProps> = (props) => (
  <main
    style={{
      width: "100%",
      height: "100%",
      overflow: "hidden",
      background: "#0a0a0c",
      color: "#ededee",
    }}
  >
    <div className="auth-portal">
      <Showcase />
      <AuthPanel {...props} />
    </div>
    <ModelDownloadBadge />
  </main>
);

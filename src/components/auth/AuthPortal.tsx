/* eslint-disable i18next/no-literal-string */
import { useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { commands } from "@/bindings";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
import {
  AUTH_STEP_ORDER,
  AUTH_STEPS,
  type AuthStep,
} from "./authOnboardingContent";
import { OnboardingStepper } from "./OnboardingStepper";
import { ProductMediaPanel } from "./ProductMediaPanel";

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

const accessLabelForSession = (session: AuthSession | null) => {
  if (!session) return "Aucune session detectee";
  switch (session.subscription.status) {
    case "active":
      return "Abonnement actif";
    case "trialing":
      return "Essai en cours";
    case "canceled":
      return "Abonnement annule";
    default:
      return "Acces verrouille";
  }
};

const buttonBaseStyle: CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: 16,
  padding: "15px 18px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 700,
  transition: "transform 160ms ease, opacity 160ms ease, background 160ms ease",
};

export const AuthPortal = ({
  isLoading,
  isSubmitting,
  error,
  session,
  onStartCheckout,
  onOpenBillingPortal,
  onRefreshSession,
  onLogout,
}: AuthPortalProps) => {
  const viewportWidth =
    typeof window === "undefined" ? 1348 : window.innerWidth;
  const isNarrowLayout = viewportWidth < 1180;
  const isCompactLayout = viewportWidth < 980;
  const [currentStep, setCurrentStep] = useState<AuthStep>("sign-up");
  const [browserBusy, setBrowserBusy] = useState<"signup" | "login" | null>(
    null,
  );
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);

  const activeStep = useMemo(
    () => AUTH_STEPS.find((step) => step.id === currentStep) ?? AUTH_STEPS[0],
    [currentStep],
  );

  const stepIndex = AUTH_STEP_ORDER.indexOf(currentStep);
  const hasPreviousStep = stepIndex > 0;
  const hasNextStep = stepIndex < AUTH_STEP_ORDER.length - 1;
  const hasAccess = session?.subscription.has_access ?? false;
  const canManageBilling = session?.subscription.can_manage_billing ?? false;
  const canInteract = !isLoading && !isSubmitting && !refreshBusy;
  const displayError = error?.trim() ?? null;

  const openBrowserAuth = async (intent: "signup" | "login") => {
    setBrowserBusy(intent);
    try {
      // Register the auth flow so the deep-link handler accepts the returning token.
      // Without this, any app can hijack the session via a crafted vocalype:// URL.
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
      toast.error("Ouverture du navigateur impossible", {
        description: message,
      });
    } finally {
      setBrowserBusy(null);
    }
  };

  const verifyAccess = async () => {
    setRefreshBusy(true);
    try {
      await onRefreshSession();
    } catch (refreshError) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : "Impossible de verifier votre acces.";
      toast.error("Verification echouee", { description: message });
    } finally {
      setRefreshBusy(false);
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
      toast.error("Impossible d'ouvrir la facturation", {
        description: message,
      });
    } finally {
      setBillingBusy(false);
    }
  };

  const goToPreviousStep = () => {
    if (!hasPreviousStep) return;
    setCurrentStep(AUTH_STEP_ORDER[stepIndex - 1]);
  };

  const goToNextStep = () => {
    if (!hasNextStep) return;
    setCurrentStep(AUTH_STEP_ORDER[stepIndex + 1]);
  };

  const primaryCta = session ? (
    <button
      type="button"
      style={{
        ...buttonBaseStyle,
        background: "#C9A84C",
        color: "#0a0908",
        boxShadow: "0 16px 36px rgba(201,168,76,0.24)",
        opacity: billingBusy ? 0.72 : 1,
      }}
      disabled={billingBusy}
      onClick={() =>
        openBillingLink(
          hasAccess && canManageBilling ? onOpenBillingPortal : onStartCheckout,
        )
      }
    >
      {billingBusy ? <Loader2 size={16} className="animate-spin" /> : null}
      {hasAccess && canManageBilling
        ? "Gerer mon abonnement"
        : "Debloquer Vocalype"}
    </button>
  ) : (
    <button
      type="button"
      style={{
        ...buttonBaseStyle,
        background: "#C9A84C",
        color: "#0a0908",
        boxShadow: "0 16px 36px rgba(201,168,76,0.24)",
        opacity: browserBusy === "signup" ? 0.72 : 1,
      }}
      disabled={!canInteract || browserBusy !== null}
      onClick={() => openBrowserAuth("signup")}
    >
      {browserBusy === "signup" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <ExternalLink size={16} />
      )}
      Continuer dans le navigateur
    </button>
  );

  const secondaryActions = session ? (
    <>
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          background: "rgba(255,255,255,0.06)",
          color: "#f3ecdf",
          border: "1px solid rgba(255,255,255,0.1)",
          opacity: refreshBusy ? 0.72 : 1,
        }}
        disabled={!canInteract}
        onClick={verifyAccess}
      >
        {refreshBusy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <RefreshCw size={16} />
        )}
        Verifier mon acces
      </button>
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          background: "transparent",
          color: "rgba(243,236,223,0.72)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onClick={onLogout}
      >
        <LogOut size={16} />
        Se deconnecter
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          background: "rgba(255,255,255,0.06)",
          color: "#f3ecdf",
          border: "1px solid rgba(255,255,255,0.1)",
          opacity: browserBusy === "login" ? 0.72 : 1,
        }}
        disabled={!canInteract || browserBusy !== null}
        onClick={() => openBrowserAuth("login")}
      >
        {browserBusy === "login" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ArrowRight size={16} />
        )}
        J'ai deja un compte
      </button>
      <button
        type="button"
        style={{
          ...buttonBaseStyle,
          background: "transparent",
          color: "rgba(243,236,223,0.72)",
          border: "1px solid rgba(255,255,255,0.08)",
          opacity: refreshBusy ? 0.72 : 1,
        }}
        disabled={!canInteract}
        onClick={verifyAccess}
      >
        {refreshBusy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <RefreshCw size={16} />
        )}
        J'ai termine, verifier mon acces
      </button>
    </>
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#050505",
        color: "#f3ecdf",
        fontFamily: '"DM Sans", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: isCompactLayout ? 10 : 12,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: isCompactLayout ? "72px 1fr" : "84px 1fr",
          gap: isCompactLayout ? 10 : 12,
        }}
      >
        <header
          style={{
            borderRadius: isCompactLayout ? 20 : 26,
            border: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(15,14,12,0.94) 0%, rgba(10,9,8,0.98) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: isCompactLayout ? "0 14px" : "0 24px",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <OnboardingStepper
            steps={AUTH_STEPS}
            currentStep={currentStep}
            onStepSelect={setCurrentStep}
          />
        </header>

        <div
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: isNarrowLayout
              ? "minmax(0, 1fr)"
              : "minmax(420px, 480px) minmax(0, 1fr)",
            gridTemplateRows: isNarrowLayout
              ? "minmax(0, auto) minmax(320px, 38vh)"
              : undefined,
            gap: isCompactLayout ? 10 : 12,
          }}
        >
          <section
            style={{
              minHeight: 0,
              borderRadius: isCompactLayout ? 24 : 34,
              border: "1px solid rgba(201,168,76,0.14)",
              background:
                "radial-gradient(circle at top left, rgba(201,168,76,0.12), transparent 34%), #0a0908",
              padding: isCompactLayout
                ? "18px 18px 20px"
                : isNarrowLayout
                  ? "22px 24px 22px"
                  : "24px 34px 24px",
              display: "flex",
              flexDirection: "column",
              position: "relative",
              overflow: "auto",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "0 auto auto 0",
                width: "100%",
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, rgba(201,168,76,0.34), transparent)",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: isCompactLayout ? "flex-start" : "center",
                flexDirection: isCompactLayout ? "column" : "row",
                justifyContent: "space-between",
                marginBottom: 20,
                gap: isCompactLayout ? 10 : 12,
              }}
            >
              <div
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontSize: isCompactLayout ? 26 : 32,
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                  color: "#f6efe4",
                }}
              >
                Vocal<span style={{ color: "#C9A84C" }}>ype</span>
              </div>
              <div
                style={{
                  borderRadius: 999,
                  padding: isCompactLayout ? "8px 12px" : "10px 14px",
                  fontSize: isCompactLayout ? 11 : 12,
                  fontWeight: 700,
                  color: "#E7C977",
                  background: "rgba(201,168,76,0.14)",
                  border: "1px solid rgba(201,168,76,0.22)",
                }}
              >
                14 jours gratuits
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "rgba(201,168,76,0.88)",
                }}
              >
                {session ? "Compte" : activeStep.eyebrow}
              </div>
              <h1
                style={{
                  margin: 0,
                  marginBottom: 12,
                  fontFamily: "'Syne', sans-serif",
                  fontSize: isCompactLayout ? 32 : isNarrowLayout ? 38 : 44,
                  lineHeight: 0.95,
                  letterSpacing: "-0.05em",
                  color: "#f7f1e7",
                }}
              >
                {session ? "Votre acces passe par le web." : activeStep.title}
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: isCompactLayout ? 14 : 16,
                  lineHeight: 1.55,
                  color: "rgba(243,236,223,0.66)",
                  maxWidth: isNarrowLayout ? "100%" : 372,
                }}
              >
                {session
                  ? "Votre session est detectee sur cet appareil. Finalisez ou gerez votre acces depuis le navigateur, puis revenez verifier dans l'app."
                  : activeStep.description}
              </p>
            </div>

            {displayError ? (
              <div
                style={{
                  marginBottom: 20,
                  borderRadius: 18,
                  border: "1px solid rgba(248,113,113,0.2)",
                  background: "rgba(248,113,113,0.08)",
                  color: "#f7b0b0",
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <ShieldAlert
                  size={18}
                  style={{ marginTop: 1, flexShrink: 0 }}
                />
                <div style={{ lineHeight: 1.5, fontSize: 14 }}>
                  {displayError}
                </div>
              </div>
            ) : null}

            {session ? (
              <div
                style={{
                  marginBottom: 24,
                  borderRadius: 22,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: isCompactLayout ? "column" : "row",
                    alignItems: isCompactLayout ? "flex-start" : "stretch",
                    justifyContent: "space-between",
                    gap: 14,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#f7f1e7",
                        wordBreak: "break-word",
                      }}
                    >
                      {session.user.email}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        color: "rgba(243,236,223,0.56)",
                      }}
                    >
                      {accessLabelForSession(session)}
                    </div>
                  </div>
                  <div
                    style={{
                      flexShrink: 0,
                      alignSelf: "flex-start",
                      borderRadius: 999,
                      padding: "7px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: hasAccess ? "#6EE7B7" : "#E7C977",
                      background: hasAccess
                        ? "rgba(110,231,183,0.12)"
                        : "rgba(201,168,76,0.12)",
                      border: hasAccess
                        ? "1px solid rgba(110,231,183,0.18)"
                        : "1px solid rgba(201,168,76,0.16)",
                    }}
                  >
                    {hasAccess ? "Actif" : "A valider"}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "rgba(243,236,223,0.5)",
                  }}
                >
                  Si vous venez de payer ou de vous connecter sur le web,
                  cliquez sur "Verifier mon acces" pour mettre a jour cette
                  session.
                </div>
              </div>
            ) : (
              <div
                style={{
                  marginBottom: 22,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                {activeStep.highlights.map((item) => (
                  <div
                    key={item}
                    style={{
                      borderRadius: 999,
                      padding: "9px 12px",
                      fontSize: 12,
                      color: "rgba(243,236,223,0.82)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
              {primaryCta}
              {secondaryActions}
            </div>

            {!session ? (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: isCompactLayout ? "column" : "row",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={goToPreviousStep}
                    disabled={!hasPreviousStep}
                    style={{
                      ...buttonBaseStyle,
                      width: "auto",
                      padding: "12px 14px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: hasPreviousStep
                        ? "rgba(243,236,223,0.72)"
                        : "rgba(243,236,223,0.28)",
                    }}
                  >
                    Retour
                  </button>
                  <button
                    type="button"
                    onClick={goToNextStep}
                    disabled={!hasNextStep}
                    style={{
                      ...buttonBaseStyle,
                      width: "auto",
                      padding: "12px 14px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: hasNextStep
                        ? "rgba(243,236,223,0.72)"
                        : "rgba(243,236,223,0.28)",
                    }}
                  >
                    Continuer
                    <ArrowRight size={15} />
                  </button>
                </div>

                <p
                  style={{
                    margin: "auto 0 0",
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: "rgba(243,236,223,0.42)",
                  }}
                >
                  En continuant, vous acceptez nos{" "}
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#E7C977",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                    onClick={() => openUrl(TERMS_URL)}
                  >
                    Conditions
                  </button>{" "}
                  et notre{" "}
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#E7C977",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                    onClick={() => openUrl(PRIVACY_URL)}
                  >
                    Politique de confidentialite
                  </button>
                  .
                </p>
              </>
            ) : (
              <div
                style={{
                  marginTop: "auto",
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "rgba(243,236,223,0.42)",
                }}
              >
                Vocalype garde le desktop leger: connexion et facturation sur le
                web, verification instantanee dans l'app.
              </div>
            )}
          </section>

          <ProductMediaPanel step={activeStep} compact={isNarrowLayout} />
        </div>
      </div>
    </div>
  );
};

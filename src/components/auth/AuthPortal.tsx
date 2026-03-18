import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AuthPayload,
  AuthSession,
  ChangePasswordPayload,
} from "@/lib/auth/types";
import { authClient } from "@/lib/auth/client";
import VocalTypeLogo from "../icons/VocalTypeLogo";
import { Button } from "../ui/Button";

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

type Mode = "login" | "register" | "forgot";
type ForgotStep = "email" | "code" | "done";

/** Keywords in server error messages that indicate a duplicate email. */
const EMAIL_EXISTS_PATTERNS = [
  "already exists",
  "already registered",
  "already in use",
  "email taken",
  "duplicate",
  "déjà utilisé",
  "deja utilise",
  "déjà enregistré",
  "existe déjà",
];

const looksLikeEmailExists = (message: string) => {
  const lower = message.toLowerCase();
  return EMAIL_EXISTS_PATTERNS.some((p) => lower.includes(p));
};

const formatAccessLabel = (
  session: AuthSession,
  translate: (key: string, opts?: Record<string, unknown>) => string,
) => {
  if (session.subscription.status === "active") {
    return translate("auth.access.active");
  }

  if (session.subscription.status === "trialing") {
    if (!session.subscription.trial_ends_at) {
      return translate("auth.access.trialActive");
    }

    const trialEnd = new Date(session.subscription.trial_ends_at);
    const diff = Math.max(
      0,
      Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );

    return diff <= 1
      ? translate("auth.access.trialEndsToday")
      : translate("auth.access.trialDaysLeft", { count: diff });
  }

  if (session.subscription.status === "canceled") {
    return translate("auth.access.canceled");
  }

  return translate("auth.access.trialEnded");
};

export const AuthPortal = ({
  isLoading,
  isSubmitting,
  error,
  session,
  onLogin,
  onRegister,
  onStartCheckout,
  onOpenBillingPortal,
  onRefreshSession,
  onLogout,
}: AuthPortalProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [deviceAlreadyRegistered, setDeviceAlreadyRegistered] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Forgot password flow state
  const [forgotStep, setForgotStep] = useState<ForgotStep>("email");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPwd, setForgotNewPwd] = useState("");
  const [forgotConfirmPwd, setForgotConfirmPwd] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);

  // Change password state (account view)
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [changePwdBusy, setChangePwdBusy] = useState(false);
  const [changePwdError, setChangePwdError] = useState<string | null>(null);
  const [changePwdSuccess, setChangePwdSuccess] = useState(false);

  // Check on mount if this device already has an account
  useEffect(() => {
    authClient.isDeviceRegistered().then((registered) => {
      if (registered) {
        setDeviceAlreadyRegistered(true);
        setMode("login");
      }
    });
  }, []);

  // If the server error looks like a duplicate email, switch to login automatically
  useEffect(() => {
    if (error && mode === "register" && looksLikeEmailExists(error)) {
      setMode("login");
    }
  }, [error, mode]);

  const accessLabel = useMemo(
    () =>
      session
        ? formatAccessLabel(session, (key, opts) => t(key, opts) as string)
        : null,
    [session, t],
  );

  const hasAccess = session?.subscription.has_access ?? false;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    if (mode === "register") {
      // Block if this device already registered an account
      if (deviceAlreadyRegistered) {
        setLocalError(t("auth.errors.deviceAlreadyRegistered"));
        return;
      }
      // Block if this exact email was already registered on this device
      const emailUsedBefore = await authClient.isEmailRegisteredOnDevice(email);
      if (emailUsedBefore) {
        setMode("login");
        setLocalError(t("auth.errors.emailExistsSwitchedToLogin"));
        return;
      }
    }

    const payload: AuthPayload = {
      email: email.trim(),
      password,
      ...(mode === "register" && name.trim() ? { name: name.trim() } : {}),
    };

    if (mode === "register") {
      await onRegister(payload);
      return;
    }

    await onLogin(payload);
  };

  const openBillingLink = async (
    action: () => Promise<string>,
    next?: () => Promise<void>,
  ) => {
    setBillingBusy(true);
    try {
      const url = await action();
      await openUrl(url);
      if (next) {
        await next();
      }
    } finally {
      setBillingBusy(false);
    }
  };

  // Determine the error message to display (local errors take priority)
  const displayError = useMemo(() => {
    if (localError) return localError;
    if (!error) return null;
    // If the server error looks like a duplicate email, show a specific hint
    if (mode === "login" && looksLikeEmailExists(error)) {
      return t("auth.errors.emailExistsSwitchedToLogin");
    }
    return error;
  }, [localError, error, mode, t]);

  // ── Forgot password handlers ─────────────────────────────────────────────

  const handleForgotSendCode = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setForgotError(null);
    setForgotBusy(true);
    try {
      await authClient.forgotPassword(email.trim());
      setForgotStep("code");
    } catch {
      setForgotError(t("auth.errors.networkError"));
    } finally {
      setForgotBusy(false);
    }
  };

  const handleForgotReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setForgotError(null);

    if (forgotNewPwd !== forgotConfirmPwd) {
      setForgotError(t("auth.errors.passwordsDoNotMatch"));
      return;
    }

    setForgotBusy(true);
    try {
      const newSession = await authClient.resetPassword({
        email: email.trim(),
        code: forgotCode.trim(),
        new_password: forgotNewPwd,
      });
      await authClient.setStoredSession(newSession);
      setForgotStep("done");
      setTimeout(() => {
        setMode("login");
        setForgotStep("email");
        setForgotCode("");
        setForgotNewPwd("");
        setForgotConfirmPwd("");
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.toLowerCase().includes("invalide") ||
        message.toLowerCase().includes("expired") ||
        message.toLowerCase().includes("expiré")
      ) {
        setForgotError(t("auth.errors.invalidResetCode"));
      } else {
        setForgotError(message || t("auth.errors.networkError"));
      }
    } finally {
      setForgotBusy(false);
    }
  };

  const handleBackToLogin = () => {
    setMode("login");
    setForgotStep("email");
    setForgotCode("");
    setForgotNewPwd("");
    setForgotConfirmPwd("");
    setForgotError(null);
  };

  // ── Change password handler ──────────────────────────────────────────────

  const handleChangePassword = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setChangePwdError(null);
    setChangePwdSuccess(false);

    if (newPwd !== confirmPwd) {
      setChangePwdError(t("auth.errors.passwordsDoNotMatch"));
      return;
    }

    if (!session) return;

    setChangePwdBusy(true);
    try {
      const payload: ChangePasswordPayload = {
        old_password: oldPwd,
        new_password: newPwd,
      };
      await authClient.changePassword(session.token, payload);
      setChangePwdSuccess(true);
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setShowChangePassword(false);
      window.setTimeout(() => {
        onLogout();
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.toLowerCase().includes("actuel") ||
        message.toLowerCase().includes("incorrect") ||
        message.toLowerCase().includes("wrong")
      ) {
        setChangePwdError(t("auth.errors.wrongOldPassword"));
      } else {
        setChangePwdError(message || t("auth.errors.networkError"));
      }
    } finally {
      setChangePwdBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(201,168,76,0.18),_transparent_36%),linear-gradient(180deg,_#120f0b_0%,_#090909_45%,_#050505_100%)] text-text">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-logo-primary/20 bg-background-ui/70 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="mb-10 flex items-center justify-between gap-4">
              <VocalTypeLogo width={180} />
              <div className="rounded-full border border-logo-primary/20 bg-logo-primary/10 px-4 py-2 text-xs font-semibold text-logo-primary">
                {t("auth.trialBadge")}
              </div>
            </div>

            <div className="space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-logo-primary/80">
                {t("auth.paidAccess")}
              </p>
              <h1 className="max-w-xl text-5xl font-black leading-none tracking-[-0.04em] text-text">
                {t("auth.headline")}
              </h1>
              <p className="max-w-xl text-base leading-7 text-text/68">
                {t("auth.subheadline")}
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <Sparkles className="mb-3 h-5 w-5 text-logo-primary" />
                <h2 className="mb-2 text-sm font-semibold">
                  {t("auth.features.trial.title")}
                </h2>
                <p className="text-sm leading-6 text-text/62">
                  {t("auth.features.trial.description")}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <ShieldCheck className="mb-3 h-5 w-5 text-logo-primary" />
                <h2 className="mb-2 text-sm font-semibold">
                  {t("auth.features.subscription.title")}
                </h2>
                <p className="text-sm leading-6 text-text/62">
                  {t("auth.features.subscription.description")}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <LockKeyhole className="mb-3 h-5 w-5 text-logo-primary" />
                <h2 className="mb-2 text-sm font-semibold">
                  {t("auth.features.billing.title")}
                </h2>
                <p className="text-sm leading-6 text-text/62">
                  {t("auth.features.billing.description")}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/8 bg-[#121212]/92 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            {mode !== "forgot" && (
              <div className="mb-6 flex rounded-full bg-white/5 p-1 text-sm">
                <button
                  className={`flex-1 rounded-full px-4 py-2 transition ${
                    mode === "register"
                      ? "bg-logo-primary text-black"
                      : "text-text/65"
                  }`}
                  disabled={deviceAlreadyRegistered}
                  onClick={() => setMode("register")}
                  type="button"
                >
                  {t("auth.createAccount")}
                </button>
                <button
                  className={`flex-1 rounded-full px-4 py-2 transition ${
                    mode === "login"
                      ? "bg-logo-primary text-black"
                      : "text-text/65"
                  }`}
                  onClick={() => setMode("login")}
                  type="button"
                >
                  {t("auth.login")}
                </button>
              </div>
            )}

            {/* Device already registered notice */}
            {deviceAlreadyRegistered && mode === "login" && (
              <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                {t("auth.errors.deviceAlreadyRegistered")}
              </div>
            )}

            {session ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-logo-primary/20 bg-logo-primary/8 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-logo-primary">
                        {t("auth.account")}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-text">
                        {session.user.email}
                      </h2>
                      <p className="mt-2 text-sm text-text/65">{accessLabel}</p>
                    </div>
                    <div
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        hasAccess
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {hasAccess ? t("auth.unlocked") : t("auth.locked")}
                    </div>
                  </div>
                </div>

                {!hasAccess ? (
                  <Button
                    className="w-full justify-center py-3 text-sm"
                    disabled={billingBusy}
                    onClick={() =>
                      openBillingLink(onStartCheckout, onRefreshSession)
                    }
                    size="lg"
                  >
                    {billingBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {t("auth.subscribeNow")}
                  </Button>
                ) : (
                  <Button
                    className="w-full justify-center py-3 text-sm"
                    disabled={billingBusy}
                    onClick={() =>
                      openBillingLink(onOpenBillingPortal, undefined)
                    }
                    size="lg"
                    variant="secondary"
                  >
                    {billingBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {t("auth.manageSubscription")}
                  </Button>
                )}

                {/* Change password section */}
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <button
                    className="w-full text-left text-sm font-semibold text-text/80 hover:text-text transition"
                    onClick={() => {
                      setShowChangePassword((prev) => !prev);
                      setChangePwdError(null);
                      setChangePwdSuccess(false);
                      setOldPwd("");
                      setNewPwd("");
                      setConfirmPwd("");
                    }}
                    type="button"
                  >
                    {t("auth.changePassword")}
                  </button>

                  {showChangePassword && (
                    <form
                      className="mt-4 space-y-3"
                      onSubmit={handleChangePassword}
                    >
                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                          {t("auth.oldPassword")}
                        </label>
                        <input
                          autoComplete="current-password"
                          className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                          onChange={(e) => setOldPwd(e.target.value)}
                          placeholder="••••••"
                          required
                          type="password"
                          value={oldPwd}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                          {t("auth.newPassword")}
                        </label>
                        <input
                          autoComplete="new-password"
                          className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                          onChange={(e) => setNewPwd(e.target.value)}
                          placeholder="••••••"
                          required
                          type="password"
                          value={newPwd}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                          {t("auth.confirmPassword")}
                        </label>
                        <input
                          autoComplete="new-password"
                          className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                          onChange={(e) => setConfirmPwd(e.target.value)}
                          placeholder="••••••"
                          required
                          type="password"
                          value={confirmPwd}
                        />
                      </div>

                      {changePwdError && (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                          {changePwdError}
                        </div>
                      )}
                      {changePwdSuccess && (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                          {t("auth.passwordChanged")}
                        </div>
                      )}

                      <Button
                        className="w-full justify-center py-2 text-sm"
                        disabled={changePwdBusy}
                        size="lg"
                        type="submit"
                      >
                        {changePwdBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        {t("auth.changePassword")}
                      </Button>
                    </form>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    className="flex-1 justify-center"
                    onClick={onRefreshSession}
                    variant="ghost"
                  >
                    {t("auth.refreshAccess")}
                  </Button>
                  <Button
                    className="flex-1 justify-center"
                    onClick={onLogout}
                    variant="ghost"
                  >
                    {t("auth.logout")}
                  </Button>
                </div>
              </div>
            ) : mode === "forgot" ? (
              <div className="space-y-4">
                {forgotStep === "done" ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-6 text-center text-sm text-emerald-200">
                    {t("auth.passwordResetSuccess")}
                  </div>
                ) : forgotStep === "email" ? (
                  <form className="space-y-4" onSubmit={handleForgotSendCode}>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                        {t("auth.fields.email")}
                      </label>
                      <input
                        autoComplete="email"
                        className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t("auth.fields.emailPlaceholder")}
                        required
                        type="email"
                        value={email}
                      />
                    </div>

                    {forgotError && (
                      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {forgotError}
                      </div>
                    )}

                    <Button
                      className="w-full justify-center py-3 text-sm"
                      disabled={forgotBusy}
                      size="lg"
                      type="submit"
                    >
                      {forgotBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t("auth.sendCode")}
                    </Button>

                    <button
                      className="w-full text-center text-xs text-text/45 hover:text-text/70 transition"
                      onClick={handleBackToLogin}
                      type="button"
                    >
                      {t("auth.backToLogin")}
                    </button>
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={handleForgotReset}>
                    <p className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-text/75">
                      {t("auth.codeSent")}
                    </p>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                        {t("auth.verificationCode")}
                      </label>
                      <input
                        className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(e) => setForgotCode(e.target.value)}
                        placeholder={t("auth.verificationCodePlaceholder")}
                        required
                        value={forgotCode}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                        {t("auth.newPassword")}
                      </label>
                      <input
                        autoComplete="new-password"
                        className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                        onChange={(e) => setForgotNewPwd(e.target.value)}
                        placeholder={t("auth.fields.passwordPlaceholder")}
                        required
                        type="password"
                        value={forgotNewPwd}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                        {t("auth.confirmPassword")}
                      </label>
                      <input
                        autoComplete="new-password"
                        className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                        onChange={(e) => setForgotConfirmPwd(e.target.value)}
                        placeholder={t("auth.fields.passwordPlaceholder")}
                        required
                        type="password"
                        value={forgotConfirmPwd}
                      />
                    </div>

                    {forgotError && (
                      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {forgotError}
                      </div>
                    )}

                    <Button
                      className="w-full justify-center py-3 text-sm"
                      disabled={forgotBusy}
                      size="lg"
                      type="submit"
                    >
                      {forgotBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t("auth.resetPassword")}
                    </Button>

                    <button
                      className="w-full text-center text-xs text-text/45 hover:text-text/70 transition"
                      onClick={handleBackToLogin}
                      type="button"
                    >
                      {t("auth.backToLogin")}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                {mode === "register" ? (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                      {t("auth.fields.name")}
                    </label>
                    <input
                      className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("auth.fields.namePlaceholder")}
                      value={name}
                    />
                  </div>
                ) : null}

                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                    {t("auth.fields.email")}
                  </label>
                  <input
                    autoComplete="email"
                    className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("auth.fields.emailPlaceholder")}
                    required
                    type="email"
                    value={email}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                    {t("auth.fields.password")}
                  </label>
                  <input
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t("auth.fields.passwordPlaceholder")}
                    required
                    type="password"
                    value={password}
                  />
                  {mode === "login" && (
                    <button
                      className="mt-1 text-xs text-text/45 hover:text-text/70 transition"
                      onClick={() => {
                        setMode("forgot");
                        setForgotStep("email");
                        setForgotError(null);
                      }}
                      type="button"
                    >
                      {t("auth.forgotPassword")}
                    </button>
                  )}
                </div>

                {displayError ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {displayError}
                  </div>
                ) : null}

                <Button
                  className="w-full justify-center py-3 text-sm"
                  disabled={isLoading || isSubmitting}
                  size="lg"
                  type="submit"
                >
                  {isLoading || isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {mode === "register"
                    ? t("auth.createAccount")
                    : t("auth.loginToAccount")}
                </Button>

                <p className="text-center text-xs leading-6 text-text/45">
                  {t("auth.trialNote")}
                </p>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

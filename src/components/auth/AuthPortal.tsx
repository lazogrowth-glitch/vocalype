import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AuthPayload, AuthSession, ChangePasswordPayload } from "@/lib/auth/types";
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

const emailExistsPatterns = ["already exists", "already registered", "already in use", "email taken", "duplicate", "déjà utilisé", "deja utilise", "déjà enregistré", "existe déjà"];
const deviceExistsPatterns = ["existe déjà sur cet appareil", "device already registered", "account already exists on this device", "un compte existe"];
const labelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-text/60";
const inputClass = "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-[14px] text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60 focus:bg-white/[0.06]";

const hasPattern = (message: string, patterns: string[]) => patterns.some((p) => message.toLowerCase().includes(p));

const formatAccessLabel = (session: AuthSession, t: (key: string, opts?: Record<string, unknown>) => string) => {
  if (session.subscription.status === "active") return t("auth.access.active");
  if (session.subscription.status === "trialing") {
    if (!session.subscription.trial_ends_at) return t("auth.access.trialActive");
    const diff = Math.max(0, Math.ceil((new Date(session.subscription.trial_ends_at).getTime() - Date.now()) / 86400000));
    return diff <= 1 ? t("auth.access.trialEndsToday") : t("auth.access.trialDaysLeft", { count: diff });
  }
  if (session.subscription.status === "canceled") return t("auth.access.canceled");
  return t("auth.access.trialEnded");
};

export const AuthPortal = ({ isLoading, isSubmitting, error, session, onLogin, onRegister, onStartCheckout, onOpenBillingPortal, onRefreshSession, onLogout }: AuthPortalProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceAlreadyRegistered, setDeviceAlreadyRegistered] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [forgotStep, setForgotStep] = useState<ForgotStep>("email");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPwd, setForgotNewPwd] = useState("");
  const [forgotConfirmPwd, setForgotConfirmPwd] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [changePwdBusy, setChangePwdBusy] = useState(false);
  const [changePwdError, setChangePwdError] = useState<string | null>(null);

  useEffect(() => {
    authClient.isDeviceRegistered().then((registered) => {
      if (registered) {
        setDeviceAlreadyRegistered(true);
        setMode("login");
      }
    });
  }, []);

  useEffect(() => {
    if (error && mode === "register" && hasPattern(error, emailExistsPatterns)) setMode("login");
    if (error && mode === "register" && hasPattern(error, deviceExistsPatterns)) {
      setDeviceAlreadyRegistered(true);
      setMode("login");
    }
  }, [error, mode]);

  const hasAccess = session?.subscription.has_access ?? false;
  const accessLabel = useMemo(() => (session ? formatAccessLabel(session, t as any) : null), [session, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    if (mode === "register") {
      if (deviceAlreadyRegistered) return void setLocalError(t("auth.errors.deviceAlreadyRegistered"));
      if (await authClient.isEmailRegisteredOnDevice(email)) {
        setMode("login");
        return void setLocalError(t("auth.errors.emailExistsSwitchedToLogin"));
      }
    }
    const payload: AuthPayload = { email: email.trim(), password, ...(mode === "register" && name.trim() ? { name: name.trim() } : {}) };
    return mode === "register" ? onRegister(payload) : onLogin(payload);
  };

  const displayError = localError ? localError : error && !hasPattern(error, deviceExistsPatterns) ? hasPattern(error, emailExistsPatterns) && mode === "login" ? t("auth.errors.emailExistsSwitchedToLogin") : error : null;

  const openBillingLink = async (action: () => Promise<string>, refresh?: boolean) => {
    setBillingBusy(true);
    try {
      const url = await action();
      await openUrl(url);
      if (refresh) await onRefreshSession();
    } finally {
      setBillingBusy(false);
    }
  };

  const handleForgotSendCode = async (event: React.FormEvent<HTMLFormElement>) => {
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
    if (forgotNewPwd !== forgotConfirmPwd) return void setForgotError(t("auth.errors.passwordsDoNotMatch"));
    setForgotBusy(true);
    try {
      const newSession = await authClient.resetPassword({ email: email.trim(), code: forgotCode.trim(), new_password: forgotNewPwd });
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
      setForgotError(message.toLowerCase().includes("invalide") || message.toLowerCase().includes("expired") || message.toLowerCase().includes("expiré") ? t("auth.errors.invalidResetCode") : message || t("auth.errors.networkError"));
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

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChangePwdError(null);
    if (newPwd !== confirmPwd) return void setChangePwdError(t("auth.errors.passwordsDoNotMatch"));
    if (!session) return;
    setChangePwdBusy(true);
    try {
      const payload: ChangePasswordPayload = { old_password: oldPwd, new_password: newPwd };
      await authClient.changePassword(session.token, payload);
      setShowChangePassword(false);
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setTimeout(() => onLogout(), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setChangePwdError(message.toLowerCase().includes("actuel") || message.toLowerCase().includes("incorrect") || message.toLowerCase().includes("wrong") ? t("auth.errors.wrongOldPassword") : message || t("auth.errors.networkError"));
    } finally {
      setChangePwdBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(201,168,76,0.18),_transparent_36%),linear-gradient(180deg,_#120f0b_0%,_#090909_45%,_#050505_100%)] text-text">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
          <section className="rounded-[28px] border border-white/8 bg-background-ui/72 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="mb-10 flex items-center justify-between gap-4">
              <VocalTypeLogo width={180} />
              <div className="rounded-full border border-logo-primary/20 bg-logo-primary/10 px-4 py-2 text-xs font-semibold text-logo-primary">{t("auth.trialBadge")}</div>
            </div>
            <div className="space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-logo-primary/80">{t("auth.paidAccess")}</p>
              <h1 className="max-w-xl text-[42px] font-black leading-[0.95] tracking-[-0.04em] text-text xl:text-5xl">{t("auth.headline")}</h1>
              <p className="max-w-xl text-[15px] leading-7 text-text/68">{t("auth.subheadline")}</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[{ icon: Sparkles, title: t("auth.features.trial.title"), description: t("auth.features.trial.description") }, { icon: ShieldCheck, title: t("auth.features.subscription.title"), description: t("auth.features.subscription.description") }, { icon: LockKeyhole, title: t("auth.features.billing.title"), description: t("auth.features.billing.description") }].map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <item.icon className="mb-3 h-5 w-5 text-logo-primary" />
                  <h2 className="mb-2 text-sm font-semibold">{item.title}</h2>
                  <p className="text-sm leading-6 text-text/62">{item.description}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-[28px] border border-logo-primary/18 bg-[#121212]/92 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            {!session && mode !== "forgot" && (
              <div className="mb-6 flex rounded-full bg-white/5 p-1 text-sm">
                <button className={`flex-1 rounded-full px-4 py-2.5 font-medium transition ${mode === "register" ? "bg-logo-primary text-black shadow-[0_10px_30px_rgba(201,168,76,0.2)]" : "text-text/65 hover:text-text/82"}`} disabled={deviceAlreadyRegistered} onClick={() => setMode("register")} type="button">{t("auth.createAccount")}</button>
                <button className={`flex-1 rounded-full px-4 py-2.5 font-medium transition ${mode === "login" ? "bg-logo-primary text-black shadow-[0_10px_30px_rgba(201,168,76,0.2)]" : "text-text/65 hover:text-text/82"}`} onClick={() => setMode("login")} type="button">{t("auth.login")}</button>
              </div>
            )}
            {deviceAlreadyRegistered && !session && mode === "login" && <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{t("auth.errors.deviceAlreadyRegistered")}</div>}
            {session ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-logo-primary/20 bg-logo-primary/8 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-logo-primary">{t("auth.account")}</p>
                      <h2 className="mt-2 text-xl font-semibold text-text">{session.user.email}</h2>
                      <p className="mt-2 text-sm text-text/65">{accessLabel}</p>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${hasAccess ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>{hasAccess ? t("auth.unlocked") : t("auth.locked")}</div>
                  </div>
                </div>
                {!hasAccess ? (
                  <Button className="w-full justify-center py-3 text-sm" disabled={billingBusy} onClick={() => openBillingLink(onStartCheckout, true)} size="lg">{billingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("auth.subscribeNow")}</Button>
                ) : (
                  <Button className="w-full justify-center py-3 text-sm" disabled={billingBusy} onClick={() => openBillingLink(onOpenBillingPortal)} size="lg" variant="secondary">{billingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("auth.manageSubscription")}</Button>
                )}
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <button className="w-full text-left text-sm font-semibold text-text/80 transition hover:text-text" onClick={() => setShowChangePassword((prev) => !prev)} type="button">{t("auth.changePassword")}</button>
                  {showChangePassword && (
                    <form className="mt-4 space-y-3" onSubmit={handleChangePassword}>
                      <label className={labelClass}>{t("auth.oldPassword")}</label>
                      <input className={inputClass} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} type="password" placeholder="••••••" />
                      <label className={labelClass}>{t("auth.newPassword")}</label>
                      <input className={inputClass} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} type="password" placeholder="••••••" />
                      <label className={labelClass}>{t("auth.confirmPassword")}</label>
                      <input className={inputClass} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} type="password" placeholder="••••••" />
                      {changePwdError && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{changePwdError}</div>}
                      <Button className="w-full justify-center py-2 text-sm" disabled={changePwdBusy} size="lg" type="submit">{changePwdBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("auth.changePassword")}</Button>
                    </form>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button className="flex-1 justify-center" onClick={onRefreshSession} variant="ghost">{t("auth.refreshAccess")}</Button>
                  <Button className="flex-1 justify-center" onClick={onLogout} variant="ghost">{t("auth.logout")}</Button>
                </div>
              </div>
            ) : mode === "forgot" ? (
              <div className="space-y-4">
                {forgotStep === "done" ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-6 text-center text-sm text-emerald-200">{t("auth.passwordResetSuccess")}</div> : forgotStep === "email" ? (
                  <form className="space-y-4" onSubmit={handleForgotSendCode}>
                    <label className={labelClass}>{t("auth.fields.email")}</label>
                    <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t("auth.fields.emailPlaceholder")} />
                    {forgotError && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{forgotError}</div>}
                    <Button className="w-full justify-center py-3 text-sm" disabled={forgotBusy} size="lg" type="submit">{forgotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("auth.sendCode")}</Button>
                    <button className="w-full text-center text-[13px] text-text/65 transition hover:text-text/70" onClick={handleBackToLogin} type="button">{t("auth.backToLogin")}</button>
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={handleForgotReset}>
                    <p className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-text/75">{t("auth.codeSent")}</p>
                    <label className={labelClass}>{t("auth.verificationCode")}</label>
                    <input className={inputClass} value={forgotCode} onChange={(e) => setForgotCode(e.target.value)} />
                    <label className={labelClass}>{t("auth.newPassword")}</label>
                    <input className={inputClass} value={forgotNewPwd} onChange={(e) => setForgotNewPwd(e.target.value)} type="password" />
                    <label className={labelClass}>{t("auth.confirmPassword")}</label>
                    <input className={inputClass} value={forgotConfirmPwd} onChange={(e) => setForgotConfirmPwd(e.target.value)} type="password" />
                    {forgotError && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{forgotError}</div>}
                    <Button className="w-full justify-center py-3 text-sm" disabled={forgotBusy} size="lg" type="submit">{forgotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("auth.resetPassword")}</Button>
                    <button className="w-full text-center text-[13px] text-text/65 transition hover:text-text/70" onClick={handleBackToLogin} type="button">{t("auth.backToLogin")}</button>
                  </form>
                )}
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                {mode === "register" && (<><label className={labelClass}>{t("auth.fields.name")}</label><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.fields.namePlaceholder")} /></>)}
                <label className={labelClass}>{t("auth.fields.email")}</label>
                <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t("auth.fields.emailPlaceholder")} />
                <label className={labelClass}>{t("auth.fields.password")}</label>
                <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={t("auth.fields.passwordPlaceholder")} />
                {mode === "login" && <button className="mt-1 text-[13px] text-text/65 transition hover:text-text/70" onClick={() => setMode("forgot")} type="button">{t("auth.forgotPassword")}</button>}
                {displayError && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{displayError}</div>}
                <Button className="w-full justify-center py-3 text-sm" disabled={isLoading || isSubmitting} size="lg" type="submit">{isLoading || isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{mode === "register" ? t("auth.createAccount") : t("auth.loginToAccount")}</Button>
                <p className="text-center text-[13px] leading-6 text-text/65">{t("auth.trialNote")}</p>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

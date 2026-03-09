/* eslint-disable i18next/no-literal-string */
import { useMemo, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
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

type Mode = "login" | "register";

const formatAccessLabel = (session: AuthSession) => {
  if (session.subscription.status === "active") {
    return "Subscription active";
  }

  if (session.subscription.status === "trialing") {
    if (!session.subscription.trial_ends_at) {
      return "Free trial active";
    }

    const trialEnd = new Date(session.subscription.trial_ends_at);
    const diff = Math.max(
      0,
      Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );

    return diff <= 1
      ? "Trial ends today"
      : `${diff} days left in your free trial`;
  }

  if (session.subscription.status === "canceled") {
    return "Subscription canceled";
  }

  return "Free trial ended";
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
  const [mode, setMode] = useState<Mode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);

  const accessLabel = useMemo(
    () => (session ? formatAccessLabel(session) : null),
    [session],
  );

  const hasAccess = session?.subscription.has_access ?? false;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(201,168,76,0.18),_transparent_36%),linear-gradient(180deg,_#120f0b_0%,_#090909_45%,_#050505_100%)] text-text">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-logo-primary/20 bg-background-ui/70 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="mb-10 flex items-center justify-between gap-4">
              <VocalTypeLogo width={180} />
              <div className="rounded-full border border-logo-primary/20 bg-logo-primary/10 px-4 py-2 text-xs font-semibold text-logo-primary">
                7-day free trial, no card required
              </div>
            </div>

            <div className="space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-logo-primary/80">
                Paid access
              </p>
              <h1 className="max-w-xl text-5xl font-black leading-none tracking-[-0.04em] text-text">
                Create your account and unlock VocalType instantly.
              </h1>
              <p className="max-w-xl text-base leading-7 text-text/68">
                Every account starts with a 7-day free trial without requiring
                a card. After the trial ends, users can subscribe for $4.99 per
                month to keep unlimited dictation across ChatGPT, Claude,
                Gemini and Windows apps.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <Sparkles className="mb-3 h-5 w-5 text-logo-primary" />
                <h2 className="mb-2 text-sm font-semibold">7-day free trial</h2>
                <p className="text-sm leading-6 text-text/62">
                  Create an account and test the full product immediately, with
                  no card required upfront.
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <ShieldCheck className="mb-3 h-5 w-5 text-logo-primary" />
                <h2 className="mb-2 text-sm font-semibold">
                  Subscription checked
                </h2>
                <p className="text-sm leading-6 text-text/62">
                  The desktop app verifies account access before unlocking the
                  transcription workflow.
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <LockKeyhole className="mb-3 h-5 w-5 text-logo-primary" />
                <h2 className="mb-2 text-sm font-semibold">Simple billing</h2>
                <p className="text-sm leading-6 text-text/62">
                  Manage your subscription through Stripe from inside the app.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/8 bg-[#121212]/92 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <div className="mb-6 flex rounded-full bg-white/5 p-1 text-sm">
              <button
                className={`flex-1 rounded-full px-4 py-2 transition ${
                  mode === "register"
                    ? "bg-logo-primary text-black"
                    : "text-text/65"
                }`}
                onClick={() => setMode("register")}
                type="button"
              >
                Create account
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
                Login
              </button>
            </div>

            {session ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-logo-primary/20 bg-logo-primary/8 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-logo-primary">
                        Account
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
                      {hasAccess ? "Unlocked" : "Locked"}
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
                    Subscribe now
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
                    Manage subscription
                  </Button>
                )}

                <div className="flex gap-3">
                  <Button
                    className="flex-1 justify-center"
                    onClick={onRefreshSession}
                    variant="ghost"
                  >
                    Refresh access
                  </Button>
                  <Button
                    className="flex-1 justify-center"
                    onClick={onLogout}
                    variant="ghost"
                  >
                    Logout
                  </Button>
                </div>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                    {mode === "register" ? "Name" : "Email"}
                  </label>
                  {mode === "register" ? (
                    <input
                      className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                      value={name}
                    />
                  ) : null}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                    Email
                  </label>
                  <input
                    autoComplete="email"
                    className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    type="email"
                    value={email}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-text/55">
                    Password
                  </label>
                  <input
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-text outline-none transition placeholder:text-text/30 focus:border-logo-primary/60"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimum 6 characters"
                    type="password"
                    value={password}
                  />
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
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
                    ? "Create account"
                    : "Login to your account"}
                </Button>

                <p className="text-center text-xs leading-6 text-text/45">
                  Your 7-day free trial starts when you create your account. No
                  card is required until the trial ends.
                </p>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

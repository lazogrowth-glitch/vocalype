import { Suspense, useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useTranslation } from "react-i18next";
import "./App.css";
import { AuthPortal } from "./components/auth/AuthPortal";
import Onboarding, {
  AccessibilityOnboarding,
  ConsentStep,
} from "./components/onboarding";
import { TrialWelcomeModal } from "./components/onboarding/TrialWelcomeModal";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import { PlanContext } from "@/lib/subscription/context";
import { useAuthFlow } from "@/hooks/useAuthFlow";
import { useBackendEvents } from "@/hooks/useBackendEvents";
import { useOnboarding } from "@/hooks/useOnboarding";

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center opacity-40">
          <span className="text-sm">…</span>
        </div>
      }
    >
      <ActiveComponent />
    </Suspense>
  );
};

const OnboardingProgressBar: React.FC<{ current: number; total: number }> = ({
  current,
  total,
}) => {
  const { t } = useTranslation();
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center gap-1.5 pt-3 pb-2">
      <p className="text-[11px] text-text/35">
        {t("onboarding.progress.stepOf", { current, total })}
      </p>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className="h-[3px] w-7 rounded-full transition-all duration-300"
            style={{
              background:
                i < current
                  ? "rgba(100,140,255,0.9)"
                  : "rgba(255,255,255,0.12)",
            }}
          />
        ))}
      </div>
    </div>
  );
};

function App() {
  const { i18n, t } = useTranslation();
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

  const {
    session,
    authLoading,
    authSubmitting,
    authError,
    licenseState,
    showTrialWelcome,
    hasCompletedPostOnboardingInit,
    refreshSession,
    handleLogin,
    handleRegister,
    handleLogout,
    handleDismissTrialWelcome,
    handleStartCheckout,
    handleOpenBillingPortal,
  } = useAuthFlow(t);

  const hasAnyAccess =
    licenseState?.state === "online_valid" ||
    licenseState?.state === "offline_valid";

  const currentTier = session?.subscription?.tier ?? null;
  const isBasicTier = hasAnyAccess && currentTier === "basic";
  const hasPremiumAccess = hasAnyAccess && currentTier === "premium";
  const isTrialing =
    session?.subscription?.status === "trialing" && hasPremiumAccess;
  const trialEndsAt = isTrialing
    ? (session?.subscription?.trial_ends_at ?? null)
    : null;

  const {
    onboardingStep,
    handleConsentAccepted,
    handleAccessibilityComplete,
    handleModelSelected,
    handleGoBack,
  } = useOnboarding({
    authLoading,
    hasAnyAccess,
  });

  const [showFirstLaunchHint, setShowFirstLaunchHint] = useState(
    () => !localStorage.getItem("vt.firstUseHintShown"),
  );
  const dismissHint = useCallback(() => {
    localStorage.setItem("vt.firstUseHintShown", "1");
    setShowFirstLaunchHint(false);
  }, []);

  useBackendEvents({
    t,
    currentSection,
    setCurrentSection,
    settings,
    updateSetting,
  });

  // Initialize RTL direction when language changes
  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

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
  }, [
    onboardingStep,
    refreshAudioDevices,
    refreshOutputDevices,
    hasCompletedPostOnboardingInit,
  ]);

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

  if (onboardingStep === "consent") {
    return (
      <>
        <OnboardingProgressBar current={1} total={3} />
        <ConsentStep onAccept={handleConsentAccepted} />
      </>
    );
  }

  if (onboardingStep === "accessibility") {
    return (
      <>
        <OnboardingProgressBar current={2} total={3} />
        <AccessibilityOnboarding
          onComplete={handleAccessibilityComplete}
          onBack={handleGoBack}
        />
      </>
    );
  }

  if (onboardingStep === "model") {
    return (
      <>
        <OnboardingProgressBar current={3} total={3} />
        <Onboarding
          onModelSelected={handleModelSelected}
          onBack={handleGoBack}
        />
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
      <div
        dir={direction}
        style={{
          display: "flex",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          background: "#0f0f0f",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          color: "inherit",
        }}
      >
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

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "24px 28px",
            minWidth: 0,
            background: "#0f0f0f",
          }}
        >
          <h1
            style={{
              fontSize: 24,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: "-0.3px",
              color: "#fff",
              marginBottom: 20,
            }}
          >
            {SECTIONS_CONFIG[currentSection]
              ? t(SECTIONS_CONFIG[currentSection].labelKey)
              : t(SECTIONS_CONFIG.general.labelKey)}
          </h1>
          {showFirstLaunchHint && (
            <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-text/70">
              <span>
                {t("hints.firstLaunch", {
                  shortcut:
                    settings?.bindings?.transcribe?.current_binding ??
                    "Ctrl+Shift+Space",
                })}
              </span>
              <button
                onClick={dismissHint}
                className="text-text/30 hover:text-text/60 transition-colors text-base leading-none"
              >
                ×
              </button>
            </div>
          )}
          <ErrorBoundary>{renderSettingsContent(currentSection)}</ErrorBoundary>
        </main>
      </div>
    </PlanContext.Provider>
  );
}

export default App;

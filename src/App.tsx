import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useTranslation } from "react-i18next";
import "./App.css";
import { AuthPortal } from "./components/auth/AuthPortal";
import Onboarding, { AccessibilityOnboarding } from "./components/onboarding";
import { TrialWelcomeModal } from "./components/onboarding/TrialWelcomeModal";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import { PlanContext } from "@/lib/plan/context";
import { useAuthFlow } from "@/hooks/useAuthFlow";
import { useBackendEvents } from "@/hooks/useBackendEvents";
import { useOnboarding } from "@/hooks/useOnboarding";

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return <ActiveComponent />;
};

function App() {
  const { i18n, t } = useTranslation();
  const [currentSection, setCurrentSection] = useState<SidebarSection>("general");
  const { settings, updateSetting } = useSettings();
  const direction = getLanguageDirection(i18n.language);
  const refreshAudioDevices = useSettingsStore((state) => state.refreshAudioDevices);
  const refreshOutputDevices = useSettingsStore((state) => state.refreshOutputDevices);

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
  const isTrialing = session?.subscription?.status === "trialing" && hasPremiumAccess;
  const trialEndsAt = isTrialing ? (session?.subscription?.trial_ends_at ?? null) : null;

  const { onboardingStep, handleAccessibilityComplete, handleModelSelected } = useOnboarding({
    authLoading,
    hasAnyAccess,
  });

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
  }, [onboardingStep, refreshAudioDevices, refreshOutputDevices, hasCompletedPostOnboardingInit]);

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

  if (onboardingStep === "accessibility") {
    return <AccessibilityOnboarding onComplete={handleAccessibilityComplete} />;
  }

  if (onboardingStep === "model") {
    return (
      <>
        <Onboarding onModelSelected={handleModelSelected} />
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
    <div dir={direction} style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: "#0f0f0f", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "inherit" }}>
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

      <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px 28px", minWidth: 0, background: "#0f0f0f" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.3px", color: "#fff", marginBottom: 20 }}>
          {SECTIONS_CONFIG[currentSection]
            ? t(SECTIONS_CONFIG[currentSection].labelKey)
            : t(SECTIONS_CONFIG.general.labelKey)}
        </h1>
        <ErrorBoundary>
          {renderSettingsContent(currentSection)}
        </ErrorBoundary>
      </main>
    </div>
    </PlanContext.Provider>
  );
}

export default App;

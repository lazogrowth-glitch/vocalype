import { Suspense, useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TranscriptionWarmupBadge } from "./components/TranscriptionWarmupBadge";
import { TitleBar } from "./components/TitleBar";
import { useTranslation } from "react-i18next";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { AuthPortal } from "./components/auth/AuthPortal";
import Onboarding, {
  AccessibilityOnboarding,
  ConsentStep,
} from "./components/onboarding";
import { TrialWelcomeModal } from "./components/onboarding/TrialWelcomeModal";
import { Sidebar } from "./components/Sidebar";
import { SidebarSection, SECTIONS_CONFIG } from "./components/sections-config";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import { PlanContext } from "@/lib/subscription/context";
import { useAuthFlow } from "@/hooks/useAuthFlow";
import { useBackendEvents } from "@/hooks/useBackendEvents";
import { useOnboarding } from "@/hooks/useOnboarding";
import { listen } from "@tauri-apps/api/event";
import { authClient } from "@/lib/auth/client";
import { ensureVoiceStateStore } from "@/stores/voiceState";

const AUTH_WINDOW_SIZE = { width: 1348, height: 875 };
const APP_WINDOW_SIZE = { width: 1348, height: 875 };

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
    <div
      className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center"
      style={{ gap: 6, paddingTop: 12, paddingBottom: 8 }}
    >
      <p className="text-[11px] text-text/70">
        {t("onboarding.progress.stepOf", { current, total })}
      </p>
      <div style={{ display: "flex", gap: 4 }}>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("vt.sidebarCollapsed") === "1",
  );
  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("vt.sidebarCollapsed", next ? "1" : "0");
      return next;
    });
  };
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
    handleDeepLinkAuth,
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
  const needsAuthWindow = !session || !hasAnyAccess;

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

  // Auto-dismiss the hint the first time a real transcription fires
  useEffect(() => {
    if (!showFirstLaunchHint) return;
    const unlisten = listen("transcription-lifecycle", dismissHint);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [showFirstLaunchHint, dismissHint]);

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

  // Handle deep link auth: vocalype://auth-callback?token=xxx
  useEffect(() => {
    const unlisten = listen<string>("deep-link-auth", async (event) => {
      const token = event.payload;
      if (token) {
        await handleDeepLinkAuth(token);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleDeepLinkAuth]);

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

  useEffect(() => {
    const target = needsAuthWindow ? AUTH_WINDOW_SIZE : APP_WINDOW_SIZE;
    const resizeWindow = async () => {
      try {
        const window = getCurrentWindow();
        await window.setMinSize(new LogicalSize(1348, 875));
        await window.setSize(new LogicalSize(target.width, target.height));
        await window.center();
      } catch (windowError) {
        console.warn("Failed to resize main window:", windowError);
      }
    };

    void resizeWindow();
  }, [needsAuthWindow]);

  useEffect(() => {
    ensureVoiceStateStore();
  }, []);

  if (authLoading) {
    return (
      <div
        dir={direction}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#0f0f0f",
        }}
      >
        <TitleBar />
        <div className="flex-1 flex items-center justify-center text-sm text-mid-gray">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (!session || !hasAnyAccess) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#050505",
        }}
      >
        <TitleBar />
        <div style={{ flex: 1, minHeight: 0 }}>
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
        </div>
      </div>
    );
  }

  if (onboardingStep === null) {
    return (
      <div
        dir={direction}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#0f0f0f",
        }}
      >
        <TitleBar />
        <div className="flex-1 flex items-center justify-center text-sm text-mid-gray">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (onboardingStep === "consent") {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <TitleBar />
        <OnboardingProgressBar current={1} total={3} />
        <ConsentStep onAccept={handleConsentAccepted} />
      </div>
    );
  }

  if (onboardingStep === "accessibility") {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <TitleBar />
        <OnboardingProgressBar current={2} total={3} />
        <AccessibilityOnboarding
          onComplete={handleAccessibilityComplete}
          onBack={handleGoBack}
        />
      </div>
    );
  }

  if (onboardingStep === "model") {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <TitleBar />
        <OnboardingProgressBar current={3} total={3} />
        <Onboarding
          onModelSelected={handleModelSelected}
          onBack={handleGoBack}
        />
        {showTrialWelcome && (
          <TrialWelcomeModal onDismiss={handleDismissTrialWelcome} />
        )}
      </div>
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
          flexDirection: "column",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          background: "#0f0f0f",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          color: "inherit",
        }}
      >
        <TitleBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          session={session}
          isTrialing={isTrialing}
          trialEndsAt={trialEndsAt}
          onLogout={handleLogout}
          onOpenBillingPortal={handleOpenBillingPortal}
        />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-text focus:rounded-lg focus:ring-2 focus:ring-logo-primary focus:outline-none text-sm font-medium"
        >
          {t("a11y.skipToMain")}
        </a>
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          id="toast-announcer"
        />
        <Toaster
          theme="system"
          containerAriaLabel={t("a11y.notifications")}
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
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            background: "#141414",
          }}
        >
          <Sidebar
            activeSection={currentSection}
            onSectionChange={setCurrentSection}
            collapsed={sidebarCollapsed}
          />

          <main
            id="main-content"
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              padding: "20px 28px 28px",
              minWidth: 0,
              minHeight: 0,
              background: "#0f0f0f",
              borderTopLeftRadius: 16,
              marginTop: -1,
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
            <TranscriptionWarmupBadge />
            {showFirstLaunchHint && (
              <div
                className="rounded-xl border border-white/10 bg-white/[0.04] text-sm text-text/70"
                style={{
                  margin: "0 16px 12px",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>
                  {t("hints.firstLaunch", {
                    shortcut:
                      settings?.bindings?.transcribe?.current_binding ??
                      "Ctrl+Space",
                  })}
                </span>
              </div>
            )}
            <ErrorBoundary>
              {renderSettingsContent(currentSection)}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </PlanContext.Provider>
  );
}

export default App;

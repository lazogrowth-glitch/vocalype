import { Suspense, useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TitleBar } from "./components/TitleBar";
import { useTranslation } from "react-i18next";
import {
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
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
import { ensureVoiceStateStore } from "@/stores/voiceState";

const NAVIGATE_SETTINGS_EVENT = "vocalype:navigate-settings";

const DESIGN_WINDOW_SIZE = { width: 1348, height: 875 };
const MIN_WINDOW_SIZE = { width: 760, height: 540 };
const REFERENCE_SCREEN_SIZE = { width: 1920, height: 1080 };
const DEFAULT_WIDTH_RATIO =
  DESIGN_WINDOW_SIZE.width / REFERENCE_SCREEN_SIZE.width;
const DEFAULT_HEIGHT_RATIO =
  DESIGN_WINDOW_SIZE.height / REFERENCE_SCREEN_SIZE.height;

type WindowSize = {
  width: number;
  height: number;
};

type StoredWindowSize = WindowSize & {
  widthRatio?: number;
  heightRatio?: number;
  screenWidth?: number;
  screenHeight?: number;
};

type LayoutTier = "compact" | "cozy" | "spacious";

const WINDOW_SIZE_STORAGE_KEY = "vt.windowSize";

const SECTION_DESCRIPTION_KEYS: Partial<Record<SidebarSection, string>> = {
  general: "shell.sectionDescriptions.general",
  models: "shell.sectionDescriptions.models",
  postprocessing: "shell.sectionDescriptions.postprocessing",
  snippets: "shell.sectionDescriptions.snippets",
  history: "shell.sectionDescriptions.history",
  meetings: "shell.sectionDescriptions.meetings",
  notes: "shell.sectionDescriptions.notes",
  stats: "shell.sectionDescriptions.stats",
  advanced: "shell.sectionDescriptions.advanced",
  billing: "shell.sectionDescriptions.billing",
  referral: "shell.sectionDescriptions.referral",
  about: "shell.sectionDescriptions.about",
  debug: "shell.sectionDescriptions.debug",
};

function getViewportWidth() {
  return typeof window === "undefined"
    ? DESIGN_WINDOW_SIZE.width
    : window.innerWidth;
}

function getLayoutTier(width: number): LayoutTier {
  if (width < 1100) return "compact";
  if (width < 1380) return "cozy";
  return "spacious";
}

function readStoredWindowSize(): StoredWindowSize | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WINDOW_SIZE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWindowSize>;
    if (
      typeof parsed.width === "number" &&
      typeof parsed.height === "number" &&
      Number.isFinite(parsed.width) &&
      Number.isFinite(parsed.height)
    ) {
      return {
        width: Math.round(parsed.width),
        height: Math.round(parsed.height),
        widthRatio:
          typeof parsed.widthRatio === "number" &&
          Number.isFinite(parsed.widthRatio)
            ? parsed.widthRatio
            : undefined,
        heightRatio:
          typeof parsed.heightRatio === "number" &&
          Number.isFinite(parsed.heightRatio)
            ? parsed.heightRatio
            : undefined,
        screenWidth:
          typeof parsed.screenWidth === "number" &&
          Number.isFinite(parsed.screenWidth)
            ? Math.round(parsed.screenWidth)
            : undefined,
        screenHeight:
          typeof parsed.screenHeight === "number" &&
          Number.isFinite(parsed.screenHeight)
            ? Math.round(parsed.screenHeight)
            : undefined,
      };
    }
  } catch {
    window.localStorage.removeItem(WINDOW_SIZE_STORAGE_KEY);
  }

  return null;
}

function writeStoredWindowSize(size: StoredWindowSize) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WINDOW_SIZE_STORAGE_KEY, JSON.stringify(size));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function resolveAdaptiveWindowSize(): Promise<WindowSize> {
  const monitorBounds = await resolveMonitorBounds();
  if (!monitorBounds) {
    return DESIGN_WINDOW_SIZE;
  }

  return {
    width: Math.round(
      clamp(
        monitorBounds.width * DEFAULT_WIDTH_RATIO,
        Math.min(MIN_WINDOW_SIZE.width, monitorBounds.width),
        monitorBounds.width,
      ),
    ),
    height: Math.round(
      clamp(
        monitorBounds.height * DEFAULT_HEIGHT_RATIO,
        Math.min(MIN_WINDOW_SIZE.height, monitorBounds.height),
        monitorBounds.height,
      ),
    ),
  };
}

async function resolveMonitorBounds(): Promise<WindowSize | null> {
  const monitor = await currentMonitor();
  if (!monitor) return null;

  const scale = monitor.scaleFactor || 1;
  return {
    width: Math.round(monitor.workArea.size.width / scale),
    height: Math.round(monitor.workArea.size.height / scale),
  };
}

async function resolveWindowSize(): Promise<WindowSize> {
  const storedSize = readStoredWindowSize();
  const monitorBounds = await resolveMonitorBounds();

  if (!monitorBounds) {
    return DESIGN_WINDOW_SIZE;
  }

  if (!storedSize) {
    return resolveAdaptiveWindowSize();
  }

  const widthRatio =
    storedSize.widthRatio ??
    (storedSize.screenWidth && storedSize.screenWidth > 0
      ? storedSize.width / storedSize.screenWidth
      : DEFAULT_WIDTH_RATIO);
  const heightRatio =
    storedSize.heightRatio ??
    (storedSize.screenHeight && storedSize.screenHeight > 0
      ? storedSize.height / storedSize.screenHeight
      : DEFAULT_HEIGHT_RATIO);

  return {
    width: Math.round(
      clamp(
        monitorBounds.width * widthRatio,
        Math.min(MIN_WINDOW_SIZE.width, monitorBounds.width),
        monitorBounds.width,
      ),
    ),
    height: Math.round(
      clamp(
        monitorBounds.height * heightRatio,
        Math.min(MIN_WINDOW_SIZE.height, monitorBounds.height),
        monitorBounds.height,
      ),
    ),
  };
}

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
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
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
  const layoutTier = getLayoutTier(viewportWidth);
  const shouldForceCompactSidebar = layoutTier === "compact";
  const effectiveSidebarCollapsed = shouldForceCompactSidebar
    ? true
    : sidebarCollapsed;
  const mainContentPadding =
    layoutTier === "compact"
      ? "20px 22px 28px"
      : layoutTier === "cozy"
        ? "24px 28px 32px"
        : "28px 36px 36px";
  const mainHeadingSize =
    layoutTier === "compact" ? 24 : layoutTier === "cozy" ? 26 : 28;
  const pageTitle = SECTIONS_CONFIG[currentSection]
    ? t(SECTIONS_CONFIG[currentSection].labelKey)
    : t(SECTIONS_CONFIG.general.labelKey);
  const pageDescription = t(
    SECTION_DESCRIPTION_KEYS[currentSection] ??
      "shell.sectionDescriptions.default",
  );

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const windowHandle = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    const bindResizeListener = async () => {
      unlisten = await windowHandle.onResized(async () => {
        try {
          const [size, scaleFactor, monitorBounds] = await Promise.all([
            windowHandle.innerSize(),
            windowHandle.scaleFactor(),
            resolveMonitorBounds(),
          ]);
          const width = Math.round(size.width / scaleFactor);
          const height = Math.round(size.height / scaleFactor);
          writeStoredWindowSize({
            width,
            height,
            screenWidth: monitorBounds?.width,
            screenHeight: monitorBounds?.height,
            widthRatio:
              monitorBounds && monitorBounds.width > 0
                ? width / monitorBounds.width
                : undefined,
            heightRatio:
              monitorBounds && monitorBounds.height > 0
                ? height / monitorBounds.height
                : undefined,
          });
        } catch (error) {
          console.warn("Failed to persist window size:", error);
        }
      });
    };

    void bindResizeListener();

    return () => {
      unlisten?.();
    };
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
    const initializeWindowSize = async () => {
      try {
        const window = getCurrentWindow();
        const monitorBounds = await resolveMonitorBounds();
        const minWidth = monitorBounds
          ? Math.min(MIN_WINDOW_SIZE.width, monitorBounds.width)
          : MIN_WINDOW_SIZE.width;
        const minHeight = monitorBounds
          ? Math.min(MIN_WINDOW_SIZE.height, monitorBounds.height)
          : MIN_WINDOW_SIZE.height;
        await window.setMinSize(new LogicalSize(minWidth, minHeight));

        const target = await resolveWindowSize();
        await window.setSize(new LogicalSize(target.width, target.height));
        if (readStoredWindowSize() === null) {
          await window.center();
        }
      } catch (windowError) {
        console.warn("Failed to initialize main window size:", windowError);
      }
    };

    void initializeWindowSize();
  }, []);

  useEffect(() => {
    ensureVoiceStateStore();
  }, []);

  useEffect(() => {
    const handleNavigateSettings = (event: Event) => {
      const section = (event as CustomEvent<SidebarSection>).detail;
      if (section && SECTIONS_CONFIG[section]) {
        setCurrentSection(section);
      }
    };

    window.addEventListener(NAVIGATE_SETTINGS_EVENT, handleNavigateSettings);
    return () =>
      window.removeEventListener(
        NAVIGATE_SETTINGS_EVENT,
        handleNavigateSettings,
      );
  }, [setCurrentSection]);

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
      <div dir={direction} className="app-shell">
        <TitleBar
          sidebarCollapsed={effectiveSidebarCollapsed}
          layoutTier={layoutTier}
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
        <div className="app-frame">
          <Sidebar
            activeSection={currentSection}
            onSectionChange={setCurrentSection}
            collapsed={effectiveSidebarCollapsed}
            layoutTier={layoutTier}
          />

          <main
            id="main-content"
            className="app-main"
            style={{
              padding: mainContentPadding,
              ["--main-pad-top" as string]:
                layoutTier === "compact"
                  ? "20px"
                  : layoutTier === "cozy"
                    ? "24px"
                    : "28px",
              ["--main-pad-x" as string]:
                layoutTier === "compact"
                  ? "22px"
                  : layoutTier === "cozy"
                    ? "28px"
                    : "36px",
            }}
          >
            <div className="app-main-inner">
              <div className="app-header-block">
                <h1
                  className="app-page-title"
                  style={{ fontSize: mainHeadingSize }}
                >
                  {pageTitle}
                </h1>
                <p className="app-page-subtitle">{pageDescription}</p>
              </div>

              {showFirstLaunchHint && (
                <div className="app-first-launch-hint">
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
            </div>
          </main>
        </div>
      </div>
    </PlanContext.Provider>
  );
}

export default App;

/* eslint-disable i18next/no-literal-string */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TitleBar } from "./components/TitleBar";
import { useTranslation } from "react-i18next";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { AuthPortal } from "./components/auth/AuthPortal";
import FirstRunDownload from "./components/onboarding/FirstRunDownload";
import { Sidebar } from "./components/Sidebar";
import {
  isSectionVisibleInLaunch,
  SidebarSection,
  SECTIONS_CONFIG,
} from "./components/sections-config";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import { PlanContext } from "@/lib/subscription/context";
import { useAuthFlow } from "@/hooks/useAuthFlow";
import { useBackendEvents } from "@/hooks/useBackendEvents";
import { useOnboarding } from "@/hooks/useOnboarding";
import { emit, listen } from "@tauri-apps/api/event";
import { ensureVoiceStateStore } from "@/stores/voiceState";
import { cleanupTauriListen, safeUnlisten } from "@/lib/tauri/events";

const NAVIGATE_SETTINGS_EVENT = "vocalype:navigate-settings";

const DESIGN_WINDOW_SIZE = { width: 1348, height: 875 };

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

function writeStoredWindowSize(size: StoredWindowSize) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WINDOW_SIZE_STORAGE_KEY, JSON.stringify(size));
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

const renderSettingsContent = (section: SidebarSection, settings: unknown) => {
  if (!isSectionVisibleInLaunch(section, settings)) {
    return null;
  }

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

function App() {
  const { i18n, t } = useTranslation();
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("general");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("vt.sidebarCollapsed") === "1",
  );
  const lastDeepLinkTokenRef = useRef<string | null>(null);
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
    activationStatus,
    licenseState,
    hasCompletedPostOnboardingInit,
    refreshSession,
    handleDeepLinkAuth,
    handleLogin,
    handleRegister,
    handleLogout,
    handleStartCheckout,
    handleOpenBillingPortal,
  } = useAuthFlow(t);

  const hasAnyAccess =
    licenseState?.state === "online_valid" ||
    licenseState?.state === "offline_valid";
  const hasAccountAccess = session?.subscription.has_access === true;
  const canEnterApp = hasAnyAccess;
  const isActivationPending = hasAccountAccess && !hasAnyAccess;
  const currentTier = session?.subscription?.tier ?? null;
  const isBasicTier = canEnterApp && currentTier === "basic";
  const hasPremiumAccess = canEnterApp && currentTier === "premium";
  const isTrialing =
    session?.subscription?.status === "trialing" && hasPremiumAccess;
  const trialEndsAt = isTrialing
    ? (session?.subscription?.trial_ends_at ?? null)
    : null;

  const { onboardingStep, handleFirstRunComplete } = useOnboarding({
    authLoading,
    hasAnyAccess: canEnterApp,
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
      ? "24px 26px 32px"
      : layoutTier === "cozy"
        ? "32px 40px 44px"
        : "40px 48px 52px";
  const mainHeadingSize =
    layoutTier === "compact" ? 26 : layoutTier === "cozy" ? 30 : 32;
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
      safeUnlisten(unlisten);
    };
  }, []);

  // Auto-dismiss the hint the first time a real transcription fires
  useEffect(() => {
    if (!showFirstLaunchHint) return;
    const unlisten = listen("transcription-lifecycle", dismissHint);
    return () => {
      cleanupTauriListen(unlisten);
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

  // Auto-detect system language on first load.
  // If the user never touched the language setting (still "auto"), silently
  // switch to their OS language so the logit-bias fix activates automatically.
  // The user can always revert to "auto" in settings.
  useEffect(() => {
    if (!settings) return;
    if (settings.selected_language !== "auto") return;

    // navigator.language → e.g. "fr-FR", "en-US", "zh-TW", "de-DE"
    const systemLang = navigator.language || "";
    const primary = systemLang.split("-")[0].toLowerCase();
    const region = systemLang.split("-")[1]?.toUpperCase() ?? "";

    // Special cases for Chinese variants
    let langCode: string;
    if (primary === "zh") {
      langCode = region === "TW" || region === "HK" ? "zh-Hant" : "zh-Hans";
    } else {
      langCode = primary;
    }

    // Only set if it's a supported language (not "auto", not unknown)
    const SUPPORTED = [
      "en",
      "fr",
      "de",
      "es",
      "pt",
      "it",
      "nl",
      "ru",
      "pl",
      "tr",
      "ko",
      "ja",
      "zh-Hans",
      "zh-Hant",
      "ar",
      "hi",
      "sv",
      "fi",
      "da",
      "no",
      "cs",
      "ro",
      "hu",
      "uk",
      "el",
      "bg",
      "hr",
      "sk",
      "lt",
      "lv",
      "et",
      "he",
      "vi",
      "th",
      "id",
      "ms",
      "fa",
      "ur",
      "bn",
      "ta",
      "ml",
      "te",
      "kn",
      "si",
      "km",
    ];
    if (langCode && SUPPORTED.includes(langCode) && langCode !== "en") {
      updateSetting("selected_language", langCode);
    }
    // English → leave as "auto" (English is already the model's dominant language,
    // no bias needed — auto-detect works fine for English speakers)
  }, [!!settings]);

  // Handle deep link auth: vocalype://auth-callback?token=xxx
  useEffect(() => {
    const unlisten = listen<string>("deep-link-auth", async (event) => {
      const token = event.payload;
      if (token && lastDeepLinkTokenRef.current !== token) {
        lastDeepLinkTokenRef.current = token;
        await handleDeepLinkAuth(token);
        try {
          await emit("desktop-auth-ready");
        } catch (error) {
          console.warn("Failed to notify desktop auth completion:", error);
        }
      }
    });
    return () => {
      cleanupTauriListen(unlisten);
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
    if (!isActivationPending) return;

    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;

    const refreshPendingActivation = async () => {
      if (cancelled || attempts >= 12) return;
      attempts += 1;
      try {
        await refreshSession();
      } catch (error) {
        console.warn("Pending activation refresh failed:", error);
      }

      if (!cancelled && attempts < 12) {
        timer = window.setTimeout(refreshPendingActivation, 5000);
      }
    };

    void refreshPendingActivation();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isActivationPending, refreshSession]);

  useEffect(() => {
    ensureVoiceStateStore();
  }, []);

  useEffect(() => {
    if (!isSectionVisibleInLaunch(currentSection, settings)) {
      setCurrentSection("general");
    }
  }, [currentSection, settings]);

  useEffect(() => {
    const handleNavigateSettings = (event: Event) => {
      const section = (event as CustomEvent<SidebarSection>).detail;
      if (section && isSectionVisibleInLaunch(section, settings)) {
        setCurrentSection(section);
      }
    };

    window.addEventListener(NAVIGATE_SETTINGS_EVENT, handleNavigateSettings);
    return () =>
      window.removeEventListener(
        NAVIGATE_SETTINGS_EVENT,
        handleNavigateSettings,
      );
  }, [settings, setCurrentSection]);

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

  if (!session || !canEnterApp) {
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
            activationStatus={activationStatus}
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

  if (onboardingStep === "first-run") {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <TitleBar />
        <FirstRunDownload onComplete={handleFirstRunComplete} />
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
        {isActivationPending ? (
          <div className="activation-banner" role="status">
            <span className="activation-banner-dot" />
            <span>
              {t("auth.activationPending", {
                defaultValue:
                  "Activation du compte en arrière-plan. Vous pouvez déjà entrer dans Vocalype.",
              })}
            </span>
          </div>
        ) : null}
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
                  ? "24px"
                  : layoutTier === "cozy"
                    ? "32px"
                    : "40px",
              ["--main-pad-x" as string]:
                layoutTier === "compact"
                  ? "26px"
                  : layoutTier === "cozy"
                    ? "40px"
                    : "48px",
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
                    Votre premiere dictee : utilisez{" "}
                    {settings?.bindings?.transcribe?.current_binding ??
                      "Ctrl+Space"}{" "}
                    et dites une phrase courte pour verifier que tout
                    fonctionne.{" "}
                    {t("hints.firstLaunch", {
                      shortcut:
                        settings?.bindings?.transcribe?.current_binding ??
                        "Ctrl+Space",
                    })}
                  </span>
                </div>
              )}

              <ErrorBoundary>
                {renderSettingsContent(currentSection, settings)}
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </PlanContext.Provider>
  );
}

export default App;

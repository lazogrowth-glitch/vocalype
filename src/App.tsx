import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { TitleBar } from "./components/TitleBar";
import { useTranslation } from "react-i18next";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { AuthPortal } from "./components/auth/AuthPortal";
import { SidebarSection, SECTIONS_CONFIG } from "./components/sections-config";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import { useAuthFlow } from "@/hooks/useAuthFlow";
import { useOnboarding } from "@/hooks/useOnboarding";
import { emit, listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { ensureVoiceStateStore } from "@/stores/voiceState";
import { cleanupTauriListen, safeUnlisten } from "@/lib/tauri/events";

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

const FirstRunDownload = lazy(
  () => import("./components/onboarding/FirstRunDownload"),
);

const DesktopAppShell = lazy(() => import("./components/DesktopAppShell"));

const SECTION_DESCRIPTION_KEYS: Partial<Record<SidebarSection, string>> = {
  general: "shell.sectionDescriptions.general",
  models: "shell.sectionDescriptions.models",
  postprocessing: "shell.sectionDescriptions.postprocessing",
  snippets: "shell.sectionDescriptions.snippets",
  history: "shell.sectionDescriptions.history",
  meetings: "shell.sectionDescriptions.meetings",
  stats: "shell.sectionDescriptions.stats",
  advanced: "shell.sectionDescriptions.advanced",
  billing: "shell.sectionDescriptions.billing",
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

function LoadingShell({
  direction,
  message,
}: {
  direction: string;
  message: string;
}) {
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
        {message}
      </div>
    </div>
  );
}

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

  useEffect(() => {
    if (!showFirstLaunchHint) return;
    const unlisten = listen("transcription-lifecycle", dismissHint);
    return () => {
      cleanupTauriListen(unlisten);
    };
  }, [showFirstLaunchHint, dismissHint]);

  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    if (!settings) return;
    if (settings.selected_language !== "auto") return;

    const systemLang = navigator.language || "";
    const primary = systemLang.split("-")[0].toLowerCase();
    const region = systemLang.split("-")[1]?.toUpperCase() ?? "";

    let langCode: string;
    if (primary === "zh") {
      langCode = region === "TW" || region === "HK" ? "zh-Hant" : "zh-Hans";
    } else {
      langCode = primary;
    }

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
  }, [!!settings]);

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

  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      if (platform() === "macos") {
        Promise.all([
          commands.initializeEnigo(),
          commands.initializeShortcuts(),
        ]).catch((e) => {
          console.warn("Failed to initialize macOS input runtime:", e);
        });
      }
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

  if (authLoading) {
    return <LoadingShell direction={direction} message={t("common.loading")} />;
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
    return <LoadingShell direction={direction} message={t("common.loading")} />;
  }

  if (onboardingStep === "first-run") {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <TitleBar />
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-mid-gray">
              {t("common.loading")}
            </div>
          }
        >
          <FirstRunDownload onComplete={handleFirstRunComplete} />
        </Suspense>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <LoadingShell direction={direction} message={t("common.loading")} />
      }
    >
      <DesktopAppShell
        t={t}
        direction={direction}
        currentSection={currentSection}
        setCurrentSection={setCurrentSection}
        settings={settings}
        updateSetting={updateSetting}
        layoutTier={layoutTier}
        effectiveSidebarCollapsed={effectiveSidebarCollapsed}
        toggleSidebar={toggleSidebar}
        session={session}
        isTrialing={isTrialing}
        trialEndsAt={trialEndsAt}
        handleLogout={handleLogout}
        handleOpenBillingPortal={handleOpenBillingPortal}
        isActivationPending={isActivationPending}
        mainContentPadding={mainContentPadding}
        mainHeadingSize={mainHeadingSize}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
        showFirstLaunchHint={showFirstLaunchHint}
        isBasicTier={isBasicTier}
        handleStartCheckout={handleStartCheckout}
      />
    </Suspense>
  );
}

export default App;

/* eslint-disable i18next/no-literal-string */
import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./ErrorBoundary";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { authClient } from "@/lib/auth/client";
import type { AuthSession, BillingCheckoutRequest } from "@/lib/auth/types";
import {
  isSectionVisibleInLaunch,
  SidebarSection,
  SECTIONS_CONFIG,
} from "./sections-config";
import { PlanContext } from "@/lib/subscription/context";
import { deriveAppPlan, getPlanCapabilities } from "@/lib/subscription/plans";
import {
  loadPersistedTeamWorkspace,
  mapTeamWorkspacePayload,
  savePersistedTeamWorkspace,
  type TeamWorkspace,
} from "@/lib/subscription/workspace";
import { useBackendEvents } from "@/hooks/useBackendEvents";
import type { AppSettings } from "@/bindings";
import { UpgradePlansModal } from "./billing/UpgradePlansModal";

type LayoutTier = "compact" | "cozy" | "spacious";

type DesktopAppShellProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  direction: string;
  currentSection: SidebarSection;
  setCurrentSection: (section: SidebarSection) => void;
  settings: AppSettings | null | undefined;
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => Promise<void>;
  layoutTier: LayoutTier;
  effectiveSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  session: AuthSession | null;
  isTrialing: boolean;
  trialEndsAt: string | null;
  handleLogout: () => void;
  handleOpenBillingPortal: () => Promise<string>;
  isActivationPending: boolean;
  mainContentPadding: string;
  mainHeadingSize: number;
  pageTitle: string;
  pageDescription: string;
  showFirstLaunchHint: boolean;
  isBasicTier: boolean;
  handleStartCheckout: (selection?: BillingCheckoutRequest) => Promise<string>;
};

const NAVIGATE_SETTINGS_EVENT = "vocalype:navigate-settings";
const NAVIGATE_SETTINGS_SCROLL_RETRIES = 12;
const NAVIGATE_SETTINGS_HIGHLIGHT_CLASS = "settings-scroll-highlight";
const NAVIGATE_SETTINGS_HIGHLIGHT_DURATION_MS = 2400;

type NavigateSettingsDetail =
  | SidebarSection
  | {
      section: SidebarSection;
      scrollToId?: string;
    };

const renderSettingsContent = (section: SidebarSection, settings: unknown) => {
  if (!isSectionVisibleInLaunch(section, settings)) {
    return null;
  }

  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.dictee.component;
  return (
    <ErrorBoundary>
      <ActiveComponent />
    </ErrorBoundary>
  );
};

const isSectionFullBleed = (section: SidebarSection) =>
  (SECTIONS_CONFIG[section] as { fullBleed?: boolean })?.fullBleed === true;

export function DesktopAppShell({
  t,
  direction,
  currentSection,
  setCurrentSection,
  settings,
  updateSetting,
  layoutTier,
  effectiveSidebarCollapsed,
  toggleSidebar,
  session,
  isTrialing,
  trialEndsAt,
  handleLogout,
  handleOpenBillingPortal,
  isActivationPending,
  mainContentPadding,
  mainHeadingSize,
  pageTitle,
  pageDescription,
  showFirstLaunchHint,
  isBasicTier,
  handleStartCheckout,
}: DesktopAppShellProps) {
  const [plansOpen, setPlansOpen] = useState(false);
  const [checkoutLoadingKey, setCheckoutLoadingKey] = useState<string | null>(
    null,
  );
  const currentPlan = deriveAppPlan(session);
  const capabilities = getPlanCapabilities(currentPlan);
  const sessionWorkspace = useMemo(
    () => (session?.workspace ? mapTeamWorkspacePayload(session.workspace) : null),
    [session?.workspace],
  );
  const [teamWorkspace, setTeamWorkspace] = useState<TeamWorkspace | null>(
    null,
  );

  useBackendEvents({
    t,
    currentSection,
    setCurrentSection,
    settings,
    updateSetting,
  });

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || currentPlan !== "small_agency") {
      setTeamWorkspace(null);
      return;
    }

    const persistedWorkspace = loadPersistedTeamWorkspace(userId);
    setTeamWorkspace(sessionWorkspace ?? persistedWorkspace ?? null);

    const token = session?.token ?? authClient.getStoredToken();
    if (!token || sessionWorkspace) {
      return;
    }

    let cancelled = false;
    authClient
      .fetchWorkspaceTeam(token)
      .then((response) => {
        if (cancelled) return;
        setTeamWorkspace(mapTeamWorkspacePayload(response.workspace));
      })
      .catch(() => {
        // Keep the persisted workspace if the backend workspace is not reachable yet.
      });

    return () => {
      cancelled = true;
    };
  }, [currentPlan, session?.token, session?.user?.id, sessionWorkspace]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || currentPlan !== "small_agency") {
      return;
    }
    savePersistedTeamWorkspace(userId, teamWorkspace);
  }, [currentPlan, session, teamWorkspace]);

  useEffect(() => {
    if (!isSectionVisibleInLaunch(currentSection, settings)) {
      setCurrentSection("dictee");
    }
  }, [currentSection, settings, setCurrentSection]);

  useEffect(() => {
    let pendingScrollTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingHighlightTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightedElement: HTMLElement | null = null;

    const clearTargetHighlight = () => {
      if (pendingHighlightTimer) {
        clearTimeout(pendingHighlightTimer);
        pendingHighlightTimer = null;
      }
      if (highlightedElement) {
        highlightedElement.classList.remove(NAVIGATE_SETTINGS_HIGHLIGHT_CLASS);
        highlightedElement = null;
      }
    };

    const highlightTarget = (target: HTMLElement) => {
      clearTargetHighlight();
      target.classList.remove(NAVIGATE_SETTINGS_HIGHLIGHT_CLASS);
      void target.offsetWidth;
      target.classList.add(NAVIGATE_SETTINGS_HIGHLIGHT_CLASS);
      highlightedElement = target;
      pendingHighlightTimer = setTimeout(() => {
        target.classList.remove(NAVIGATE_SETTINGS_HIGHLIGHT_CLASS);
        if (highlightedElement === target) {
          highlightedElement = null;
        }
        pendingHighlightTimer = null;
      }, NAVIGATE_SETTINGS_HIGHLIGHT_DURATION_MS);
    };

    const scheduleScrollToTarget = (targetId: string) => {
      let attempts = 0;

      const tryScroll = () => {
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          highlightTarget(target);
          return;
        }

        attempts += 1;
        if (attempts < NAVIGATE_SETTINGS_SCROLL_RETRIES) {
          pendingScrollTimer = setTimeout(tryScroll, 80);
        }
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(tryScroll);
      });
    };

    const handleNavigateSettings = (event: Event) => {
      const detail = (event as CustomEvent<NavigateSettingsDetail>).detail;
      const section =
        typeof detail === "string" ? detail : (detail?.section ?? null);

      if (section && isSectionVisibleInLaunch(section, settings)) {
        setCurrentSection(section);
        if (typeof detail === "object" && detail?.scrollToId) {
          scheduleScrollToTarget(detail.scrollToId);
        }
      }
    };

    window.addEventListener(NAVIGATE_SETTINGS_EVENT, handleNavigateSettings);
    return () => {
      if (pendingScrollTimer) {
        clearTimeout(pendingScrollTimer);
      }
      clearTargetHighlight();
      window.removeEventListener(
        NAVIGATE_SETTINGS_EVENT,
        handleNavigateSettings,
      );
    };
  }, [settings, setCurrentSection]);

  const openUpgradePlans = useCallback(() => {
    setPlansOpen(true);
  }, []);

  const closeUpgradePlans = useCallback(() => {
    setPlansOpen(false);
  }, []);

  const handleUpgradeCheckout = useCallback(
    async (selection: BillingCheckoutRequest) => {
      const loadingKey = `${selection.plan ?? "default"}:${selection.interval ?? "monthly"}`;
      setCheckoutLoadingKey(loadingKey);
      try {
        const url = await handleStartCheckout(selection);
        if (url) {
          await openUrl(url);
        }
        setPlansOpen(false);
      } finally {
        setCheckoutLoadingKey(null);
      }
    },
    [handleStartCheckout],
  );

  const updateTeamWorkspace = useCallback(
    (
      updater:
        | TeamWorkspace
        | null
        | ((current: TeamWorkspace | null) => TeamWorkspace | null),
    ) => {
      setTeamWorkspace((current) =>
        typeof updater === "function"
          ? (
              updater as (current: TeamWorkspace | null) => TeamWorkspace | null
            )(current)
          : updater,
      );
    },
    [],
  );

  return (
    <PlanContext.Provider
      value={{
        currentPlan,
        capabilities,
        teamWorkspace,
        updateTeamWorkspace,
        isBasicTier,
        isTrialing,
        trialEndsAt,
        quota: session?.subscription?.quota ?? null,
        onStartCheckout: handleStartCheckout,
        openUpgradePlans,
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
                  "Activation du compte en arriere-plan. Vous pouvez deja entrer dans Vocalype.",
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
            className={`app-main${isSectionFullBleed(currentSection) ? " app-main--full-bleed" : ""}`}
            style={
              isSectionFullBleed(currentSection)
                ? {}
                : {
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
                  }
            }
          >
            {isSectionFullBleed(currentSection) ? (
              <div className="app-main-inner app-main-inner--full-bleed">
                {renderSettingsContent(currentSection, settings)}
              </div>
            ) : (
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

                {showFirstLaunchHint ? (
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
                ) : null}

                {renderSettingsContent(currentSection, settings)}
              </div>
            )}
          </main>
        </div>
        <UpgradePlansModal
          open={plansOpen}
          onClose={closeUpgradePlans}
          onCheckout={handleUpgradeCheckout}
          loadingKey={checkoutLoadingKey}
        />
      </div>
    </PlanContext.Provider>
  );
}

export default DesktopAppShell;

import React, {
  useMemo,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import VocalypeLogo from "./icons/VocalypeLogo";
import { MachineStatusBar } from "./MachineStatusBar";
import { useSettings } from "../hooks/useSettings";
import { usePlan } from "@/lib/subscription/context";
import { SECTIONS_CONFIG } from "./sections-config";
import { commands } from "@/bindings";
import { listen } from "@tauri-apps/api/event";

const BOTTOM_SECTION_IDS = new Set(["billing", "debug"]);
const TRIAL_CARD_DISMISSED_KEY = "vt.trialCardDismissed";

interface SidebarProps {
  activeSection: import("./sections-config").SidebarSection;
  onSectionChange: (
    section: import("./sections-config").SidebarSection,
  ) => void;
  collapsed?: boolean;
  layoutTier?: "compact" | "cozy" | "spacious";
}

function useTrialBadge(trialEndsAt: string | null) {
  if (!trialEndsAt) return null;
  const days = Math.max(
    0,
    Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000),
  );
  if (days >= 8) return { days, urgency: "neutral" as const };
  if (days >= 3) return { days, urgency: "warning" as const };
  return { days, urgency: "urgent" as const };
}

function useSidebarCounts(settings: unknown) {
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [meetingsCount, setMeetingsCount] = useState<number | null>(null);

  // Post-processing actions count — from settings (synchronous)
  const actionsCount = useMemo(() => {
    if (
      typeof settings === "object" &&
      settings !== null &&
      "post_process_actions" in settings &&
      Array.isArray((settings as Record<string, unknown>).post_process_actions)
    ) {
      return (
        (settings as Record<string, unknown>).post_process_actions as unknown[]
      ).length;
    }
    return null;
  }, [settings]);

  // Use refs so the event callbacks always call the latest setter
  // without needing to re-register listeners on every render
  const setHistoryRef = useRef(setHistoryCount);
  const setMeetingsRef = useRef(setMeetingsCount);
  setHistoryRef.current = setHistoryCount;
  setMeetingsRef.current = setMeetingsCount;

  const refreshHistory = useCallback(() => {
    commands
      .getHistoryStats()
      .then((res) => {
        if (res.status === "ok") setHistoryRef.current(res.data.total_entries);
      })
      .catch((err: unknown) => {
        console.error("[Sidebar] getHistoryStats failed:", err);
      });
  }, []);

  const refreshMeetings = useCallback(() => {
    commands
      .getMeetings()
      .then((res) => {
        if (res.status === "ok") setMeetingsRef.current(res.data.length);
      })
      .catch((err: unknown) => {
        console.error("[Sidebar] getMeetings failed:", err);
      });
  }, []);

  useEffect(() => {
    refreshHistory();
    refreshMeetings();

    // History — driven by Tauri backend event (already reliable)
    const unlisteners: Array<() => void> = [];
    listen("history-updated", refreshHistory)
      .then((fn) => unlisteners.push(fn))
      .catch((err: unknown) => {
        console.error(
          "[Sidebar] Failed to register history-updated listener:",
          err,
        );
      });

    // Meetings — driven by window CustomEvent dispatched from MeetingsSettings
    // (synchronous, no async timing issue unlike Tauri listen)
    const handleMeetingsCount = (e: Event) => {
      const count = (e as CustomEvent<number>).detail;
      setMeetingsRef.current(count);
    };
    window.addEventListener("vocalype:meetings-count", handleMeetingsCount);

    return () => {
      unlisteners.forEach((fn) => fn());
      window.removeEventListener(
        "vocalype:meetings-count",
        handleMeetingsCount,
      );
    };
  }, [refreshHistory, refreshMeetings]);

  return { historyCount, meetingsCount, actionsCount };
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
  collapsed = false,
  layoutTier = "spacious",
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { isTrialing, trialEndsAt, openUpgradePlans, capabilities } = usePlan();
  const trialBadge = useTrialBadge(isTrialing ? trialEndsAt : null);
  const [isTrialCardDismissed, setIsTrialCardDismissed] = useState(
    () => localStorage.getItem(TRIAL_CARD_DISMISSED_KEY) === "1",
  );
  const { historyCount, meetingsCount, actionsCount } =
    useSidebarCounts(settings);

  useEffect(() => {
    if (!isTrialing) {
      localStorage.removeItem(TRIAL_CARD_DISMISSED_KEY);
      setIsTrialCardDismissed(false);
    }
  }, [isTrialing]);

  const sectionCounts: Partial<
    Record<import("./sections-config").SidebarSection, number>
  > = useMemo(
    () => ({
      ...(historyCount != null && historyCount > 0
        ? { history: historyCount }
        : {}),
      ...(meetingsCount != null && meetingsCount > 0
        ? { meetings: meetingsCount }
        : {}),
      ...(actionsCount != null && actionsCount > 0
        ? { postprocessing: actionsCount }
        : {}),
    }),
    [historyCount, meetingsCount, actionsCount],
  );

  const allSections = useMemo(
    () =>
      Object.entries(SECTIONS_CONFIG)
        .filter(([id, config]) => {
          if (id === "workspace" && capabilities.plan !== "small_agency") {
            return false;
          }
          return config.enabled(settings);
        })
        .map(([id, config]) => ({
          id: id as import("./sections-config").SidebarSection,
          ...config,
        })),
    [capabilities.plan, settings],
  );

  const mainSections = useMemo(
    () => allSections.filter((s) => !BOTTOM_SECTION_IDS.has(s.id)),
    [allSections],
  );
  const bottomSections = useMemo(
    () => allSections.filter((s) => BOTTOM_SECTION_IDS.has(s.id)),
    [allSections],
  );
  const isCompact = layoutTier === "compact";
  const isCozy = layoutTier === "cozy";
  const expandedWidth = isCompact ? 222 : isCozy ? 236 : 250;
  const collapsedWidth = isCompact ? 60 : 66;
  const navPaddingX = isCompact ? 14 : 16;
  const itemGap = isCompact ? 10 : 11;
  const itemFontSize = isCompact ? 13 : 14;
  const bottomFontSize = isCompact ? 12 : 14;
  const premiumCopy =
    trialBadge?.urgency === "neutral"
      ? t("trial.badge.neutral", { count: trialBadge.days })
      : trialBadge?.urgency === "warning"
        ? t("trial.badge.warning", { count: trialBadge.days })
        : trialBadge?.days === 0
          ? t("trial.badge.today")
          : trialBadge
            ? t("trial.badge.urgent", { count: trialBadge.days })
            : null;
  const premiumTone =
    trialBadge?.urgency === "neutral"
      ? {
          border: "rgba(201,168,76,0.26)",
          glow: "rgba(201,168,76,0.20)",
          chipBg: "rgba(201,168,76,0.15)",
          chipColor: "rgba(255,232,182,0.92)",
          ctaBg: "rgba(255,255,255,0.05)",
          ctaBorder: "rgba(255,255,255,0.08)",
        }
      : trialBadge?.urgency === "warning"
        ? {
            border: "rgba(251,146,60,0.28)",
            glow: "rgba(251,146,60,0.18)",
            chipBg: "rgba(251,146,60,0.15)",
            chipColor: "rgba(255,214,170,0.94)",
            ctaBg: "rgba(255,255,255,0.05)",
            ctaBorder: "rgba(255,255,255,0.08)",
          }
        : {
            border: "rgba(248,113,113,0.28)",
            glow: "rgba(248,113,113,0.18)",
            chipBg: "rgba(248,113,113,0.14)",
            chipColor: "rgba(255,214,214,0.95)",
            ctaBg: "rgba(255,255,255,0.05)",
            ctaBorder: "rgba(255,255,255,0.08)",
          };

  return (
    <nav
      aria-label={t("a11y.settingsNav")}
      style={{
        width: collapsed ? collapsedWidth : expandedWidth,
        flexShrink: 0,
        height: "100%",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top, rgba(201,168,76,0.08), transparent 34%), linear-gradient(180deg, #0b0b12 0%, #06060a 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: collapsed ? 22 : 24,
        boxShadow:
          "0 18px 40px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.03)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease, border-radius 0.2s ease",
      }}
    >
      {!collapsed && (
        <div
          style={{ padding: isCompact ? "18px 14px 10px" : "20px 16px 12px" }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 18,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))",
              padding: isCompact ? "12px" : "14px",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 26px rgba(0,0,0,0.16)",
            }}
          >
            <div className="flex items-center gap-[12px] min-w-0">
              <div
                style={{
                  width: isCompact ? 36 : 40,
                  height: isCompact ? 36 : 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src="/icon128.png"
                  alt="Vocalype"
                  width={isCompact ? 36 : 40}
                  height={isCompact ? 36 : 40}
                  className="shrink-0"
                />
              </div>
              <div className="min-w-0">
                <VocalypeLogo width={isCompact ? 104 : 112} />
                <p
                  style={{
                    marginTop: 5,
                    fontSize: 11,
                    lineHeight: "16px",
                    color: "rgba(255,255,255,0.48)",
                  }}
                >
                  {t("shell.workspaceSubtitle")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!collapsed && trialBadge && !isTrialCardDismissed ? (
        <div
          className="mx-4 mb-3 text-left"
          style={{
            position: "relative",
            borderRadius: 18,
            border: `1px solid ${premiumTone.border}`,
            background:
              trialBadge.urgency === "neutral"
                ? "linear-gradient(180deg, rgba(51,37,14,0.88), rgba(24,18,10,0.96))"
                : trialBadge.urgency === "warning"
                  ? "linear-gradient(180deg, rgba(59,31,10,0.88), rgba(26,18,10,0.96))"
                  : "linear-gradient(180deg, rgba(56,18,18,0.88), rgba(24,10,10,0.96))",
            padding: isCompact ? "12px" : "12px 13px",
            boxShadow: `0 14px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px ${premiumTone.glow}`,
          }}
        >
          <button
            type="button"
            aria-label="Masquer l'encart Premium"
            onClick={() => {
              localStorage.setItem(TRIAL_CARD_DISMISSED_KEY, "1");
              setIsTrialCardDismissed(true);
            }}
            className="trial-card-close-btn"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 24,
              height: 24,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.48)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={12} strokeWidth={2.2} />
          </button>
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  padding: "4px 8px",
                  background: premiumTone.chipBg,
                  color: premiumTone.chipColor,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {t("trial.premiumBadge")}
              </div>
              <p
                style={{
                  marginTop: 8,
                  fontSize: 12.5,
                  lineHeight: "17px",
                  fontWeight: 600,
                  color: "rgba(255,248,239,0.96)",
                }}
              >
                {premiumCopy}
              </p>
              <p
                style={{
                  marginTop: 4,
                  fontSize: 10.5,
                  lineHeight: "14px",
                  color: "rgba(255,255,255,0.58)",
                }}
              >
                {t("trial.premiumDesc")}
              </p>
              <button
                type="button"
                onClick={openUpgradePlans}
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 30,
                  borderRadius: 10,
                  border: `1px solid ${premiumTone.ctaBorder}`,
                  background: premiumTone.ctaBg,
                  padding: "0 10px",
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "rgba(255,248,239,0.90)",
                  cursor: "pointer",
                }}
              >
                {t("trial.badge.cta")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="flex flex-1 flex-col overflow-y-auto min-h-0"
        style={{
          paddingTop: isCompact ? 8 : 10,
          paddingBottom: isCompact ? 8 : 10,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {mainSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          const showConfigLabel = !collapsed && section.id === "dictee";
          const showUsageLabel = !collapsed && section.id === "history";
          const showTeamLabel = !collapsed && section.id === "workspace";
          const showSettingsLabel = !collapsed && section.id === "settings";
          const count = sectionCounts[section.id];

          return (
            <React.Fragment key={section.id}>
              {showConfigLabel && (
                <div className="sidebar-section-label">
                  {t("sidebar.group.config")}
                </div>
              )}
              {showUsageLabel && (
                <div
                  className="sidebar-section-label"
                  style={{ paddingTop: 24 }}
                >
                  {t("sidebar.group.usage")}
                </div>
              )}
              {showTeamLabel && (
                <div
                  className="sidebar-section-label"
                  style={{ paddingTop: 24 }}
                >
                  {t("sidebar.group.team")}
                </div>
              )}
              {showSettingsLabel && (
                <div
                  className="sidebar-section-label"
                  style={{ paddingTop: 24 }}
                >
                  {t("sidebar.group.settings")}
                </div>
              )}
              <button
                type="button"
                className="sidebar-nav-btn"
                data-active={isActive ? "true" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: collapsed ? 0 : itemGap,
                  padding: collapsed
                    ? isCompact
                      ? "12px 0"
                      : "13px 0"
                    : `${isCompact ? 10 : 11}px ${navPaddingX}px`,
                  fontSize: itemFontSize,
                  width: "100%",
                  cursor: "pointer",
                  color: isActive
                    ? "rgba(255,255,255,0.97)"
                    : "rgba(255,255,255,0.5)",
                  borderRadius: collapsed ? 8 : "8px",
                  border: isActive
                    ? "1px solid rgba(201,168,76,0.30)"
                    : "1px solid transparent",
                  background: isActive
                    ? "linear-gradient(90deg, rgba(201,168,76,0.22), rgba(201,168,76,0.10))"
                    : "transparent",
                  textAlign: "left",
                  position: "relative",
                  boxShadow: isActive
                    ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.16)"
                    : "none",
                }}
                onClick={() => onSectionChange(section.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={t(section.labelKey)}
                title={t(section.labelKey)}
              >
                {isActive && !collapsed && (
                  <span
                    style={{
                      position: "absolute",
                      left: 7,
                      top: "50%",
                      transform: "translateY(-50%)",
                      height: 18,
                      width: 3,
                      borderRadius: 999,
                      background: "#c9a84c",
                      boxShadow: "0 0 14px rgba(201,168,76,0.45)",
                      pointerEvents: "none",
                    }}
                  />
                )}
                <span
                  style={{
                    display: "flex",
                    width: isCompact ? 17 : 18,
                    height: isCompact ? 17 : 18,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    opacity: isActive ? 0.92 : 0.52,
                    transition: "opacity 0.15s",
                  }}
                >
                  <Icon
                    width={isCompact ? 17 : 18}
                    height={isCompact ? 17 : 18}
                    aria-hidden="true"
                  />
                </span>
                {!collapsed && (
                  <>
                    <span
                      style={{
                        fontSize: isCompact ? 13 : 13.5,
                        fontWeight: isActive ? 600 : 500,
                        lineHeight: "20px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                      title={t(section.labelKey)}
                    >
                      {t(section.labelKey)}
                    </span>
                    {count != null && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: isActive
                            ? "rgba(201,168,76,0.65)"
                            : "rgba(255,255,255,0.22)",
                          fontVariantNumeric: "tabular-nums",
                          flexShrink: 0,
                          lineHeight: "20px",
                        }}
                      >
                        {count > 9999 ? "9999+" : count}
                      </span>
                    )}
                  </>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div
        className="flex flex-col shrink-0"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.07)",
          margin: "8px 8px 0",
          paddingTop: 12,
          paddingBottom: 10,
        }}
      >
        {bottomSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              className="sidebar-nav-btn"
              data-active={isActive ? "true" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : itemGap,
                padding: collapsed
                  ? isCompact
                    ? "11px 0"
                    : "12px 0"
                  : `${isCompact ? 9 : 10}px ${navPaddingX}px`,
                fontSize: bottomFontSize,
                width: "100%",
                cursor: "pointer",
                background: isActive
                  ? "linear-gradient(90deg, rgba(201,168,76,0.16), rgba(201,168,76,0.07))"
                  : "transparent",
                color: isActive
                  ? "rgba(255,255,255,0.90)"
                  : "rgba(255,255,255,0.34)",
                borderRadius: collapsed ? 8 : "8px",
                border: isActive
                  ? "1px solid rgba(201,168,76,0.20)"
                  : "1px solid transparent",
                textAlign: "left",
                position: "relative",
              }}
              onClick={() => onSectionChange(section.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={t(section.labelKey)}
              title={t(section.labelKey)}
            >
              <span
                style={{
                  display: "flex",
                  width: isCompact ? 14 : 15,
                  height: isCompact ? 14 : 15,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  opacity: isActive ? 0.85 : 0.4,
                  transition: "opacity 0.15s",
                }}
              >
                <Icon
                  width={isCompact ? 14 : 15}
                  height={isCompact ? 14 : 15}
                  aria-hidden="true"
                />
              </span>
              {!collapsed && (
                <span
                  style={{
                    fontSize: isCompact ? 12 : 12.5,
                    fontWeight: isActive ? 500 : 400,
                    lineHeight: "20px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t(section.labelKey)}
                </span>
              )}
            </button>
          );
        })}

        {import.meta.env.DEV && !collapsed && (
          <div style={{ padding: "10px 8px 2px" }}>
            <MachineStatusBar variant="sidebar" />
          </div>
        )}
      </div>
    </nav>
  );
};

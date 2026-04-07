import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import VocalypeLogo from "./icons/VocalypeLogo";
import { MachineStatusBar } from "./MachineStatusBar";
import { useSettings } from "../hooks/useSettings";
import { usePlan } from "@/lib/subscription/context";
import { SECTIONS_CONFIG } from "./sections-config";

const BOTTOM_SECTION_IDS = new Set(["billing", "referral", "about", "debug"]);

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

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
  collapsed = false,
  layoutTier = "spacious",
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { isTrialing, trialEndsAt, onStartCheckout } = usePlan();
  const trialBadge = useTrialBadge(isTrialing ? trialEndsAt : null);

  const allSections = useMemo(
    () =>
      Object.entries(SECTIONS_CONFIG)
        .filter(([_, config]) => config.enabled(settings))
        .map(([id, config]) => ({
          id: id as import("./sections-config").SidebarSection,
          ...config,
        })),
    [settings],
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

  return (
    <nav
      aria-label={t("a11y.settingsNav")}
      style={{
        width: collapsed ? collapsedWidth : expandedWidth,
        flexShrink: 0,
        height: "100%",
        overflow: "hidden",
        background:
          "linear-gradient(180deg, rgba(16,16,16,0.98), rgba(10,10,10,0.96))",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: collapsed ? 22 : 24,
        boxShadow: "0 14px 30px rgba(0,0,0,0.24)",
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
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 16,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018))",
              padding: isCompact ? "11px" : "12px",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <div className="flex items-center gap-[12px] min-w-0">
              <div
                style={{
                    width: isCompact ? 36 : 40,
                    height: isCompact ? 36 : 40,
                    borderRadius: 11,
                  background:
                    "linear-gradient(180deg, rgba(201,168,76,0.28), rgba(201,168,76,0.16))",
                  border: "1px solid rgba(201,168,76,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 10px 20px rgba(0,0,0,0.18)",
                }}
              >
                <img
                  src="/icon128.png"
                  alt="Vocalype"
                    width={isCompact ? 20 : 22}
                    height={isCompact ? 20 : 22}
                  className="shrink-0 rounded-[7px]"
                />
              </div>
              <div className="min-w-0">
                <VocalypeLogo width={isCompact ? 104 : 112} />
                <p
                  style={{
                    marginTop: 3,
                    fontSize: 11,
                    lineHeight: "16px",
                    color: "rgba(255,255,255,0.42)",
                  }}
                >
                  {t("shell.workspaceSubtitle")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!collapsed && trialBadge ? (
        <button
          type="button"
          onClick={() =>
            onStartCheckout()
              .then((url) => url && window.open(url, "_blank"))
              .catch(() => {})
          }
          className={`mx-4 mb-2 rounded-[16px] border px-[16px] py-3 text-left transition-opacity hover:opacity-90 ${
            trialBadge.urgency === "neutral"
              ? "border-logo-primary/15 bg-logo-primary/8"
              : trialBadge.urgency === "warning"
                ? "border-orange-500/20 bg-orange-500/10"
                : "border-red-500/20 bg-red-500/10"
          }`}
        >
          <p
            className={`text-[11px] font-medium leading-tight tracking-[0.01em] ${
              trialBadge.urgency === "neutral"
                ? "text-logo-primary"
                : trialBadge.urgency === "warning"
                  ? "text-orange-400"
                  : "text-red-400"
            }`}
          >
            {trialBadge.urgency === "neutral" &&
              t("trial.badge.neutral", { count: trialBadge.days })}
            {trialBadge.urgency === "warning" &&
              t("trial.badge.warning", { count: trialBadge.days })}
            {trialBadge.urgency === "urgent" &&
              (trialBadge.days === 0
                ? t("trial.badge.today")
                : t("trial.badge.urgent", { count: trialBadge.days }))}
          </p>
          <p className="mt-1.5 text-[11px] text-white/42">
            {t("trial.badge.cta")}
          </p>
        </button>
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
          const showConfigLabel = !collapsed && section.id === "general";
          const showUsageLabel = !collapsed && section.id === "history";
          const showAdvancedLabel = !collapsed && section.id === "advanced";

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
              {showAdvancedLabel && (
                <div
                  className="sidebar-section-label"
                  style={{ paddingTop: 24 }}
                >
                  {t("sidebar.group.advanced")}
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
                  borderRadius: collapsed ? 14 : "14px",
                  border: isActive
                    ? "1px solid rgba(201,168,76,0.16)"
                    : "1px solid transparent",
                  background: isActive
                    ? "linear-gradient(180deg, rgba(201,168,76,0.18), rgba(201,168,76,0.09))"
                    : "transparent",
                  textAlign: "left",
                  position: "relative",
                  boxShadow: isActive
                    ? "inset 0 1px 0 rgba(255,255,255,0.06)"
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
                      left: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      height: 18,
                      width: 3,
                      borderRadius: 999,
                      background: "#f0d080",
                      boxShadow: "0 0 18px rgba(201,168,76,0.32)",
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
                  <span
                    style={{
                      fontSize: isCompact ? 13 : 13.5,
                      fontWeight: isActive ? 600 : 500,
                      lineHeight: "20px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={t(section.labelKey)}
                  >
                    {t(section.labelKey)}
                  </span>
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
          margin: "4px 8px 0",
          paddingTop: 10,
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
                background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                color: isActive
                  ? "rgba(255,255,255,0.90)"
                  : "rgba(255,255,255,0.34)",
                borderRadius: collapsed ? 14 : "12px",
                border: "1px solid transparent",
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

        {!collapsed && (
          <div style={{ padding: "10px 8px 2px" }}>
            <MachineStatusBar variant="sidebar" />
          </div>
        )}
      </div>
    </nav>
  );
};

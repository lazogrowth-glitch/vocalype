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
  const expandedWidth = isCompact ? 204 : isCozy ? 214 : 224;
  const collapsedWidth = isCompact ? 52 : 56;
  const navPaddingX = isCompact ? 14 : 16;
  const itemGap = isCompact ? 8 : 10;
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
        background: "#141414",
        borderRight: "none",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease",
      }}
    >
      {!collapsed && (
        <div
          style={{ padding: isCompact ? "24px 14px 14px" : "32px 16px 16px" }}
        >
          <div className="flex items-center gap-[10px] min-w-0">
            <img
              src="/icon128.png"
              alt="Vocalype"
              width={isCompact ? 28 : 30}
              height={isCompact ? 28 : 30}
              className="shrink-0 rounded-[7px]"
            />
            <VocalypeLogo width={isCompact ? 105 : 115} />
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
          className={`w-full border-b px-[18px] py-2.5 text-left transition-opacity hover:opacity-80 ${
            trialBadge.urgency === "neutral"
              ? "border-logo-primary/15 bg-logo-primary/8"
              : trialBadge.urgency === "warning"
                ? "border-orange-500/20 bg-orange-500/10"
                : "border-red-500/20 bg-red-500/10"
          }`}
        >
          <p
            className={`text-[11px] font-medium leading-tight ${
              trialBadge.urgency === "neutral"
                ? "text-logo-primary"
                : trialBadge.urgency === "warning"
                  ? "text-orange-400"
                  : "text-red-400"
            }`}
          >
            {trialBadge.urgency === "neutral" &&
              t("trial.badge.neutral", {
                count: trialBadge.days,
                defaultValue: "Trial Premium · {{count}}j restants",
              })}
            {trialBadge.urgency === "warning" &&
              t("trial.badge.warning", {
                count: trialBadge.days,
                defaultValue: "Plus que {{count}} jours de Premium",
              })}
            {trialBadge.urgency === "urgent" &&
              (trialBadge.days === 0
                ? t("trial.badge.today", {
                    defaultValue: "Expire aujourd'hui",
                  })
                : t("trial.badge.urgent", {
                    count: trialBadge.days,
                    defaultValue: "Expire dans {{count}} jours",
                  }))}
          </p>
          <p className="mt-1 text-[11px] text-white/42">
            {t("trial.badge.cta", { defaultValue: "Passer à Premium" })}
          </p>
        </button>
      ) : null}

      {/* Main nav */}
      <div
        className="flex flex-1 flex-col overflow-y-auto min-h-0"
        style={{
          paddingTop: isCompact ? 6 : 8,
          paddingBottom: isCompact ? 6 : 8,
        }}
      >
        {mainSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          // Séparateur entre Config (snippets) et Utilisation (history)
          const showDivider = !collapsed && section.id === "history";

          return (
            <React.Fragment key={section.id}>
              {showDivider && (
                <div
                  style={{
                    margin: `6px ${navPaddingX}px`,
                    height: "0.5px",
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
              )}
              <button
                key={`btn-${section.id}`}
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: collapsed ? 0 : itemGap,
                  padding: collapsed
                    ? isCompact
                      ? "10px 0"
                      : "12px 0"
                    : `${isCompact ? 9 : 10}px ${navPaddingX}px`,
                  fontSize: itemFontSize,
                  width: "100%",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  borderRight: isActive
                    ? "2px solid #c9a84c"
                    : "2px solid transparent",
                  background: isActive
                    ? "rgba(201,168,76,0.10)"
                    : "transparent",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.55)",
                  borderRadius: collapsed ? 0 : "0px",
                }}
                onClick={() => onSectionChange(section.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={t(section.labelKey)}
                title={t(section.labelKey)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
                    isActive ? "text-white" : "text-current"
                  }`}
                >
                  <Icon
                    width={isCompact ? 15 : 16}
                    height={isCompact ? 15 : 16}
                    className="shrink-0 opacity-70"
                    aria-hidden="true"
                  />
                </span>
                {!collapsed && (
                  <span
                    className="truncate font-normal leading-5"
                    style={{ fontSize: isCompact ? 13 : 13.5 }}
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

      {/* Bottom sections — Facturation, Parrainage, À propos */}
      <div
        className="flex flex-col shrink-0"
        style={{
          borderTop: "0.5px solid rgba(255,255,255,0.08)",
          paddingTop: 6,
          paddingBottom: 6,
        }}
      >
        {bottomSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : itemGap,
                padding: collapsed
                  ? isCompact
                    ? "9px 0"
                    : "10px 0"
                  : `${isCompact ? 8 : 9}px ${navPaddingX}px`,
                fontSize: bottomFontSize,
                width: "100%",
                cursor: "pointer",
                transition: "all 0.15s",
                borderRight: isActive
                  ? "2px solid #c9a84c"
                  : "2px solid transparent",
                background: isActive ? "rgba(201,168,76,0.10)" : "transparent",
                color: isActive ? "#fff" : "rgba(255,255,255,0.38)",
              }}
              onClick={() => onSectionChange(section.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={t(section.labelKey)}
              title={t(section.labelKey)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <Icon
                  width={isCompact ? 14 : 15}
                  height={isCompact ? 14 : 15}
                  className="shrink-0 opacity-60"
                  aria-hidden="true"
                />
              </span>
              {!collapsed && (
                <span
                  className="truncate font-normal leading-5"
                  style={{ fontSize: isCompact ? 12 : 12.5 }}
                >
                  {t(section.labelKey)}
                </span>
              )}
            </button>
          );
        })}

        {/* Status bar */}
        {!collapsed && (
          <div style={{ padding: "6px 16px 2px" }}>
            <MachineStatusBar variant="sidebar" />
          </div>
        )}
      </div>
    </nav>
  );
};

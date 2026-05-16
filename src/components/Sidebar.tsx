import React, { useMemo, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, LogOut, X } from "lucide-react";
import type { AuthSession } from "@/lib/auth/types";
import VocalypeLogo from "./icons/VocalypeLogo";
import { MachineStatusBar } from "./MachineStatusBar";
import { useSettings } from "../hooks/useSettings";
import { usePlan } from "@/lib/subscription/context";
import { SECTIONS_CONFIG } from "./sections-config";

const HIDDEN_SECTION_IDS = new Set(["debug", "billing"]);
const TRIAL_CARD_DISMISSED_KEY = "vt.trialCardDismissed";

interface SidebarProps {
  activeSection: import("./sections-config").SidebarSection;
  onSectionChange: (
    section: import("./sections-config").SidebarSection,
  ) => void;
  collapsed?: boolean;
  layoutTier?: "compact" | "cozy" | "spacious";
  session?: AuthSession | null;
  onLogout?: () => void;
  onOpenBillingPortal?: () => void;
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

const userMenuBtnStyle = (danger: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  padding: "9px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: danger ? "rgba(255,80,80,0.88)" : "rgba(255,255,255,0.72)",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 8,
  cursor: "pointer",
  textAlign: "left",
  transition: "background 0.12s, color 0.12s, border-color 0.12s",
  fontFamily: "inherit",
});

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
  collapsed = false,
  layoutTier = "spacious",
  session,
  onLogout,
  onOpenBillingPortal,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { isTrialing, trialEndsAt, openUpgradePlans, capabilities } = usePlan();
  const trialBadge = useTrialBadge(isTrialing ? trialEndsAt : null);
  const [isTrialCardDismissed, setIsTrialCardDismissed] = useState(
    () => localStorage.getItem(TRIAL_CARD_DISMISSED_KEY) === "1",
  );
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUserMenu]);
  useEffect(() => {
    if (!isTrialing) {
      localStorage.removeItem(TRIAL_CARD_DISMISSED_KEY);
      setIsTrialCardDismissed(false);
    }
  }, [isTrialing]);

  const allSections = useMemo(
    () =>
      Object.entries(SECTIONS_CONFIG)
        .filter(([id, config]) => {
          if (id === "workspace" && capabilities.plan !== "small_agency") {
            return false;
          }
          if (HIDDEN_SECTION_IDS.has(id)) {
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

  const mainSections = useMemo(() => allSections, [allSections]);
  const isCompact = layoutTier === "compact";
  const isCozy = layoutTier === "cozy";
  const expandedWidth = isCompact ? 222 : isCozy ? 236 : 250;
  const collapsedWidth = isCompact ? 60 : 66;
  const navPaddingX = isCompact ? 14 : 16;
  const itemGap = isCompact ? 10 : 11;
  const itemFontSize = isCompact ? 13 : 14;
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
          style={{ padding: isCompact ? "18px 14px 14px" : "20px 16px 16px" }}
        >
          <div className="flex items-center gap-[12px] min-w-0">
            <div
              style={{
                width: isCompact ? 44 : 48,
                height: isCompact ? 44 : 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src="/icon128.png"
                alt="Vocalype"
                width={isCompact ? 44 : 48}
                height={isCompact ? 44 : 48}
                className="shrink-0"
              />
            </div>
            <div className="min-w-0">
              <VocalypeLogo width={isCompact ? 118 : 128} />
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
                {t("basic.premiumBadge")}
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
                {t("basic.premiumDesc")}
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
          paddingTop: isCompact ? 20 : 24,
          paddingBottom: isCompact ? 8 : 10,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {mainSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          const showDivider =
            !collapsed &&
            (section.id === "history" ||
              section.id === "workspace" ||
              section.id === "settings");

          return (
            <React.Fragment key={section.id}>
              {showDivider && (
                <div
                  style={{
                    height: 1,
                    background: "rgba(255,255,255,0.05)",
                    margin: "8px 4px",
                  }}
                />
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
                      ? "15px 0"
                      : "16px 0"
                    : `${isCompact ? 13 : 15}px ${navPaddingX}px`,
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
                  </>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {import.meta.env.DEV && !collapsed && (
        <div style={{ padding: "0 16px 10px" }}>
          <MachineStatusBar variant="sidebar" />
        </div>
      )}

      {session && !collapsed && (
        <div
          ref={userMenuRef}
          style={{
            position: "relative",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 8px 10px",
          }}
        >
          {showUserMenu && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                left: 8,
                right: 8,
                background: "linear-gradient(180deg,#1b1b1e,#131316)",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 10,
                boxShadow: "0 -8px 24px rgba(0,0,0,0.38)",
                padding: 6,
                zIndex: 9999,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  onSectionChange("billing");
                  setShowUserMenu(false);
                }}
                style={userMenuBtnStyle(false)}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.background =
                    "linear-gradient(90deg, rgba(201,168,76,0.18), rgba(201,168,76,0.08))";
                  b.style.color = "rgba(255,255,255,0.97)";
                  b.style.borderColor = "rgba(201,168,76,0.22)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.background = "transparent";
                  b.style.color = "rgba(255,255,255,0.72)";
                  b.style.borderColor = "transparent";
                }}
              >
                <CreditCard size={13} style={{ opacity: 0.55 }} />
                {t("sidebar.billing")}
              </button>
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    setShowUserMenu(false);
                  }}
                  style={userMenuBtnStyle(true)}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.background = "rgba(255,80,80,0.10)";
                    b.style.color = "rgba(255,80,80,1)";
                    b.style.borderColor = "rgba(255,80,80,0.16)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.background = "transparent";
                    b.style.color = "rgba(255,80,80,0.88)";
                    b.style.borderColor = "transparent";
                  }}
                >
                  <LogOut size={13} style={{ opacity: 0.7 }} />
                  {t("auth.logout")}
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowUserMenu((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 9,
              border: showUserMenu
                ? "1px solid rgba(201,168,76,0.30)"
                : "1px solid transparent",
              background: showUserMenu
                ? "linear-gradient(90deg, rgba(201,168,76,0.22), rgba(201,168,76,0.10))"
                : "transparent",
              boxShadow: showUserMenu
                ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.16)"
                : "none",
              cursor: "pointer",
              textAlign: "left",
              position: "relative",
              transition:
                "background 0.12s, border-color 0.12s, box-shadow 0.12s",
            }}
            onMouseEnter={(e) => {
              if (showUserMenu) return;
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(255,255,255,0.04)";
            }}
            onMouseLeave={(e) => {
              if (showUserMenu) return;
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "transparent";
            }}
          >
            {showUserMenu && (
              <span
                style={{
                  position: "absolute",
                  left: 2,
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
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #c9a84c, #a07830)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {(session.user.name ??
                session.user.email ??
                "?")[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              {session.user.name && (
                <p
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.88)",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    lineHeight: "16px",
                  }}
                >
                  {session.user.name}
                </p>
              )}
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.38)",
                  margin: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: "15px",
                }}
              >
                {session.user.email}
              </p>
            </div>
          </button>
        </div>
      )}
    </nav>
  );
};

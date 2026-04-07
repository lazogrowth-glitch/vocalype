import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CreditCard,
  LogOut,
  Minus,
  PanelLeft,
  Square,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthSession } from "@/lib/auth/types";

interface TitleBarProps {
  sidebarCollapsed?: boolean;
  layoutTier?: "compact" | "cozy" | "spacious";
  onToggleSidebar?: () => void;
  session?: AuthSession | null;
  isTrialing?: boolean;
  trialEndsAt?: string | null;
  onLogout?: () => void;
  onOpenBillingPortal?: () => void;
}

export const TitleBar = ({
  sidebarCollapsed,
  layoutTier = "spacious",
  onToggleSidebar,
  session,
  isTrialing,
  trialEndsAt,
  onLogout,
  onOpenBillingPortal,
}: TitleBarProps = {}) => {
  const win = getCurrentWindow();
  const { t } = useTranslation();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAccountMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        accountRef.current &&
        !accountRef.current.contains(e.target as Node)
      ) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAccountMenu]);

  const trialDaysLeft =
    isTrialing && trialEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000,
          ),
        )
      : null;
  const isCompact = layoutTier === "compact";
  const isCozy = layoutTier === "cozy";
  const barHeight = isCompact ? 56 : isCozy ? 60 : 62;
  const menuTop = isCompact ? 54 : 58;

  return (
    <div
      data-tauri-drag-region
      style={
        {
          height: barHeight,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px 8px",
          background: "transparent",
          userSelect: "none",
          WebkitAppRegion: "drag",
          position: "relative",
          zIndex: 9999,
        } as React.CSSProperties
      }
    >
      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 10,
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        {onToggleSidebar !== undefined && (
          <TitleBarBtn
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            active={sidebarCollapsed === false}
          >
            <PanelLeft size={isCompact ? 15 : 16} strokeWidth={1.8} />
          </TitleBarBtn>
        )}

        {session && (
          <div ref={accountRef} style={{ position: "relative" }}>
            <TitleBarBtn
              onClick={() => setShowAccountMenu((v) => !v)}
              aria-label="Account"
              active={showAccountMenu}
            >
              <User size={isCompact ? 14 : 15} strokeWidth={1.8} />
            </TitleBarBtn>

            {showAccountMenu && (
              <div
                style={{
                  position: "fixed",
                  top: menuTop,
                  left: 20,
                  width: 264,
                  background:
                    "linear-gradient(180deg, rgba(27,27,27,0.98), rgba(18,18,18,0.98))",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 16,
                  boxShadow: "0 20px 36px rgba(0,0,0,0.38)",
                  padding: "8px",
                  zIndex: 99999,
                }}
              >
                <div
                  style={{
                    padding: "12px 12px 10px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.025)",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  {session.user.name && (
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                        marginBottom: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {session.user.name}
                    </p>
                  )}
                  <p
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.48)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {session.user.email}
                  </p>
                  <div style={{ marginTop: 10 }}>
                    {isTrialing && trialDaysLeft !== null ? (
                      <span style={pillStyle(true)}>
                        {t("trial.badge.neutral", {
                          count: trialDaysLeft,
                        })}
                      </span>
                    ) : session.subscription?.tier === "premium" ? (
                      <span style={pillStyle(true)}>{t("plan.premium")}</span>
                    ) : (
                      <span style={pillStyle(false)}>{t("plan.basic")}</span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    height: 1,
                    background: "rgba(255,255,255,0.08)",
                    margin: "8px 4px",
                  }}
                />

                {onOpenBillingPortal && (
                  <MenuBtn
                    icon={<CreditCard size={14} />}
                    label={t("auth.manageSubscription")}
                    onClick={() => {
                      void onOpenBillingPortal();
                      setShowAccountMenu(false);
                    }}
                  />
                )}

                {onLogout && (
                  <MenuBtn
                    icon={<LogOut size={14} />}
                    label={t("auth.logout")}
                    onClick={() => {
                      onLogout();
                      setShowAccountMenu(false);
                    }}
                    danger
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: "100%",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        <WinBtn
          onClick={() => win.minimize()}
          hoverBg="rgba(255,255,255,0.1)"
          aria-label="Minimize"
        >
          <Minus size={isCompact ? 10 : 11} strokeWidth={2.5} />
        </WinBtn>
        <WinBtn
          onClick={() => win.toggleMaximize()}
          hoverBg="rgba(255,255,255,0.1)"
          aria-label="Maximize"
        >
          <Square size={isCompact ? 8 : 9} strokeWidth={2.5} />
        </WinBtn>
        <WinBtn
          onClick={() => win.close()}
          hoverBg="rgba(196,43,43,0.85)"
          aria-label="Close"
        >
          <X size={isCompact ? 10 : 11} strokeWidth={2.5} />
        </WinBtn>
      </div>
    </div>
  );
};

const pillStyle = (premium: boolean): React.CSSProperties => ({
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  color: premium ? "#c9a84c" : "rgba(255,255,255,0.54)",
  background: premium ? "rgba(201,168,76,0.14)" : "rgba(255,255,255,0.07)",
  border: premium
    ? "1px solid rgba(201,168,76,0.25)"
    : "1px solid rgba(255,255,255,0.07)",
  borderRadius: 999,
  padding: "4px 9px",
});

const TitleBarBtn = ({
  children,
  onClick,
  "aria-label": ariaLabel,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  "aria-label": string;
  active?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    style={
      {
        width: 34,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active
          ? "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))"
          : "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        color: "rgba(255,255,255,0.7)",
        cursor: "pointer",
        borderRadius: 11,
        transition: "background 0.12s, color 0.12s, border-color 0.12s",
        padding: 0,
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background =
        "rgba(255,255,255,0.1)";
      (e.currentTarget as HTMLButtonElement).style.color = "#fff";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(255,255,255,0.1)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = active
        ? "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))"
        : "rgba(255,255,255,0.03)";
      (e.currentTarget as HTMLButtonElement).style.color =
        "rgba(255,255,255,0.7)";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(255,255,255,0.07)";
    }}
  >
    {children}
  </button>
);

const MenuBtn = ({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={
      {
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "10px 12px",
        fontSize: 13,
        color: danger ? "rgba(255,80,80,0.88)" : "rgba(255,255,255,0.76)",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 12,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.1s, color 0.1s, border-color 0.1s",
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = danger
        ? "rgba(255,80,80,0.1)"
        : "rgba(255,255,255,0.06)";
      (e.currentTarget as HTMLButtonElement).style.color = danger
        ? "rgba(255,80,80,1)"
        : "#fff";
      (e.currentTarget as HTMLButtonElement).style.borderColor = danger
        ? "rgba(255,80,80,0.16)"
        : "rgba(255,255,255,0.06)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      (e.currentTarget as HTMLButtonElement).style.color = danger
        ? "rgba(255,80,80,0.88)"
        : "rgba(255,255,255,0.76)";
      (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
    }}
  >
    {icon}
    {label}
  </button>
);

const WinBtn = ({
  children,
  onClick,
  hoverBg,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  hoverBg: string;
  "aria-label": string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    style={
      {
        width: 36,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        color: "rgba(255,255,255,0.75)",
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s",
        padding: 0,
        borderRadius: 11,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
      (e.currentTarget as HTMLButtonElement).style.color = "#fff";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(255,255,255,0.1)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background =
        "rgba(255,255,255,0.03)";
      (e.currentTarget as HTMLButtonElement).style.color =
        "rgba(255,255,255,0.75)";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(255,255,255,0.07)";
    }}
  >
    {children}
  </button>
);

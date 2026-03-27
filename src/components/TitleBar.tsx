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
  onToggleSidebar?: () => void;
  session?: AuthSession | null;
  isTrialing?: boolean;
  trialEndsAt?: string | null;
  onLogout?: () => void;
  onOpenBillingPortal?: () => void;
}

export const TitleBar = ({
  sidebarCollapsed,
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

  return (
    <div
      data-tauri-drag-region
      style={
        {
          height: 52,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#141414",
          userSelect: "none",
          WebkitAppRegion: "drag",
          position: "relative",
          zIndex: 9999,
        } as React.CSSProperties
      }
    >
      {/* Left: sidebar toggle + account */}
      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 2,
            paddingLeft: 8,
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
            <PanelLeft size={15} strokeWidth={1.8} />
          </TitleBarBtn>
        )}

        {session && (
          <div ref={accountRef} style={{ position: "relative" }}>
            <TitleBarBtn
              onClick={() => setShowAccountMenu((v) => !v)}
              aria-label="Account"
              active={showAccountMenu}
            >
              <User size={15} strokeWidth={1.8} />
            </TitleBarBtn>

            {showAccountMenu && (
              <div
                style={{
                  position: "fixed",
                  top: 44,
                  left: 8,
                  width: 244,
                  background: "#1c1c1c",
                  border: "0.5px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
                  padding: "6px",
                  zIndex: 99999,
                }}
              >
                {/* User info */}
                <div style={{ padding: "10px 12px 10px" }}>
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
                      color: "rgba(255,255,255,0.45)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {session.user.email}
                  </p>
                  <div style={{ marginTop: 8 }}>
                    {isTrialing && trialDaysLeft !== null ? (
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#c9a84c",
                          background: "rgba(201,168,76,0.15)",
                          border: "0.5px solid rgba(201,168,76,0.3)",
                          borderRadius: 5,
                          padding: "2px 8px",
                        }}
                      >
                        {t("trial.badge.neutral", {
                          count: trialDaysLeft,
                          defaultValue: "Trial · {{count}}j restants",
                        })}
                      </span>
                    ) : session.subscription?.tier === "premium" ? (
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#c9a84c",
                          background: "rgba(201,168,76,0.15)",
                          border: "0.5px solid rgba(201,168,76,0.3)",
                          borderRadius: 5,
                          padding: "2px 8px",
                        }}
                      >
                        {t("plan.premium", { defaultValue: "Premium" })}
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "rgba(255,255,255,0.45)",
                          background: "rgba(255,255,255,0.07)",
                          borderRadius: 5,
                          padding: "2px 8px",
                        }}
                      >
                        {t("plan.basic", { defaultValue: "Basique" })}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    height: "0.5px",
                    background: "rgba(255,255,255,0.08)",
                    margin: "2px 0",
                  }}
                />

                {onOpenBillingPortal && (
                  <MenuBtn
                    icon={<CreditCard size={14} />}
                    label={t("billing.manage", {
                      defaultValue: "Gérer l'abonnement",
                    })}
                    onClick={() => {
                      void onOpenBillingPortal();
                      setShowAccountMenu(false);
                    }}
                  />
                )}

                {onLogout && (
                  <MenuBtn
                    icon={<LogOut size={14} />}
                    label={t("auth.logout", {
                      defaultValue: "Se déconnecter",
                    })}
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

      {/* Right: window controls */}
      <div
        style={
          {
            display: "flex",
            alignItems: "center",
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
          <Minus size={11} strokeWidth={2.5} />
        </WinBtn>
        <WinBtn
          onClick={() => win.toggleMaximize()}
          hoverBg="rgba(255,255,255,0.1)"
          aria-label="Maximize"
        >
          <Square size={9} strokeWidth={2.5} />
        </WinBtn>
        <WinBtn
          onClick={() => win.close()}
          hoverBg="rgba(196,43,43,0.85)"
          aria-label="Close"
        >
          <X size={11} strokeWidth={2.5} />
        </WinBtn>
      </div>
    </div>
  );
};

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
        width: 32,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "rgba(255,255,255,0.08)" : "transparent",
        border: "none",
        color: "rgba(255,255,255,0.65)",
        cursor: "pointer",
        borderRadius: 6,
        transition: "background 0.12s, color 0.12s",
        padding: 0,
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background =
        "rgba(255,255,255,0.1)";
      (e.currentTarget as HTMLButtonElement).style.color = "#fff";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = active
        ? "rgba(255,255,255,0.08)"
        : "transparent";
      (e.currentTarget as HTMLButtonElement).style.color =
        "rgba(255,255,255,0.65)";
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
        padding: "8px 12px",
        fontSize: 13,
        color: danger ? "rgba(255,80,80,0.85)" : "rgba(255,255,255,0.75)",
        background: "transparent",
        border: "none",
        borderRadius: 7,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.1s, color 0.1s",
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = danger
        ? "rgba(255,80,80,0.1)"
        : "rgba(255,255,255,0.07)";
      (e.currentTarget as HTMLButtonElement).style.color = danger
        ? "rgba(255,80,80,1)"
        : "#fff";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      (e.currentTarget as HTMLButtonElement).style.color = danger
        ? "rgba(255,80,80,0.85)"
        : "rgba(255,255,255,0.75)";
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
        width: 46,
        height: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        color: "rgba(255,255,255,0.75)",
        cursor: "pointer",
        transition: "background 0.12s",
        padding: 0,
        borderRadius: 0,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
      (e.currentTarget as HTMLButtonElement).style.color = "#fff";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      (e.currentTarget as HTMLButtonElement).style.color =
        "rgba(255,255,255,0.75)";
    }}
  >
    {children}
  </button>
);

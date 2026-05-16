import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AuthSession } from "@/lib/auth/types";
import { Minus, PanelLeft, Square, X } from "lucide-react";

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
}: TitleBarProps = {}) => {
  const win = getCurrentWindow();
  const isCompact = layoutTier === "compact";
  const isCozy = layoutTier === "cozy";
  const barHeight = isCompact ? 56 : isCozy ? 60 : 62;

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
        background: active ? "rgba(212,168,88,0.14)" : "#1c1c22",
        border: active
          ? "1px solid rgba(201,168,76,0.25)"
          : "1px solid rgba(255,255,255,0.1)",
        color: active ? "#c9a84c" : "rgba(255,255,255,0.78)",
        cursor: "pointer",
        borderRadius: 11,
        transition: "background 0.12s, color 0.12s, border-color 0.12s",
        padding: 0,
      } as React.CSSProperties
    }
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = "#24242c";
      (e.currentTarget as HTMLButtonElement).style.color = "#fff";
      (e.currentTarget as HTMLButtonElement).style.borderColor =
        "rgba(255,255,255,0.15)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.background = active
        ? "rgba(212,168,88,0.14)"
        : "#1c1c22";
      (e.currentTarget as HTMLButtonElement).style.color = active
        ? "#c9a84c"
        : "rgba(255,255,255,0.78)";
      (e.currentTarget as HTMLButtonElement).style.borderColor = active
        ? "rgba(201,168,76,0.25)"
        : "rgba(255,255,255,0.1)";
    }}
  >
    {children}
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

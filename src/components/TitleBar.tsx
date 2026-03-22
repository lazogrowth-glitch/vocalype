import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import VocalTypeLogo from "./icons/VocalTypeLogo";

export const TitleBar = () => {
  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      style={
        {
          height: 38,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 14,
          background: "transparent",
          userSelect: "none",
          WebkitAppRegion: "drag",
          position: "relative",
          zIndex: 9999,
        } as React.CSSProperties
      }
    >
      <div
        style={{ display: "flex", alignItems: "center", pointerEvents: "none" }}
      >
        <VocalTypeLogo width={76} />
      </div>
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

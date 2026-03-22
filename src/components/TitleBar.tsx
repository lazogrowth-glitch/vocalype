import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export const TitleBar = () => {
  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      style={
        {
          height: 36,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: 4,
          background: "transparent",
          userSelect: "none",
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        <button
          type="button"
          onClick={() => win.minimize()}
          style={btnStyle}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255,255,255,0.08)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "transparent")
          }
          aria-label="Minimize"
        >
          <Minus size={12} strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={() => win.toggleMaximize()}
          style={btnStyle}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255,255,255,0.08)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "transparent")
          }
          aria-label="Maximize"
        >
          <Square size={10} strokeWidth={2} />
        </button>

        <button
          type="button"
          onClick={() => win.close()}
          style={btnStyle}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "rgba(220,50,50,0.75)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "transparent")
          }
          aria-label="Close"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  width: 40,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "rgba(255,255,255,0.5)",
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s",
  borderRadius: 0,
  padding: 0,
};

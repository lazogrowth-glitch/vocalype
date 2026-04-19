import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "./Tooltip";

interface SettingContainerProps {
  title: React.ReactNode;
  description: string;
  children: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "tooltip",
  layout = "horizontal",
  disabled = false,
  tooltipPosition = "top",
}) => {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node)
      ) {
        setShowTooltip(false);
      }
    };

    if (!showTooltip) return;

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTooltip]);

  const infoButton = (
    <div
      ref={tooltipRef}
      className="relative shrink-0"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setShowTooltip((current) => !current)}
    >
      <button
        type="button"
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.025] text-[10px] font-medium text-white/34 transition-colors hover:border-logo-primary/32 hover:bg-logo-primary/10 hover:text-logo-primary"
        aria-label={t("common.moreInformation", {
          defaultValue: "More information",
        })}
      >
        {t("common.infoGlyph", { defaultValue: "i" })}
      </button>
      {showTooltip && (
        <Tooltip targetRef={tooltipRef} position={tooltipPosition}>
          <p className="text-sm text-center leading-relaxed">{description}</p>
        </Tooltip>
      )}
    </div>
  );

  if (layout === "stacked") {
    return (
      <div className="setting-row border-b border-logo-stroke/[0.08] px-6 py-5 last:border-b-0">
        <div className="mb-5 flex items-center gap-3">
          {descriptionMode === "tooltip" ? infoButton : null}
          <div className="min-w-0">
            <h3
              className={`text-[15px] font-semibold leading-snug ${disabled ? "text-white/35" : "text-white/95"}`}
            >
              {title}
            </h3>
            {descriptionMode === "inline" && description ? (
              <p
                className={`mt-1.5 text-[12px] leading-5 ${disabled ? "text-white/25" : "text-zinc-400"}`}
              >
                {description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="w-full">{children}</div>
      </div>
    );
  }

  return (
    <div
      className="setting-row border-b border-logo-stroke/[0.08] last:border-b-0"
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minHeight: 72,
        padding: "16px",
        transition: "background 0.14s ease",
      }}
    >
      <div className="min-w-0">
        {descriptionMode === "tooltip" ? (
          <div className="flex min-w-0 items-start gap-[12px]">
            {infoButton}
            <div className="min-w-0">
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: "22px",
                  letterSpacing: 0,
                  color: disabled
                    ? "rgba(255,255,255,0.35)"
                    : "rgba(255,255,255,0.94)",
                  whiteSpace: "normal",
                }}
              >
                {title}
              </h3>
              {description ? (
                <p
                  style={{
                    marginTop: 5,
                    maxWidth: 560,
                    fontSize: 12,
                    lineHeight: "18px",
                    color: disabled ? "rgba(255,255,255,0.25)" : "#a1a1aa",
                  }}
                >
                  {description}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-[12px]">
            {description ? (
              <div style={{ paddingTop: 3 }}>{infoButton}</div>
            ) : null}
            <div className="min-w-0">
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: "22px",
                  letterSpacing: 0,
                  color: disabled
                    ? "rgba(255,255,255,0.35)"
                    : "rgba(255,255,255,0.94)",
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  marginTop: 5,
                  fontSize: 12,
                  lineHeight: "18px",
                  color: disabled ? "rgba(255,255,255,0.25)" : "#a1a1aa",
                }}
              >
                {description}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="relative shrink-0">{children}</div>
    </div>
  );
};

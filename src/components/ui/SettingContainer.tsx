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
  grouped = false,
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

  // Row style: flex items-center justify-between py-[13px] border-b border-white/5
  // When grouped (inside a SettingsGroup which handles dividers), use simpler row
  const rowClasses = grouped ? "" : "border-b border-white/5 last:border-b-0";

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
        className="flex h-[14px] w-[14px] items-center justify-center rounded-full border border-white/20 text-[9px] font-medium text-white/30 transition-colors hover:border-white/28 hover:text-white/45"
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
      <div className={rowClasses}>
        <div className="mb-3 flex items-center gap-[10px]">
          {descriptionMode === "tooltip" ? infoButton : null}
          <div className="min-w-0">
            <h3
              className={`text-[14px] font-normal leading-5 text-white/85 ${disabled ? "opacity-50" : ""}`}
            >
              {title}
            </h3>
            {descriptionMode === "inline" && description ? (
              <p
                className={`mt-[2px] text-[11.5px] leading-5 text-text/55 ${disabled ? "opacity-50" : ""}`}
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
      className={`group ${rowClasses}`}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minHeight: 48,
        padding: "13px 0",
        borderBottom: "0.5px solid rgba(255,255,255,0.05)",
      }}
    >
      <div className="min-w-0">
        {descriptionMode === "tooltip" ? (
          <div className="flex min-w-0 items-center gap-[10px]">
            {infoButton}
            <h3
              className={`whitespace-nowrap text-[14px] font-normal leading-5 text-white/85 ${disabled ? "opacity-50" : ""}`}
            >
              {title}
            </h3>
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-[10px]">
            {description ? <div className="pt-[3px]">{infoButton}</div> : null}
            <div className="min-w-0">
              <h3
                className={`text-[14px] font-normal leading-5 text-white/85 ${disabled ? "opacity-50" : ""}`}
              >
                {title}
              </h3>
              <p
                className={`mt-[2px] text-[11.5px] leading-5 text-text/55 ${disabled ? "opacity-50" : ""}`}
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

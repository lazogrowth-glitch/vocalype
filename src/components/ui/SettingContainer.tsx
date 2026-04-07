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
        className="flex h-[14px] w-[14px] items-center justify-center rounded-full border border-white/[0.18] text-[9px] font-medium text-white/25 transition-colors hover:border-white/30 hover:text-white/45"
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
      <div
        className="setting-row border-b border-white/[0.05] last:border-b-0"
        style={{ padding: "16px 18px" }}
      >
        <div
          style={{
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {descriptionMode === "tooltip" ? infoButton : null}
          <div className="min-w-0">
            <h3
              style={{
                fontSize: 14,
                fontWeight: 400,
                lineHeight: "20px",
                color: disabled
                  ? "rgba(255,255,255,0.35)"
                  : "rgba(255,255,255,0.88)",
              }}
            >
              {title}
            </h3>
            {descriptionMode === "inline" && description ? (
              <p
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  lineHeight: "18px",
                  color: disabled
                    ? "rgba(255,255,255,0.25)"
                    : "rgba(255,255,255,0.42)",
                }}
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
      className="setting-row border-b border-white/[0.05] last:border-b-0"
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minHeight: 52,
        padding: "13px 18px",
        transition: "background 0.1s ease",
      }}
    >
      <div className="min-w-0">
        {descriptionMode === "tooltip" ? (
          <div className="flex min-w-0 items-center gap-[9px]">
            {infoButton}
            <h3
              style={{
                fontSize: 14,
                fontWeight: 400,
                lineHeight: "20px",
                color: disabled
                  ? "rgba(255,255,255,0.35)"
                  : "rgba(255,255,255,0.88)",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h3>
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-[9px]">
            {description ? (
              <div style={{ paddingTop: 3 }}>{infoButton}</div>
            ) : null}
            <div className="min-w-0">
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: disabled
                    ? "rgba(255,255,255,0.35)"
                    : "rgba(255,255,255,0.88)",
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  lineHeight: "18px",
                  color: disabled
                    ? "rgba(255,255,255,0.25)"
                    : "rgba(255,255,255,0.42)",
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

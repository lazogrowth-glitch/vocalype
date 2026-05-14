import React from "react";
import { useTranslation } from "react-i18next";
import { Globe, Loader2, Trash2 } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import { LANGUAGES } from "../../lib/constants/languages";
import Badge from "../ui/Badge";
import { Button } from "../ui/Button";

function formatEta(remainingBytes: number, speedMbps: number): string | null {
  if (speedMbps <= 0 || remainingBytes <= 0) return null;
  const seconds = remainingBytes / (1024 * 1024) / speedMbps;
  if (seconds < 5) return null;
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  return `~${Math.ceil(seconds / 60)}min`;
}

const getLanguageDisplayText = (
  supportedLanguages: string[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  if (supportedLanguages.length === 1) {
    const langCode = supportedLanguages[0];
    const langName =
      LANGUAGES.find((l) => l.value === langCode)?.label || langCode;
    return t("modelSelector.capabilities.languageOnly", { language: langName });
  }
  return t("modelSelector.capabilities.multiLanguage");
};

export type ModelCardStatus =
  | "downloadable"
  | "downloading"
  | "extracting"
  | "switching"
  | "active"
  | "available";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured";
  status?: ModelCardStatus;
  disabled?: boolean;
  className?: string;
  onSelect: (modelId: string) => void;
  onDownload?: (modelId: string) => void;
  onDelete?: (modelId: string) => void;
  onCancel?: (modelId: string) => void;
  downloadProgress?: number;
  downloadSpeed?: number;
  showRecommended?: boolean;
  copilotOptimized?: boolean;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  status = "downloadable",
  disabled = false,
  className = "",
  onSelect,
  onDownload,
  onDelete,
  onCancel,
  downloadProgress,
  downloadSpeed,
}) => {
  const { t } = useTranslation();
  const isFeatured = variant === "featured";
  const isClickable =
    status === "available" || status === "active" || status === "downloadable";

  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);

  const getInteractiveClasses = () => {
    if (!isClickable) return "";
    if (disabled) return "cursor-not-allowed opacity-50";
    return "group";
  };

  const handleClick = () => {
    if (!isClickable || disabled) return;
    if (status === "downloadable" && onDownload) {
      onDownload(model.id);
    } else {
      onSelect(model.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(model.id);
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && isClickable) handleClick();
      }}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      className={[
        "voca-model-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2",
        status === "active" || isFeatured ? "voca-model-card--active" : "",
        getInteractiveClasses(),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          alignItems: "center",
          gap: 20,
        }}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-logo-primary/14 bg-logo-primary/12 text-logo-primary">
          <Globe className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            <h3
              className={`text-[14px] font-semibold text-white transition-colors ${
                isClickable ? "group-hover:text-logo-primary" : ""
              }`}
            >
              {displayName}
            </h3>
            {status === "switching" ? (
              <Badge variant="secondary">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {t("modelSelector.switching")}
              </Badge>
            ) : null}
          </div>

          <p className="mt-2 text-[14px] leading-6 text-white/72">
            {displayDescription}
          </p>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
            }}
            className="text-[12px] text-white/34"
          >
            {model.supported_languages.length > 0 ? (
              <span>
                {getLanguageDisplayText(model.supported_languages, t)}
              </span>
            ) : null}
            {status === "downloadable" ? (
              <span>{formatModelSize(Number(model.size_mb))}</span>
            ) : null}
            {model.supports_translation ? (
              <span>{t("modelSelector.capabilities.translate")}</span>
            ) : null}
          </div>
        </div>

        {(model.accuracy_score > 0 || model.speed_score > 0) && (
          <div className="ml-auto hidden items-center min-[900px]:flex">
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <p className="w-12 text-right text-[10px] text-white/34">
                  {t("onboarding.modelCard.accuracy")}
                </p>
                <div className="h-[5px] w-[86px] overflow-hidden rounded-full bg-logo-stroke/10">
                  <div
                    className="h-full rounded-full bg-logo-primary"
                    style={{ width: `${model.accuracy_score * 100}%` }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <p className="w-12 text-right text-[10px] text-white/34">
                  {t("onboarding.modelCard.speed")}
                </p>
                <div className="h-[5px] w-[86px] overflow-hidden rounded-full bg-logo-stroke/10">
                  <div
                    className="h-full rounded-full bg-logo-primary"
                    style={{ width: `${model.speed_score * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {onDelete && (status === "available" || status === "active") ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          title={t("modelSelector.deleteModel", { modelName: displayName })}
          className="ml-auto shrink-0 text-white/35 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      {status === "downloading" && downloadProgress !== undefined ? (
        <div style={{ marginTop: 12 }} className="basis-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-mid-gray/20">
            <div
              className="h-full rounded-full bg-logo-primary transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div
            style={{ marginTop: 4 }}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-text/50">
              {t("modelSelector.downloading", {
                percentage: Math.round(downloadProgress),
              })}
            </span>
            <div className="flex items-center gap-2">
              {downloadSpeed !== undefined && downloadSpeed > 0 ? (
                <span className="tabular-nums text-text/50">
                  {t("modelSelector.downloadSpeed", {
                    speed: downloadSpeed.toFixed(1),
                  })}
                </span>
              ) : null}
              {(() => {
                if (!downloadSpeed || !model.size_mb || !downloadProgress) {
                  return null;
                }
                const remainingBytes =
                  ((100 - downloadProgress) / 100) *
                  Number(model.size_mb) *
                  1024 *
                  1024;
                const eta = formatEta(remainingBytes, downloadSpeed);
                return eta ? (
                  <span className="tabular-nums text-xs text-text/40">
                    {t("modelSelector.downloadEta", { eta })}
                  </span>
                ) : null;
              })()}
              {onCancel ? (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCancel(model.id);
                  }}
                  aria-label={t("modelSelector.cancelDownload")}
                >
                  {t("modelSelector.cancel")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {status === "extracting" ? (
        <div className="mt-3 basis-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-mid-gray/20">
            <div className="h-full w-full animate-pulse rounded-full bg-logo-primary" />
          </div>
          <p className="mt-1 text-xs text-text/50">
            {t("modelSelector.extractingGeneric")}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default ModelCard;

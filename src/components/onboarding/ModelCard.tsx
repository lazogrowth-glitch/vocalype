import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Globe, Loader2, Trash2 } from "lucide-react";
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

type ProductBadge = {
  label: string;
  variant:
    | "primary"
    | "success"
    | "secondary"
    | "quality"
    | "speed"
    | "experimental";
};

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

const getProductBadges = (
  model: ModelInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
  copilotOptimized: boolean,
): ProductBadge[] => {
  const hardwareBadges: ProductBadge[] = copilotOptimized
    ? [{ label: "Optimized Copilot+", variant: "success" }]
    : [];

  if (model.id === "parakeet-tdt-0.6b-v3-multilingual") {
    return [
      {
        label: t("modelSelector.badges.bestDefault", {
          defaultValue: "Best Default",
        }),
        variant: "primary",
      },
      {
        label: t("modelSelector.badges.multilingualExperimental", {
          defaultValue: "Multilingual",
        }),
        variant: "secondary",
      },
      ...hardwareBadges,
    ];
  }

  if (model.id === "large") {
    return [
      {
        label: t("modelSelector.badges.bestQuality", {
          defaultValue: "Best Quality",
        }),
        variant: "quality",
      },
    ];
  }

  if (model.id === "parakeet-tdt-0.6b-v2") {
    return [
      {
        label: t("modelSelector.badges.englishOnly", {
          defaultValue: "English Only",
        }),
        variant: "speed",
      },
    ];
  }

  if (model.id === "parakeet-tdt-0.6b-v3-english") {
    return [
      {
        label: t("modelSelector.badges.fastEnglish", {
          defaultValue: "Fast English",
        }),
        variant: "speed",
      },
      ...hardwareBadges,
    ];
  }

  if (model.is_recommended) {
    return [{ label: t("onboarding.recommended"), variant: "primary" }];
  }

  return [];
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
  showRecommended = true,
  copilotOptimized = false,
}) => {
  const { t } = useTranslation();
  const isFeatured = variant === "featured";
  const isClickable =
    status === "available" || status === "active" || status === "downloadable";
  const isGemini = model.id === "gemini-api";

  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const productBadges = getProductBadges(model, t, copilotOptimized);

  const baseClasses =
    "flex flex-wrap items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2";

  const getVariantClasses = () => {
    if (status === "active") {
      return "border-logo-primary/30 bg-logo-primary/[0.08]";
    }
    if (isFeatured) {
      return "border-logo-primary/22 bg-logo-primary/[0.05]";
    }
    return "border-white/8";
  };

  const getInteractiveClasses = () => {
    if (!isClickable) return "";
    if (disabled) return "cursor-not-allowed opacity-50";
    return "group cursor-pointer hover:border-white/12 hover:bg-white/[0.05]";
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
        baseClasses,
        getVariantClasses(),
        getInteractiveClasses(),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-logo-primary/12 text-logo-primary">
          <Globe className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-[14px] font-semibold text-white transition-colors ${
                isClickable ? "group-hover:text-logo-primary" : ""
              }`}
            >
              {displayName}
            </h3>
            {showRecommended &&
              productBadges.map((badge) => (
                <Badge key={badge.label} variant={badge.variant}>
                  {badge.label}
                </Badge>
              ))}
            {showRecommended && !isGemini ? (
              <Badge variant="secondary">
                {t("modelSelector.badges.localOnly", {
                  defaultValue: "100% local",
                })}
              </Badge>
            ) : null}
            {status === "active" ? (
              <Badge variant="primary">
                <Check className="mr-1 h-3 w-3" />
                {t("modelSelector.active")}
              </Badge>
            ) : null}
            {model.is_custom ? (
              <Badge variant="secondary">{t("modelSelector.custom")}</Badge>
            ) : null}
            {status === "switching" ? (
              <Badge variant="secondary">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {t("modelSelector.switching")}
              </Badge>
            ) : null}
          </div>

          <p className="mt-1 text-[13px] leading-6 text-white/75">
            {displayDescription}
          </p>

          {isGemini ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/8 px-2.5 py-2 text-[11px] leading-5 text-amber-400/80">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t("modelSelector.geminiCloudWarning", {
                  defaultValue:
                    "Gemini sends audio to Google for transcription. Other models process everything locally on your device.",
                })}
              </span>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-white/34">
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
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="w-12 text-right text-[10px] text-white/34">
                  {t("onboarding.modelCard.accuracy")}
                </p>
                <div className="h-[4px] w-[68px] overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-logo-primary"
                    style={{ width: `${model.accuracy_score * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="w-12 text-right text-[10px] text-white/34">
                  {t("onboarding.modelCard.speed")}
                </p>
                <div className="h-[4px] w-[68px] overflow-hidden rounded-full bg-white/8">
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
          className="ml-auto shrink-0 text-white/35 hover:text-logo-primary"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      {status === "downloading" && downloadProgress !== undefined ? (
        <div className="mt-3 basis-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-mid-gray/20">
            <div
              className="h-full rounded-full bg-logo-primary transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
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

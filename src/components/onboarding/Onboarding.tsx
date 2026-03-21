import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ModelInfo } from "@/bindings";
import type { ModelCardStatus } from "./ModelCard";
import ModelCard from "./ModelCard";
import VocalTypeLogo from "../icons/VocalTypeLogo";
import { useModelStore } from "../../stores/modelStore";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";

interface AdaptiveProfileSnapshot {
  machine_tier: "low" | "medium" | "high";
  recommended_model_id: string;
  npu_detected?: boolean;
  npu_kind?: "none" | "qualcomm" | "intel" | "amd" | "unknown";
  copilot_plus_detected?: boolean;
}

const isCopilotOptimizedParakeet = (
  profile: AdaptiveProfileSnapshot | null,
  modelId: string,
): boolean => {
  if (
    modelId !== "parakeet-tdt-0.6b-v3-english" &&
    modelId !== "parakeet-tdt-0.6b-v3-multilingual"
  ) {
    return false;
  }

  return (
    !!profile?.npu_detected &&
    (profile.npu_kind === "qualcomm" || profile.npu_kind === "intel")
  );
};

const getOnboardingRank = (model: ModelInfo): number => {
  if (model.id === "parakeet-tdt-0.6b-v3-multilingual") return 1000;
  if (model.id === "parakeet-tdt-0.6b-v3-english") return 980;
  if (model.id === "large") return 950;
  if (model.id === "turbo") return 900;
  if (model.id === "parakeet-tdt-0.6b-v2") return 850;
  if (model.id === "medium") return 800;
  if (model.id === "small") return 700;
  if (model.id === "sense-voice-int8") return 650;
  if (model.id === "breeze-asr") return 640;
  if (model.id === "moonshine-medium-streaming-en") return 560;
  if (model.id === "moonshine-small-streaming-en") return 540;
  if (model.id === "moonshine-base") return 520;
  if (model.id === "moonshine-tiny-streaming-en") return 500;
  if (model.id === "gemini-api") return 200;
  return Math.round(model.accuracy_score * 1000 + model.speed_score * 100);
};

interface OnboardingProps {
  onModelSelected: () => void;
  onBack?: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onModelSelected, onBack }) => {
  const { t, i18n } = useTranslation();
  const {
    models,
    downloadModel,
    selectModel,
    downloadingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
  } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [adaptiveProfile, setAdaptiveProfile] =
    useState<AdaptiveProfileSnapshot | null>(null);

  const isDownloading = selectedModelId !== null;

  // Watch for the selected model to finish downloading + extracting
  useEffect(() => {
    invoke<AdaptiveProfileSnapshot | null>("get_adaptive_runtime_profile")
      .then((profile) => setAdaptiveProfile(profile))
      .catch(() => setAdaptiveProfile(null));
  }, []);

  useEffect(() => {
    if (!selectedModelId) return;

    const model = models.find((m) => m.id === selectedModelId);
    const stillDownloading = selectedModelId in downloadingModels;
    const stillExtracting = selectedModelId in extractingModels;

    if (model?.is_downloaded && !stillDownloading && !stillExtracting) {
      // Model is ready — select it and transition
      selectModel(selectedModelId).then((success) => {
        if (success) {
          onModelSelected();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          setSelectedModelId(null);
        }
      });
    }
  }, [
    selectedModelId,
    models,
    downloadingModels,
    extractingModels,
    selectModel,
    onModelSelected,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    setSelectedModelId(modelId);

    const success = await downloadModel(modelId);
    if (!success) {
      toast.error(t("onboarding.downloadFailed"));
      setSelectedModelId(null);
    }
  };

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) return "extracting";
    if (modelId in downloadingModels) return "downloading";
    return "downloadable";
  };

  const getModelDownloadProgress = (modelId: string): number | undefined => {
    return downloadProgress[modelId]?.percentage;
  };

  const getModelDownloadSpeed = (modelId: string): number | undefined => {
    return downloadStats[modelId]?.speed;
  };

  const modeCards = (() => {
    const appIsEnglish = i18n.language.startsWith("en");
    const rapidId = appIsEnglish
      ? "parakeet-tdt-0.6b-v3-english"
      : "parakeet-tdt-0.6b-v3-multilingual";
    const balancedId =
      adaptiveProfile?.machine_tier === "low" ? "small" : "turbo";
    const qualityId = "large";
    return [
      {
        id: "auto",
        title: t("onboarding.mode.auto", { defaultValue: "Auto" }),
        description: t("onboarding.mode.autoDescription", {
          defaultValue: "Best match for this machine",
        }),
        modelId: adaptiveProfile?.recommended_model_id ?? rapidId,
      },
      {
        id: "fast",
        title: t("onboarding.mode.fast", { defaultValue: "Rapide" }),
        description: t("onboarding.mode.fastDescription", {
          defaultValue: isCopilotOptimizedParakeet(adaptiveProfile, rapidId)
            ? "Lowest latency with the NPU path on this PC"
            : "Lowest latency for quick dictation",
        }),
        modelId: rapidId,
      },
      {
        id: "balanced",
        title: t("onboarding.mode.balanced", {
          defaultValue: "Équilibré",
        }),
        description: t("onboarding.mode.balancedDescription", {
          defaultValue: "Better quality without going too heavy",
        }),
        modelId: balancedId,
      },
      {
        id: "quality",
        title: t("onboarding.mode.quality", { defaultValue: "Qualité" }),
        description: t("onboarding.mode.qualityDescription", {
          defaultValue: "Best text quality on stronger machines",
        }),
        modelId: qualityId,
      },
    ].map((entry) => ({
      ...entry,
      model: models.find((model) => model.id === entry.modelId) ?? null,
    }));
  })();

  return (
    <div className="relative h-screen w-screen flex flex-col p-6 gap-4 inset-0">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute top-4 left-4 flex items-center gap-1.5 text-sm text-text/50 hover:text-text/80 transition-colors"
        >
          ← {t("common.back")}
        </button>
      )}
      <div className="flex flex-col items-center gap-2 shrink-0">
        <VocalTypeLogo width={200} />
        <p className="text-text/70 max-w-md font-medium mx-auto">
          {t("onboarding.subtitle")}
        </p>
      </div>

      <div className="max-w-[600px] w-full mx-auto text-center flex-1 flex flex-col min-h-0">
        {(adaptiveProfile?.copilot_plus_detected ||
          adaptiveProfile?.npu_detected) && (
          <div className="mb-4 rounded-xl border border-logo-primary/25 bg-logo-primary/5 px-4 py-3 text-left">
            <p className="text-sm font-semibold text-text">
              {adaptiveProfile?.copilot_plus_detected
                ? t("onboarding.hardware.copilotPlusTitle", {
                    defaultValue: "Copilot+ PC detected",
                  })
                : t("onboarding.hardware.npuTitle", {
                    defaultValue: "NPU detected",
                  })}
            </p>
            <p className="text-xs text-text/60 mt-1">
              {adaptiveProfile?.copilot_plus_detected
                ? t("onboarding.hardware.copilotPlusDescription", {
                    defaultValue:
                      "This device includes an NPU class associated with Copilot+ PCs. VocalType now tracks that capability in its adaptive profile.",
                  })
                : t("onboarding.hardware.npuDescription", {
                    defaultValue:
                      "This device exposes a neural processor. VocalType now includes it in machine detection and diagnostics.",
                  })}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-4">
          {modeCards.map(({ id, title, description, modelId, model }) => {
            const unavailable = !model;
            return (
              <button
                key={id}
                type="button"
                disabled={isDownloading || unavailable}
                onClick={() => handleDownloadModel(modelId)}
                className="rounded-xl border border-mid-gray/20 bg-mid-gray/5 hover:border-logo-primary/40 hover:bg-logo-primary/5 text-left p-4 transition-all disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-text">{title}</p>
                    <p className="text-xs text-text/60 mt-1">{description}</p>
                  </div>
                  {id === "auto" && (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-logo-primary">
                      {t("onboarding.recommended")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text/50 mt-3">
                  {model ? getTranslatedModelName(model, t) : modelId}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 pb-6">
          {models
            .filter((m: ModelInfo) => !m.is_downloaded)
            .filter((model: ModelInfo) => model.is_recommended)
            .map((model: ModelInfo) => (
              <ModelCard
                key={model.id}
                model={model}
                variant="featured"
                status={getModelStatus(model.id)}
                disabled={isDownloading}
                onSelect={handleDownloadModel}
                onDownload={handleDownloadModel}
                downloadProgress={getModelDownloadProgress(model.id)}
                downloadSpeed={getModelDownloadSpeed(model.id)}
                copilotOptimized={isCopilotOptimizedParakeet(
                  adaptiveProfile,
                  model.id,
                )}
              />
            ))}

          {models
            .filter((m: ModelInfo) => !m.is_downloaded)
            .filter((model: ModelInfo) => !model.is_recommended)
            .sort(
              (a: ModelInfo, b: ModelInfo) =>
                getOnboardingRank(b) - getOnboardingRank(a),
            )
            .map((model: ModelInfo) => (
              <ModelCard
                key={model.id}
                model={model}
                status={getModelStatus(model.id)}
                disabled={isDownloading}
                onSelect={handleDownloadModel}
                onDownload={handleDownloadModel}
                downloadProgress={getModelDownloadProgress(model.id)}
                downloadSpeed={getModelDownloadSpeed(model.id)}
                copilotOptimized={isCopilotOptimizedParakeet(
                  adaptiveProfile,
                  model.id,
                )}
              />
            ))}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;

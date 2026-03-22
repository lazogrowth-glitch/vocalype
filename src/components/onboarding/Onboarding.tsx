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

const isCopilotOptimizedParakeet = (profile: AdaptiveProfileSnapshot | null, modelId: string): boolean =>
  (modelId === "parakeet-tdt-0.6b-v3-english" || modelId === "parakeet-tdt-0.6b-v3-multilingual") &&
  !!profile?.npu_detected &&
  (profile.npu_kind === "qualcomm" || profile.npu_kind === "intel");

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
  const { models, downloadModel, selectModel, downloadingModels, extractingModels, downloadProgress, downloadStats } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [adaptiveProfile, setAdaptiveProfile] = useState<AdaptiveProfileSnapshot | null>(null);

  useEffect(() => {
    invoke<AdaptiveProfileSnapshot | null>("get_adaptive_runtime_profile")
      .then((profile) => setAdaptiveProfile(profile))
      .catch(() => setAdaptiveProfile(null));
  }, []);

  useEffect(() => {
    if (!selectedModelId) return;
    const model = models.find((m) => m.id === selectedModelId);
    if (model?.is_downloaded && !(selectedModelId in downloadingModels) && !(selectedModelId in extractingModels)) {
      selectModel(selectedModelId).then((success) => {
        if (success) onModelSelected();
        else {
          toast.error(t("onboarding.errors.selectModel"));
          setSelectedModelId(null);
        }
      });
    }
  }, [selectedModelId, models, downloadingModels, extractingModels, selectModel, onModelSelected, t]);

  const handleDownloadModel = async (modelId: string) => {
    setSelectedModelId(modelId);
    const success = await downloadModel(modelId);
    if (!success) {
      toast.error(t("onboarding.downloadFailed"));
      setSelectedModelId(null);
    }
  };

  const getModelStatus = (modelId: string): ModelCardStatus =>
    modelId in extractingModels ? "extracting" : modelId in downloadingModels ? "downloading" : "downloadable";

  const modeCards = (() => {
    const appIsEnglish = i18n.language.startsWith("en");
    const rapidId = appIsEnglish ? "parakeet-tdt-0.6b-v3-english" : "parakeet-tdt-0.6b-v3-multilingual";
    const balancedId = adaptiveProfile?.machine_tier === "low" ? "small" : "turbo";
    const qualityId = "large";
    return [
      {
        id: "auto",
        title: t("onboarding.mode.auto", { defaultValue: "Auto" }),
        description: t("onboarding.mode.autoDescription", { defaultValue: "Meilleur choix pour cette machine" }),
        modelId: adaptiveProfile?.recommended_model_id ?? rapidId,
      },
      {
        id: "fast",
        title: t("onboarding.mode.fast", { defaultValue: "Rapide" }),
        description: t("onboarding.mode.fastDescription", {
          defaultValue: isCopilotOptimizedParakeet(adaptiveProfile, rapidId) ? "Latence minimale avec le chemin NPU de ce PC" : "Le plus rapide pour une dictée fluide",
        }),
        modelId: rapidId,
      },
      {
        id: "balanced",
        title: t("onboarding.mode.balanced", { defaultValue: "Équilibré" }),
        description: t("onboarding.mode.balancedDescription", { defaultValue: "Un bon compromis entre vitesse et qualité" }),
        modelId: balancedId,
      },
      {
        id: "quality",
        title: t("onboarding.mode.quality", { defaultValue: "Qualité" }),
        description: t("onboarding.mode.qualityDescription", { defaultValue: "La meilleure qualité de texte sur une machine plus puissante" }),
        modelId: qualityId,
      },
    ].map((entry) => ({ ...entry, model: models.find((model) => model.id === entry.modelId) ?? null }));
  })();

  const isDownloading = selectedModelId !== null;

  return (
    <div className="relative inset-0 flex h-screen w-screen flex-col gap-5 bg-[radial-gradient(circle_at_top,_rgba(201,168,76,0.16),_transparent_30%),linear-gradient(180deg,_#111_0%,_#090909_100%)] p-6">
      {onBack ? (
        <button type="button" onClick={onBack} className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] text-text/58 transition-colors hover:bg-white/[0.08] hover:text-text/82">
          {t("common.back")}
        </button>
      ) : null}

      <div className="flex shrink-0 flex-col items-center gap-3 pt-2">
        <VocalTypeLogo width={200} />
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-logo-primary/80">{t("onboarding.title")}</p>
          <p className="mx-auto mt-2 max-w-2xl text-[15px] leading-7 text-text/70">{t("onboarding.subtitle")}</p>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-white/[0.03] px-6 py-6 shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
        {(adaptiveProfile?.copilot_plus_detected || adaptiveProfile?.npu_detected) && (
          <div className="mb-5 rounded-2xl border border-logo-primary/25 bg-logo-primary/5 px-4 py-3 text-left">
            <p className="text-sm font-semibold text-text">
              {adaptiveProfile?.copilot_plus_detected
                ? t("onboarding.hardware.copilotPlusTitle", { defaultValue: "Copilot+ PC detected" })
                : t("onboarding.hardware.npuTitle", { defaultValue: "NPU detected" })}
            </p>
            <p className="mt-1 text-[13px] leading-6 text-text/60">
              {adaptiveProfile?.copilot_plus_detected
                ? t("onboarding.hardware.copilotPlusDescription", { defaultValue: "This device includes an NPU class associated with Copilot+ PCs. VocalType now tracks that capability in its adaptive profile." })
                : t("onboarding.hardware.npuDescription", { defaultValue: "This device exposes a neural processor. VocalType now includes it in machine detection and diagnostics." })}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          {modeCards.map(({ id, title, description, modelId, model }) => (
            <button key={id} type="button" disabled={isDownloading || !model} onClick={() => handleDownloadModel(modelId)} className="rounded-2xl border border-mid-gray/20 bg-mid-gray/5 p-4 text-left transition-all hover:border-logo-primary/40 hover:bg-logo-primary/5 disabled:opacity-50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold text-text">{title}</p>
                  <p className="mt-1 text-[13px] leading-6 text-text/60">{description}</p>
                </div>
                {id === "auto" ? <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-logo-primary">{t("onboarding.recommended")}</span> : null}
              </div>
              <p className="mt-3 text-[12px] text-text/48">{model ? getTranslatedModelName(model, t) : modelId}</p>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4 pb-3">
            {models.filter((m) => !m.is_downloaded).filter((m) => m.is_recommended).map((model) => (
              <ModelCard key={model.id} model={model} variant="featured" status={getModelStatus(model.id)} disabled={isDownloading} onSelect={handleDownloadModel} onDownload={handleDownloadModel} downloadProgress={downloadProgress[model.id]?.percentage} downloadSpeed={downloadStats[model.id]?.speed} copilotOptimized={isCopilotOptimizedParakeet(adaptiveProfile, model.id)} />
            ))}
            {models.filter((m) => !m.is_downloaded).filter((m) => !m.is_recommended).sort((a, b) => getOnboardingRank(b) - getOnboardingRank(a)).map((model) => (
              <ModelCard key={model.id} model={model} status={getModelStatus(model.id)} disabled={isDownloading} onSelect={handleDownloadModel} onDownload={handleDownloadModel} downloadProgress={downloadProgress[model.id]?.percentage} downloadSpeed={downloadStats[model.id]?.speed} copilotOptimized={isCopilotOptimizedParakeet(adaptiveProfile, model.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;

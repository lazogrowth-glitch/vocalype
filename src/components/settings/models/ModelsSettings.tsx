import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import { useSettings } from "@/hooks/useSettings";
import type { ModelInfo } from "@/bindings";

const PRIMARY_LOCAL_MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";
const isPrimaryModel = (model: ModelInfo): boolean =>
  model.id === PRIMARY_LOCAL_MODEL_ID;

interface AdaptiveProfileSnapshot {
  machine_tier: "low" | "medium" | "high";
  recommended_model_id: string;
  active_runtime_model_id?: string | null;
  npu_detected?: boolean;
  npu_kind?: "none" | "qualcomm" | "intel" | "amd" | "unknown";
  copilot_plus_detected?: boolean;
}

const isCopilotOptimizedParakeet = (
  profile: AdaptiveProfileSnapshot | null,
  modelId: string,
): boolean => {
  if (modelId !== PRIMARY_LOCAL_MODEL_ID) return false;
  return (
    !!profile?.npu_detected &&
    (profile.npu_kind === "qualcomm" || profile.npu_kind === "intel")
  );
};

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [cancellingModelId, setCancellingModelId] = useState<string | null>(
    null,
  );
  const [adaptiveProfile, setAdaptiveProfile] =
    useState<AdaptiveProfileSnapshot | null>(null);
  const {} = useSettings();
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    extractingModels,
    loading,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
  } = useModelStore();

  useEffect(() => {
    invoke<AdaptiveProfileSnapshot | null>("get_adaptive_runtime_profile")
      .then((profile) => setAdaptiveProfile(profile))
      .catch(() => setAdaptiveProfile(null));
  }, []);

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) return "extracting";
    if (modelId in downloadingModels) return "downloading";
    if (switchingModelId === modelId) return "switching";
    if (modelId === currentModel) return "active";
    const model = models.find((m: ModelInfo) => m.id === modelId);
    if (model?.is_downloaded) return "available";
    return "downloadable";
  };

  const getDownloadProgress = (modelId: string): number | undefined =>
    downloadProgress[modelId]?.percentage;

  const getDownloadSpeed = (modelId: string): number | undefined =>
    downloadStats[modelId]?.speed;

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    if (modelId in downloadingModels) return;
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const isActive = modelId === currentModel;

    const confirmed = await ask(
      isActive
        ? t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    if (cancellingModelId === modelId) return;
    setCancellingModelId(modelId);
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    } finally {
      setCancellingModelId(null);
    }
  };

  const visibleModels = useMemo(
    () => models.filter((model: ModelInfo) => isPrimaryModel(model)),
    [models],
  );

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {visibleModels.length > 0 ? (
        <div className="flex flex-col gap-3 pt-2">
          <p className="voca-label-caps mb-1">
            {t("settings.models.yourModels")}
          </p>

          {visibleModels.map((model: ModelInfo) => (
            <ModelCard
              key={model.id}
              model={model}
              status={getModelStatus(model.id)}
              onSelect={handleModelSelect}
              onDownload={handleModelDownload}
              onDelete={handleModelDelete}
              onCancel={handleModelCancel}
              downloadProgress={getDownloadProgress(model.id)}
              downloadSpeed={getDownloadSpeed(model.id)}
              showRecommended={true}
              copilotOptimized={isCopilotOptimizedParakeet(
                adaptiveProfile,
                model.id,
              )}
            />
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-text/50">
          {t("settings.models.noModelsMatch")}
        </div>
      )}
    </div>
  );
};

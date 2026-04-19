import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import { useSettings } from "@/hooks/useSettings";
import type { ModelInfo } from "@/bindings";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { GeminiKeyModal } from "./GeminiKeyModal";
import { CloudSttKeyModal, type CloudSttProvider } from "./CloudSttKeyModal";

const getModelRank = (model: ModelInfo): number => {
  if (model.id === "parakeet-tdt-0.6b-v3-multilingual") return 1000;
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

const compareModels = (a: ModelInfo, b: ModelInfo): number => {
  if (a.is_recommended !== b.is_recommended) {
    return a.is_recommended ? -1 : 1;
  }

  const rankDiff = getModelRank(b) - getModelRank(a);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const accuracyDiff = b.accuracy_score - a.accuracy_score;
  if (accuracyDiff !== 0) {
    return accuracyDiff > 0 ? 1 : -1;
  }

  const speedDiff = b.speed_score - a.speed_score;
  if (speedDiff !== 0) {
    return speedDiff > 0 ? 1 : -1;
  }

  return a.name.localeCompare(b.name);
};

const PRIMARY_LOCAL_MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";
const isPrimaryModel = (model: ModelInfo): boolean =>
  model.id === PRIMARY_LOCAL_MODEL_ID;

type ModelsTab = "transcription";

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
  if (modelId !== "parakeet-tdt-0.6b-v3-multilingual") {
    return false;
  }

  return (
    !!profile?.npu_detected &&
    (profile.npu_kind === "qualcomm" || profile.npu_kind === "intel")
  );
};

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ModelsTab>("transcription");
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [showGeminiKeyDialog, setShowGeminiKeyDialog] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [showCloudSttKeyDialog, setShowCloudSttKeyDialog] = useState(false);
  const [cloudSttProvider, setCloudSttProvider] =
    useState<CloudSttProvider>("groq");
  const [cloudSttKeyInput, setCloudSttKeyInput] = useState("");
  const [cancellingModelId, setCancellingModelId] = useState<string | null>(
    null,
  );
  const [adaptiveProfile, setAdaptiveProfile] =
    useState<AdaptiveProfileSnapshot | null>(null);
  const { getSetting, updateSetting } = useSettings();
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

  const geminiApiKey = getSetting("gemini_api_key") as string | undefined;
  const hasGeminiKey = !!geminiApiKey && geminiApiKey.length > 0;

  const groqApiKey = getSetting("groq_stt_api_key") as string | undefined;
  const hasGroqKey = !!groqApiKey && groqApiKey.length > 0;
  const mistralApiKey = getSetting("mistral_stt_api_key") as string | undefined;
  const hasMistralKey = !!mistralApiKey && mistralApiKey.length > 0;
  const deepgramApiKey = getSetting("deepgram_api_key") as string | undefined;
  const hasDeepgramKey = !!deepgramApiKey && deepgramApiKey.length > 0;

  const cloudSttModelNeedsKey = (modelId: string): boolean => {
    if (modelId === "groq-whisper") return !hasGroqKey;
    if (modelId === "mistral-voxtral") return !hasMistralKey;
    if (modelId === "deepgram-nova") return !hasDeepgramKey;
    return false;
  };

  const modelIdToCloudProvider = (modelId: string): CloudSttProvider | null => {
    if (modelId === "groq-whisper") return "groq";
    if (modelId === "mistral-voxtral") return "mistral";
    if (modelId === "deepgram-nova") return "deepgram";
    return null;
  };
  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    if (modelId === currentModel) {
      if (modelId === "gemini-api" && !hasGeminiKey) {
        return "available";
      }
      if (cloudSttModelNeedsKey(modelId)) {
        return "available";
      }
      return "active";
    }
    const model = models.find((m: ModelInfo) => m.id === modelId);
    if (model?.is_downloaded) {
      return "available";
    }
    return "downloadable";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    if (modelId === "gemini-api" && !hasGeminiKey) {
      setGeminiKeyInput("");
      setShowGeminiKeyDialog(true);
      return;
    }
    const cloudProvider = modelIdToCloudProvider(modelId);
    if (cloudProvider && cloudSttModelNeedsKey(modelId)) {
      setCloudSttProvider(cloudProvider);
      setCloudSttKeyInput("");
      setShowCloudSttKeyDialog(true);
      return;
    }
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleGeminiKeySave = async () => {
    const key = geminiKeyInput.trim();
    if (!key) return;
    await updateSetting("gemini_api_key", key);
    setShowGeminiKeyDialog(false);
    setSwitchingModelId("gemini-api");
    try {
      await selectModel("gemini-api");
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleCloudSttKeySave = async () => {
    const key = cloudSttKeyInput.trim();
    if (!key) return;
    const modelIdMap: Record<CloudSttProvider, string> = {
      groq: "groq-whisper",
      mistral: "mistral-voxtral",
      deepgram: "deepgram-nova",
    };
    if (cloudSttProvider === "groq") {
      await commands.setGroqSttApiKey(key);
    } else if (cloudSttProvider === "mistral") {
      await commands.setMistralSttApiKey(key);
    } else {
      await commands.setDeepgramApiKey(key);
    }
    setShowCloudSttKeyDialog(false);
    const modelId = modelIdMap[cloudSttProvider];
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

  // Filter models based on language filter
  const filteredModels = useMemo(() => {
    return models.filter((model: ModelInfo) => {
      if (!isPrimaryModel(model)) return false;
      return true;
    });
  }, [models]);

  // Split filtered models into downloaded (including custom) and available sections
  const { downloadedModels, availableModels } = useMemo(() => {
    const downloaded: ModelInfo[] = [];
    const available: ModelInfo[] = [];

    for (const model of filteredModels) {
      const isGeminiWithoutKey = model.id === "gemini-api" && !hasGeminiKey;
      if (
        !isGeminiWithoutKey &&
        (model.is_custom ||
          model.is_downloaded ||
          model.id in downloadingModels ||
          model.id in extractingModels)
      ) {
        downloaded.push(model);
      } else {
        available.push(model);
      }
    }

    // Sort: active model first, then non-custom, then custom at the bottom
    downloaded.sort((a, b) => {
      if (a.id === currentModel) return -1;
      if (b.id === currentModel) return 1;
      if (a.is_custom !== b.is_custom) return a.is_custom ? 1 : -1;
      return compareModels(a, b);
    });

    available.sort(compareModels);

    return {
      downloadedModels: downloaded,
      availableModels: available,
    };
  }, [
    filteredModels,
    downloadingModels,
    extractingModels,
    currentModel,
    hasGeminiKey,
  ]);

  const primaryVisibleModels = useMemo(
    () =>
      [...downloadedModels, ...availableModels].filter(
        (model, index, items) =>
          items.findIndex((entry) => entry.id === model.id) === index &&
          model.id !== "parakeet-tdt-0.6b-v3" &&
          isPrimaryModel(model),
      ),
    [downloadedModels, availableModels],
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
      <div
        className="flex border-b border-white/8"
        style={{ gap: 4 }}
        role="tablist"
      >
        {(["transcription"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            style={{ padding: "7px 14px 9px" }}
            className={`border-b-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 ${
              activeTab === tab
                ? "border-logo-primary text-logo-primary"
                : "border-transparent text-white/40 hover:text-white/65"
            }`}
          >
            {t(`settings.models.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === "transcription" && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
          role="tabpanel"
        />
      )}

      {activeTab === "transcription" && filteredModels.length > 0 ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 40 }}
          role="tabpanel"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              className="flex items-center justify-between"
              style={{ marginBottom: 4 }}
            >
              <h2 className="text-[18px] font-bold tracking-[0] text-white/90">
                {t("settings.models.yourModels")}
              </h2>

              {null}
            </div>

            {primaryVisibleModels.map((model: ModelInfo) => (
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
        </div>
      ) : activeTab === "transcription" ? (
        <div className="py-8 text-center text-text/50">
          {t("settings.models.noModelsMatch")}
        </div>
      ) : null}

      <GeminiKeyModal
        show={showGeminiKeyDialog}
        value={geminiKeyInput}
        onChange={setGeminiKeyInput}
        onSave={handleGeminiKeySave}
        onClose={() => setShowGeminiKeyDialog(false)}
      />
      <CloudSttKeyModal
        show={showCloudSttKeyDialog}
        provider={cloudSttProvider}
        value={cloudSttKeyInput}
        onChange={setCloudSttKeyInput}
        onSave={handleCloudSttKeySave}
        onClose={() => setShowCloudSttKeyDialog(false)}
      />
    </div>
  );
};

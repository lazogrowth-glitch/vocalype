import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Globe,
  RefreshCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  TimerReset,
  X,
} from "lucide-react";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import { useSettings } from "@/hooks/useSettings";
import { LANGUAGES } from "@/lib/constants/languages.ts";
import type { ModelInfo } from "@/bindings";
import { commands } from "@/bindings";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return model.supported_languages.includes(langCode);
};

const getModelRank = (model: ModelInfo): number => {
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

const ProcessingModelsSection: React.FC = () => {
  const { t } = useTranslation();
  const {
    getSetting,
    settings,
    refreshSettings,
    fetchPostProcessModels,
    updatePostProcessApiKey,
    postProcessModelOptions,
  } = useSettings();
  const [isAdding, setIsAdding] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [isFetching, setIsFetching] = useState(false);

  const savedModels = getSetting("saved_processing_models") || [];
  const providers = settings?.post_process_providers || [];

  const providerOptions = useMemo(
    () => providers.map((p) => ({ value: p.id, label: p.label })),
    [providers],
  );

  const availableModels = postProcessModelOptions[selectedProviderId] || [];
  const modelOptions = useMemo(
    () => availableModels.map((m) => ({ value: m, label: m })),
    [availableModels],
  );

  const handleProviderChange = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      setSelectedModel("");
      const existingKey = settings?.post_process_api_keys?.[providerId] ?? "";
      setApiKey(existingKey);
    },
    [settings],
  );

  const handleFetchModels = useCallback(async () => {
    if (!selectedProviderId) return;
    if (apiKey.trim()) {
      await updatePostProcessApiKey(selectedProviderId, apiKey.trim());
    }
    setIsFetching(true);
    try {
      await fetchPostProcessModels(selectedProviderId);
    } finally {
      setIsFetching(false);
    }
  }, [
    selectedProviderId,
    apiKey,
    fetchPostProcessModels,
    updatePostProcessApiKey,
  ]);

  const handleSave = useCallback(async () => {
    if (!selectedProviderId || !selectedModel) return;
    const provider = providers.find((p) => p.id === selectedProviderId);
    const label = `${provider?.label || selectedProviderId} / ${selectedModel}`;
    try {
      await commands.addSavedProcessingModel(
        selectedProviderId,
        selectedModel,
        label,
      );
      await refreshSettings();
      setIsAdding(false);
      setSelectedProviderId("");
      setSelectedModel("");
      setApiKey("");
    } catch (error) {
      console.error("Failed to save processing model:", error);
    }
  }, [selectedProviderId, selectedModel, providers, refreshSettings]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await commands.deleteSavedProcessingModel(id);
        await refreshSettings();
      } catch (error) {
        console.error("Failed to delete processing model:", error);
      }
    },
    [refreshSettings],
  );

  const handleStartAdd = useCallback(() => {
    setIsAdding(true);
    setSelectedProviderId("");
    setSelectedModel("");
    setApiKey("");
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
        <p className="text-[13.5px] font-medium text-white">
          {t("settings.models.processingModels.title")}
        </p>
        <p className="mt-1 text-[11.5px] leading-5 text-white/40">
          {t("settings.models.processingModels.description")}
        </p>
      </div>

      {savedModels.length > 0 && (
        <div className="space-y-2">
          {savedModels.map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3"
            >
              <span className="truncate pr-3 text-[13px] text-text">
                {model.label}
              </span>
              <button
                onClick={() => handleDelete(model.id)}
                className="p-1 text-mid-gray/40 hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {savedModels.length === 0 && !isAdding && (
        <div className="rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="text-[12.5px] text-mid-gray">
            {t("settings.models.processingModels.noModels")}
          </p>
        </div>
      )}

      {isAdding && (
        <div className="space-y-3 rounded-[10px] border border-white/8 bg-white/[0.03] p-4">
          <div className="space-y-1">
            <label className="text-sm font-semibold">
              {t("settings.models.processingModels.provider")}
            </label>
            <Dropdown
              selectedValue={selectedProviderId || null}
              options={providerOptions}
              onSelect={handleProviderChange}
              placeholder={t("settings.models.processingModels.provider")}
            />
          </div>

          {selectedProviderId && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-semibold">
                  {t("settings.models.processingModels.apiKey")}
                </label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t(
                    "settings.models.processingModels.apiKeyPlaceholder",
                  )}
                  variant="compact"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-semibold">
                  {t("settings.models.processingModels.model")}
                </label>
                <div className="flex items-center gap-2">
                  {modelOptions.length > 0 ? (
                    <Dropdown
                      selectedValue={selectedModel || null}
                      options={modelOptions}
                      onSelect={setSelectedModel}
                      placeholder={t(
                        "settings.models.processingModels.modelPlaceholder",
                      )}
                      className="flex-1"
                    />
                  ) : (
                    <Input
                      type="text"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      placeholder={t(
                        "settings.models.processingModels.modelPlaceholder",
                      )}
                      variant="compact"
                      className="flex-1"
                    />
                  )}
                  <button
                    onClick={handleFetchModels}
                    disabled={isFetching || !apiKey.trim()}
                    className="flex items-center justify-center h-8 w-8 rounded-md bg-mid-gray/10 hover:bg-mid-gray/20 transition-colors disabled:opacity-40"
                    title={t("settings.models.processingModels.fetchModels")}
                  >
                    <RefreshCcw
                      className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={handleSave}
              variant="primary"
              size="md"
              disabled={!selectedProviderId || !selectedModel.trim()}
            >
              {t("settings.models.processingModels.save")}
            </Button>
            <Button
              onClick={() => setIsAdding(false)}
              variant="secondary"
              size="md"
            >
              {t("settings.models.processingModels.cancel")}
            </Button>
          </div>
        </div>
      )}

      {!isAdding && (
        <Button onClick={handleStartAdd} variant="primary" size="md">
          {t("settings.models.processingModels.addModel")}
        </Button>
      )}
    </div>
  );
};

type ModelsTab = "transcription" | "processing";

const PRODUCT_MODE_META = {
  auto: {
    icon: Sparkles,
    tone: "border-logo-primary/20 bg-logo-primary/8 text-logo-primary",
  },
  fast: {
    icon: Rocket,
    tone: "border-sky-400/20 bg-sky-400/8 text-sky-200",
  },
  balanced: {
    icon: TimerReset,
    tone: "border-white/10 bg-white/[0.04] text-text/72",
  },
  quality: {
    icon: ShieldCheck,
    tone: "border-emerald-400/20 bg-emerald-400/8 text-emerald-200",
  },
} as const;

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

export const ModelsSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<ModelsTab>("transcription");
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [showGeminiKeyDialog, setShowGeminiKeyDialog] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [adaptiveProfile, setAdaptiveProfile] =
    useState<AdaptiveProfileSnapshot | null>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
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

  // click outside handler for language dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  // filtered languages for dropdown (exclude "auto")
  const filteredLanguages = useMemo(() => {
    return LANGUAGES.filter(
      (lang) =>
        lang.value !== "auto" &&
        lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
    );
  }, [languageSearch]);

  // Get selected language label
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return LANGUAGES.find((lang) => lang.value === languageFilter)?.label || "";
  }, [languageFilter, t]);

  const geminiApiKey = getSetting("gemini_api_key") as string | undefined;
  const hasGeminiKey = !!geminiApiKey && geminiApiKey.length > 0;

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

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleProductModeSelect = async (modelId: string) => {
    const model = models.find((entry) => entry.id === modelId);
    if (!model) return;
    if (!model.is_downloaded) {
      await handleModelDownload(modelId);
      return;
    }
    await handleModelSelect(modelId);
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
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  // Filter models based on language filter
  const filteredModels = useMemo(() => {
    return models.filter((model: ModelInfo) => {
      if (languageFilter !== "all") {
        if (!modelSupportsLanguage(model, languageFilter)) return false;
      }
      return true;
    });
  }, [models, languageFilter]);

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

  const productModes = useMemo(() => {
    const rapidId = i18n.language.startsWith("en")
      ? "parakeet-tdt-0.6b-v3-english"
      : "parakeet-tdt-0.6b-v3-multilingual";
    const balancedId =
      adaptiveProfile?.machine_tier === "low" ? "small" : "turbo";
    return [
      {
        id: "auto",
        label: t("settings.models.modes.auto", { defaultValue: "Auto" }),
        description: t("settings.models.modes.autoDescription", {
          defaultValue: "Meilleur choix selon cette machine",
        }),
        modelId: adaptiveProfile?.recommended_model_id ?? rapidId,
      },
      {
        id: "fast",
        label: t("settings.models.modes.fast", { defaultValue: "Rapide" }),
        description: t("settings.models.modes.fastDescription", {
          defaultValue:
            isCopilotOptimizedParakeet(adaptiveProfile, rapidId)
              ? "Latence minimale avec le chemin NPU sur ce PC"
              : "Latence minimale pour la dictée courte",
        }),
        modelId: rapidId,
      },
      {
        id: "balanced",
        label: t("settings.models.modes.balanced", {
          defaultValue: "Équilibré",
        }),
        description: t("settings.models.modes.balancedDescription", {
          defaultValue: "Bon compromis qualité et réactivité",
        }),
        modelId: balancedId,
      },
      {
        id: "quality",
        label: t("settings.models.modes.quality", { defaultValue: "Qualité" }),
        description: t("settings.models.modes.qualityDescription", {
          defaultValue: "Meilleure précision sur machines puissantes",
        }),
        modelId: "large",
      },
    ].map((entry) => ({
      ...entry,
      model: models.find((model) => model.id === entry.modelId) ?? null,
    }));
  }, [adaptiveProfile, i18n.language, models, t]);

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
    <div className="w-full space-y-6">
      <div className="flex gap-1 border-b border-white/8">
        {(["transcription", "processing"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-[14px] pb-[9px] pt-[7px] text-[13px] transition-colors ${
              activeTab === tab
                ? "border-logo-primary text-logo-primary"
                : "border-transparent text-white/40 hover:text-white/65"
            }`}
          >
            {t(`settings.models.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {(adaptiveProfile?.copilot_plus_detected || adaptiveProfile?.npu_detected) && (
        <div className="rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="text-[13px] font-medium text-white/85">
            {adaptiveProfile?.copilot_plus_detected
              ? t("settings.models.hardware.copilotPlusTitle", {
                  defaultValue: "Copilot+ PC detected",
                })
              : t("settings.models.hardware.npuTitle", {
                  defaultValue: "NPU detected",
                })}
          </p>
          <p className="mt-1 text-[11.5px] leading-5 text-white/40">
            {adaptiveProfile?.copilot_plus_detected
              ? t("settings.models.hardware.copilotPlusDescription", {
                  defaultValue:
                    "VocalType will keep this capability in the adaptive profile, but true NPU execution still depends on the model runtime.",
                })
              : t("settings.models.hardware.npuDescription", {
                  defaultValue:
                    "This machine exposes a neural processor. VocalType now shows it in diagnostics and hardware profiling.",
                })}
          </p>
        </div>
      )}

      {activeTab === "transcription" && (
        <div className="space-y-2">
          {productModes.map(({ id, label, description, modelId, model }) => {
            const isActiveMode =
              (adaptiveProfile?.active_runtime_model_id || currentModel) === modelId;
            const meta = PRODUCT_MODE_META[id as keyof typeof PRODUCT_MODE_META];
            const Icon = meta.icon;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleProductModeSelect(modelId)}
                className={`flex w-full items-center gap-4 rounded-[10px] border px-4 py-3.5 text-left transition-all ${
                  isActiveMode
                    ? "border-logo-primary/30 bg-logo-primary/[0.08]"
                    : "border-white/8 bg-white/[0.03] hover:bg-white/[0.05]"
                }`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${meta.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-medium text-white">{label}</p>
                    {id === "auto" && (
                      <span className="rounded-md border border-logo-primary/25 bg-logo-primary/15 px-2 py-0.5 text-[10px] font-medium text-logo-primary">
                        {t("onboarding.recommended")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-5 text-white/40">
                    {description}
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/28">
                    {model ? getTranslatedModelName(model, t) : modelId}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {activeTab === "processing" && <ProcessingModelsSection />}

      {activeTab === "transcription" && filteredModels.length > 0 ? (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
                {t("settings.models.yourModels")}
              </h2>

              <div className="relative" ref={languageDropdownRef}>
                <button
                  type="button"
                  onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                  className={`flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[12.5px] ${
                    languageFilter !== "all"
                      ? "border-logo-primary/25 bg-logo-primary/12 text-logo-primary"
                      : "border-white/10 bg-white/[0.06] text-white/55 hover:text-white/75"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span className="max-w-[120px] truncate">
                    {selectedLanguageLabel}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      languageDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {languageDropdownOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-mid-gray/80 bg-background shadow-lg">
                    <div className="border-b border-mid-gray/40 p-2">
                      <input
                        ref={languageSearchInputRef}
                        type="text"
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            filteredLanguages.length > 0
                          ) {
                            setLanguageFilter(filteredLanguages[0].value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          } else if (e.key === "Escape") {
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }
                        }}
                        placeholder={t(
                          "settings.general.language.searchPlaceholder",
                        )}
                        className="w-full rounded-md border border-mid-gray/40 bg-mid-gray/10 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-logo-primary"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setLanguageFilter("all");
                          setLanguageDropdownOpen(false);
                          setLanguageSearch("");
                        }}
                        className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                          languageFilter === "all"
                            ? "bg-logo-primary/20 font-semibold text-logo-primary"
                            : "hover:bg-mid-gray/10"
                        }`}
                      >
                        {t("settings.models.filters.allLanguages")}
                      </button>
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.value}
                          type="button"
                          onClick={() => {
                            setLanguageFilter(lang.value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }}
                          className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                            languageFilter === lang.value
                              ? "bg-logo-primary/20 font-semibold text-logo-primary"
                              : "hover:bg-mid-gray/10"
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                      {filteredLanguages.length === 0 && (
                        <div className="px-3 py-2 text-center text-sm text-text/50">
                          {t("settings.general.language.noResults")}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {downloadedModels.map((model: ModelInfo) => (
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

          {availableModels.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
                {t("settings.models.availableModels")}
              </h2>
              {availableModels.map((model: ModelInfo) => (
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
          )}
        </div>
      ) : activeTab === "transcription" ? (
        <div className="py-8 text-center text-text/50">
          {t("settings.models.noModelsMatch")}
        </div>
      ) : null}

      {showGeminiKeyDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowGeminiKeyDialog(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowGeminiKeyDialog(false);
          }}
        >
          <div
            className="bg-background border border-mid-gray/40 rounded-xl p-5 w-96 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold">
                {t("settings.gemini.apiKeyRequired")}
              </h3>
              <p className="text-sm text-text/60 mt-1">
                {t("settings.gemini.apiKeyRequiredDescription")}
              </p>
            </div>
            <Input
              autoFocus
              type="password"
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGeminiKeySave();
              }}
              placeholder={t("settings.gemini.apiKeyPlaceholder")}
              className="w-full"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowGeminiKeyDialog(false)}
              >
                {t("settings.gemini.cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleGeminiKeySave}
                disabled={!geminiKeyInput.trim()}
              >
                {t("settings.gemini.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

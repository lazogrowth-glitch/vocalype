import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, TriangleAlert, Zap } from "lucide-react";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { RecordingModeSelector } from "../RecordingModeSelector";
import { useStartupWarmupStatus } from "../../../hooks/useStartupWarmupStatus";
import { getStartupWarmupFallbackDetail } from "../../../types/startupWarmup";
import { usePlan } from "@/lib/subscription/context";
import { DictionarySettings } from "../dictionary/DictionarySettings";
import { FeatureGateHint } from "../../ui";
import { useSettings } from "@/hooks/useSettings";
import { commands } from "@/bindings";

const DEV_PROMPT_ID = "dev_clean_llm_prompt";
const DEV_PROMPT_NAME = "Clean for LLM";
const DEV_PROMPT_TEXT =
  "Convert this rough voice dictation into a clear, structured prompt for an AI assistant. Rules:\n1. Remove filler words (uh, um, like, you know)\n2. Fix grammar and sentence structure\n3. Preserve all technical terms, variable names, and intent exactly\n4. Keep it concise - one clear request\n5. Do not add explanations or preamble\n\nReturn only the cleaned prompt.\n\nDictation:\n${output}";

function pickBestModel(models: string[]): string | null {
  const preferred = ["qwen", "llama", "mistral", "gemma", "phi"];
  for (const prefix of preferred) {
    const match = models.find((m) => m.toLowerCase().startsWith(prefix));
    if (match) return match;
  }
  return models[0] ?? null;
}

const DevModeToggle: React.FC = () => {
  const { settings, updateSetting } = useSettings();
  const [loading, setLoading] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  const isDevModeOn =
    settings?.post_process_enabled === true &&
    settings?.post_process_selected_prompt_id === DEV_PROMPT_ID;

  const activeModel =
    settings?.post_process_provider_id === "ollama"
      ? (settings?.post_process_models?.["ollama"] ?? null)
      : null;

  const enable = useCallback(async () => {
    setLoading(true);
    setOllamaError(null);
    try {
      let status = await commands.checkOllamaStatus();
      if (status.status !== "ok") {
        setOllamaError("Impossible de verifier Ollama. Reessaie.");
        return;
      }

      // Auto-start Ollama if not running, then wait up to 5s for it to come up
      if (!status.data.available) {
        const startResult = await commands.startOllamaServe();
        if (startResult.status === "error") {
          setOllamaError(
            "Ollama n'est pas installe. Installe-le sur ollama.com puis reessaie.",
          );
          return;
        }
        // Poll until available (max 5s)
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const retry = await commands.checkOllamaStatus();
          if (retry.status === "ok" && retry.data.available) {
            status = retry;
            break;
          }
        }
        if (status.status !== "ok" || !status.data.available) {
          setOllamaError(
            "Ollama n'a pas demarre. Verifie que l'installation est complete.",
          );
          return;
        }
      }

      let model = pickBestModel(status.data.models);

      // Auto-pull qwen2.5 if no model available
      if (!model) {
        setOllamaError("Telechargement de qwen2.5 en cours...");
        const pullResult = await commands.pullOllamaModel("qwen2.5");
        if (pullResult.status === "error") {
          setOllamaError(`Echec du telechargement : ${pullResult.error}`);
          return;
        }
        const afterPull = await commands.checkOllamaStatus();
        model =
          afterPull.status === "ok"
            ? pickBestModel(afterPull.data.models)
            : null;
        if (!model) {
          setOllamaError(
            "Modele telecharge mais introuvable. Redemarre l'app.",
          );
          return;
        }
        setOllamaError(null);
      }

      await commands.setPostProcessProvider("ollama");
      await commands.changePostProcessModelSetting("ollama", model);
      const existing = settings?.post_process_prompts?.find(
        (p) => p.id === DEV_PROMPT_ID,
      );
      if (!existing) {
        await commands.addPostProcessPrompt(DEV_PROMPT_NAME, DEV_PROMPT_TEXT);
      }
      await commands.setPostProcessSelectedPrompt(DEV_PROMPT_ID);
      updateSetting("post_process_enabled", true);
    } finally {
      setLoading(false);
    }
  }, [settings, updateSetting]);

  const disable = useCallback(() => {
    updateSetting("post_process_enabled", false);
    setOllamaError(null);
  }, [updateSetting]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 10,
        border: isDevModeOn
          ? "1px solid rgba(100,140,255,0.35)"
          : "1px solid rgba(255,255,255,0.07)",
        background: isDevModeOn
          ? "rgba(100,140,255,0.06)"
          : "rgba(255,255,255,0.03)",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Zap
          size={15}
          style={{
            color: isDevModeOn
              ? "rgba(100,140,255,0.9)"
              : "rgba(255,255,255,0.3)",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,255,255,0.9)",
              margin: 0,
            }}
          >
            {"Clean for LLM"}
          </p>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              margin: "2px 0 0",
            }}
          >
            {isDevModeOn
              ? `Actif via Ollama${activeModel ? ` - ${activeModel}` : ""} - prompt reformate avant de coller`
              : "Reformate ta dictee en prompt clair via Ollama (local, 100% prive)"}
          </p>
        </div>
        <button
          type="button"
          onClick={isDevModeOn ? disable : enable}
          disabled={loading}
          style={{
            flexShrink: 0,
            padding: "5px 12px",
            borderRadius: 6,
            border: "none",
            fontSize: 12,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            background: isDevModeOn
              ? "rgba(255,255,255,0.08)"
              : "rgba(100,140,255,0.85)",
            color: isDevModeOn ? "rgba(255,255,255,0.5)" : "#fff",
            display: "flex",
            alignItems: "center",
            gap: 5,
            transition: "background 0.15s",
          }}
        >
          {loading && <LoaderCircle size={11} className="animate-spin" />}
          {isDevModeOn ? "Desactiver" : "Activer"}
        </button>
      </div>

      {ollamaError && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.2)",
          }}
        >
          <TriangleAlert
            size={12}
            style={{
              color: "rgba(255,100,100,0.8)",
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <p
            style={{ fontSize: 11, color: "rgba(255,120,120,0.9)", margin: 0 }}
          >
            {ollamaError}
          </p>
        </div>
      )}
    </div>
  );
};

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { isBasicTier, onStartCheckout } = usePlan();
  const warmupStatus = useStartupWarmupStatus();
  const [activeTab, setActiveTab] = useState<"dictation" | "dictionary">(
    "dictation",
  );

  const shouldShowWarmupNotice =
    warmupStatus &&
    warmupStatus.phase !== "idle" &&
    warmupStatus.phase !== "ready";

  const tabs = [
    {
      id: "dictation" as const,
      label: t("settings.general.tabs.dictation", {
        defaultValue: "Dicter",
      }),
    },
    { id: "dictionary" as const, label: t("dictionary.tab") },
  ];

  return (
    <div className="w-full">
      <div className="general-settings-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-active={activeTab === tab.id ? "true" : "false"}
            className="general-settings-tab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "dictation" && (
        <div
          role="tabpanel"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {shouldShowWarmupNotice && (
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 16px",
              }}
              className={`rounded-[10px] border text-[12px] ${
                warmupStatus.phase === "failed"
                  ? "border-red-400/30 bg-red-400/10 text-red-100"
                  : "border-logo-primary/25 bg-logo-primary/10 text-white/80"
              }`}
            >
              <div
                style={{ marginTop: 2, flexShrink: 0 }}
                className={`flex h-7 w-7 items-center justify-center rounded-full ${
                  warmupStatus.phase === "failed"
                    ? "bg-red-400/15 text-red-300"
                    : "bg-logo-primary/15 text-logo-primary"
                }`}
              >
                {warmupStatus.phase === "failed" ? (
                  <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <LoaderCircle
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium leading-5">{warmupStatus.message}</p>
                <p style={{ marginTop: 4 }} className="leading-5 text-white/55">
                  {warmupStatus.detail ||
                    getStartupWarmupFallbackDetail(warmupStatus)}
                </p>
              </div>
            </div>
          )}

          {isBasicTier && (
            <div style={{ marginBottom: 16 }}>
              <FeatureGateHint
                tone="premium"
                title={t("basic.shortcutsLocked", {
                  defaultValue: "Custom shortcuts are a Premium feature",
                })}
                description={t("basic.shortcutsLockedDescription", {
                  defaultValue:
                    "On Basic, the default dictation flow still works, but editing shortcuts stays locked until you upgrade.",
                })}
                actionLabel={t("basic.upgrade", {
                  defaultValue: "Upgrade to Premium",
                })}
                onAction={async () => {
                  const url = await onStartCheckout();
                  if (url) window.open(url, "_blank");
                }}
              />
            </div>
          )}

          <SettingsGroup
            title={t("settings.general.tabs.audio", {
              defaultValue: "Audio",
            })}
          >
            <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
          </SettingsGroup>

          <SettingsGroup
            title={t("settings.general.recordingMode.label")}
            description={t("settings.general.recordingMode.description")}
          >
            <RecordingModeSelector grouped={true} />
          </SettingsGroup>

          <SettingsGroup
            title={t("settings.general.tabs.primaryShortcut", {
              defaultValue: "Raccourci principal",
            })}
          >
            <ShortcutInput
              shortcutId="transcribe"
              grouped={true}
              disabled={isBasicTier}
            />
          </SettingsGroup>

          <SettingsGroup title="Dev workflow">
            <DevModeToggle />
          </SettingsGroup>
        </div>
      )}

      {activeTab === "dictionary" && (
        <div role="tabpanel">
          <DictionarySettings />
        </div>
      )}
    </div>
  );
};

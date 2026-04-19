import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, LoaderCircle, TriangleAlert, Zap } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { commands } from "@/bindings";
import { listen } from "@tauri-apps/api/event";

const DEV_PROMPT_ID = "dev_clean_llm_prompt";
const DEV_PROMPT_NAME = "Clean for LLM";
const DEV_PROMPT_TEXT =
  "Convert this rough voice dictation into a clear, structured prompt for an AI assistant. Rules:\n1. Remove filler words (uh, um, like, you know)\n2. Fix grammar and sentence structure\n3. Preserve all technical terms, variable names, and intent exactly\n4. Keep it concise - one clear request\n5. Do not add explanations or preamble\n\nReturn only the cleaned prompt.\n\nDictation:\n${output}";

const PROVIDER_ID = "vocalype-llm";
const MODEL_ID = "qwen2.5-coder:0.5b";

interface SetupProgress {
  step: "binary" | "model" | "starting" | "done";
  pct: number;
  label: string;
}

export const DevWorkflowToggle: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-mode is active once the LLM is set up and enabled.
  const isAutoModeActive = settings?.llm_auto_mode === true;

  // Subscribe to progress events during first-time setup.
  useEffect(() => {
    if (!loading) return;
    const unlisten = listen<SetupProgress>("llm-setup-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loading]);

  const setup = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      // 1. Download binary + model (if needed) and start server.
      const setupResult = await commands.setupLlamaServer();
      if (setupResult.status === "error") {
        setError(setupResult.error);
        return;
      }

      // 2. Switch post-process provider to vocalype-llm.
      const providerResult = await commands.setPostProcessProvider(PROVIDER_ID);
      if (providerResult.status === "error") {
        setError(providerResult.error);
        return;
      }

      // 3. Set model.
      const modelResult = await commands.changePostProcessModelSetting(
        PROVIDER_ID,
        MODEL_ID,
      );
      if (modelResult.status === "error") {
        setError(modelResult.error);
        return;
      }

      // 4. Ensure the "Clean for LLM" prompt exists.
      const existing = settings?.post_process_prompts?.find(
        (p) => p.id === DEV_PROMPT_ID,
      );
      if (!existing) {
        const promptResult = await commands.addPostProcessPrompt(
          DEV_PROMPT_NAME,
          DEV_PROMPT_TEXT,
        );
        if (promptResult.status === "error") {
          setError(promptResult.error);
          return;
        }
      }

      // 5. Select the prompt.
      const selectResult =
        await commands.setPostProcessSelectedPrompt(DEV_PROMPT_ID);
      if (selectResult.status === "error") {
        setError(selectResult.error);
        return;
      }

      // 6. Enable auto-mode — LLM fires automatically when code context is detected.
      updateSetting("llm_auto_mode", true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [settings, updateSetting]);

  const disable = useCallback(async () => {
    updateSetting("llm_auto_mode", false);
    setError(null);
    await commands.stopLlamaServer().catch(() => {});
  }, [updateSetting]);

  const progressLabel = progress
    ? progress.step === "done"
      ? null
      : `${progress.label} (${progress.pct}%)`
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 10,
        border: isAutoModeActive
          ? "1px solid rgba(100,200,120,0.35)"
          : "1px solid rgba(255,255,255,0.07)",
        background: isAutoModeActive
          ? "rgba(100,200,120,0.05)"
          : "rgba(255,255,255,0.03)",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isAutoModeActive ? (
          <CheckCircle
            size={15}
            style={{ color: "rgba(100,200,120,0.9)", flexShrink: 0 }}
          />
        ) : (
          <Zap
            size={15}
            style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,255,255,0.9)",
              margin: 0,
            }}
          >
            {t("settings.advanced.devWorkflow.label", {
              defaultValue: "Auto-LLM",
            })}
          </p>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              margin: "2px 0 0",
            }}
          >
            {isAutoModeActive
              ? t("settings.advanced.devWorkflow.activeDescription", {
                  defaultValue:
                    "Actif — LLM s'active automatiquement quand tu codes",
                })
              : t("settings.advanced.devWorkflow.description", {
                  defaultValue:
                    "Nettoie ta dictée automatiquement quand tu codes (LLM local, 100% privé)",
                })}
          </p>
        </div>
        <button
          type="button"
          onClick={isAutoModeActive ? disable : setup}
          disabled={loading}
          style={{
            flexShrink: 0,
            padding: "5px 12px",
            borderRadius: 6,
            border: "none",
            fontSize: 12,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            background: isAutoModeActive
              ? "rgba(255,255,255,0.08)"
              : "rgba(100,200,120,0.85)",
            color: isAutoModeActive ? "rgba(255,255,255,0.5)" : "#fff",
            display: "flex",
            alignItems: "center",
            gap: 5,
            transition: "background 0.15s",
          }}
        >
          {loading && <LoaderCircle size={11} className="animate-spin" />}
          {isAutoModeActive
            ? t("settings.advanced.devWorkflow.deactivate", {
                defaultValue: "Désactiver",
              })
            : t("settings.advanced.devWorkflow.activate", {
                defaultValue: "Activer",
              })}
        </button>
      </div>

      {/* Progress bar during first-time setup */}
      {loading && progress && progress.step !== "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress.pct}%`,
                background: "rgba(100,200,120,0.8)",
                transition: "width 0.3s ease",
                borderRadius: 2,
              }}
            />
          </div>
          {progressLabel && (
            <p
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.35)",
                margin: 0,
              }}
            >
              {progressLabel}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
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
            {error}
          </p>
        </div>
      )}
    </div>
  );
};

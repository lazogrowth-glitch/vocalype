import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, TriangleAlert, Zap } from "lucide-react";
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

export const DevWorkflowToggle: React.FC = () => {
  const { t } = useTranslation();
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
        setOllamaError(
          t("settings.advanced.devWorkflow.errors.checkFailed", {
            defaultValue: "Impossible de vérifier Ollama. Réessaie.",
          }),
        );
        return;
      }

      if (!status.data.available) {
        const startResult = await commands.startOllamaServe();
        if (startResult.status === "error") {
          setOllamaError(
            t("settings.advanced.devWorkflow.errors.notInstalled", {
              defaultValue:
                "Ollama n'est pas installé. Installe-le sur ollama.com puis réessaie.",
            }),
          );
          return;
        }
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const retry = await commands.checkOllamaStatus();
          if (retry.status === "error") break;
          if (retry.status === "ok" && retry.data.available) {
            status = retry;
            break;
          }
        }
        if (status.status !== "ok" || !status.data.available) {
          setOllamaError(
            t("settings.advanced.devWorkflow.errors.notStarted", {
              defaultValue:
                "Ollama n'a pas démarré. Vérifie que l'installation est complète.",
            }),
          );
          return;
        }
      }

      let model = pickBestModel(status.data.models);

      if (!model) {
        setOllamaError(
          t("settings.advanced.devWorkflow.errors.downloading", {
            defaultValue: "Téléchargement de qwen2.5 en cours...",
          }),
        );
        const pullResult = await commands.pullOllamaModel("qwen2.5");
        if (pullResult.status === "error") {
          setOllamaError(
            t("settings.advanced.devWorkflow.errors.downloadFailed", {
              defaultValue: "Échec du téléchargement : {{error}}",
              error: pullResult.error,
            }),
          );
          return;
        }
        const afterPull = await commands.checkOllamaStatus();
        model =
          afterPull.status === "ok"
            ? pickBestModel(afterPull.data.models)
            : null;
        if (!model) {
          setOllamaError(
            t("settings.advanced.devWorkflow.errors.modelNotFound", {
              defaultValue:
                "Modèle téléchargé mais introuvable. Redémarre l'app.",
            }),
          );
          return;
        }
        setOllamaError(null);
      }

      const providerResult = await commands.setPostProcessProvider("ollama");
      if (providerResult.status === "error") {
        setOllamaError(providerResult.error);
        return;
      }

      const modelResult = await commands.changePostProcessModelSetting(
        "ollama",
        model,
      );
      if (modelResult.status === "error") {
        setOllamaError(modelResult.error);
        return;
      }

      const existing = settings?.post_process_prompts?.find(
        (p) => p.id === DEV_PROMPT_ID,
      );
      if (!existing) {
        const promptResult = await commands.addPostProcessPrompt(
          DEV_PROMPT_NAME,
          DEV_PROMPT_TEXT,
        );
        if (promptResult.status === "error") {
          setOllamaError(promptResult.error);
          return;
        }
      }

      const selectResult =
        await commands.setPostProcessSelectedPrompt(DEV_PROMPT_ID);
      if (selectResult.status === "error") {
        setOllamaError(selectResult.error);
        return;
      }

      updateSetting("post_process_enabled", true);
    } finally {
      setLoading(false);
    }
  }, [settings, updateSetting, t]);

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
            {t("settings.advanced.devWorkflow.label", {
              defaultValue: "Clean for LLM",
            })}
          </p>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              margin: "2px 0 0",
            }}
          >
            {isDevModeOn
              ? t("settings.advanced.devWorkflow.activeDescription", {
                  defaultValue:
                    "Actif via Ollama{{model}} — prompt reformaté avant de coller",
                  model: activeModel ? ` - ${activeModel}` : "",
                })
              : t("settings.advanced.devWorkflow.description", {
                  defaultValue:
                    "Reformate ta dictée en prompt clair via Ollama (local, 100% privé)",
                })}
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
          {isDevModeOn
            ? t("settings.advanced.devWorkflow.deactivate", {
                defaultValue: "Désactiver",
              })
            : t("settings.advanced.devWorkflow.activate", {
                defaultValue: "Activer",
              })}
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

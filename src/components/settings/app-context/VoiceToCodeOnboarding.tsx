import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, X, LoaderCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSettings } from "../../../hooks/useSettings";
import { commands } from "@/bindings";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { listen } from "@tauri-apps/api/event";

interface VoiceToCodeOnboardingProps {
  onDismiss: () => void;
  onOpenSettings: (section: string) => void;
}

interface SetupProgress {
  step: "binary" | "model" | "starting" | "done";
  pct: number;
  label: string;
}

const PROVIDER_ID = "vocalype-llm";
const MODEL_ID = "qwen3:0.6b";
const DEV_PROMPT_ID = "dev_clean_llm_prompt";
const DEV_PROMPT_NAME = "Clean for LLM";
const DEV_PROMPT_TEXT =
  "Convert this rough voice dictation into a clear, structured prompt for an AI assistant. Rules:\n1. Remove filler words (uh, um, like, you know)\n2. Fix grammar and sentence structure\n3. Preserve all technical terms, variable names, and intent exactly\n4. Keep it concise - one clear request\n5. Do not add explanations or preamble\n\nReturn only the cleaned prompt.\n\nDictation:\n${output}";

export const VoiceToCodeOnboarding: React.FC<VoiceToCodeOnboardingProps> = ({
  onDismiss,
}) => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const modalRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss, loading]);

  // Subscribe to download progress
  useEffect(() => {
    if (!loading) return;
    const unlisten = listen<SetupProgress>("llm-setup-progress", (e) => {
      setProgress(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loading]);

  const activate = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const setupResult = await commands.setupLlamaServer();
      if (setupResult.status === "error") {
        setError(getUserFacingErrorMessage(setupResult.error, { t }));
        return;
      }

      await commands.setPostProcessProvider(PROVIDER_ID);
      await commands.changePostProcessModelSetting(PROVIDER_ID, MODEL_ID);

      const existing = settings?.post_process_prompts?.find(
        (p) => p.id === DEV_PROMPT_ID,
      );
      if (!existing) {
        await commands.addPostProcessPrompt(DEV_PROMPT_NAME, DEV_PROMPT_TEXT);
      }
      await commands.setPostProcessSelectedPrompt(DEV_PROMPT_ID);
      updateSetting("llm_auto_mode", true);

      setDone(true);
      setTimeout(onDismiss, 1500);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, { t }));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [settings, updateSetting, onDismiss]);

  const progressLabel =
    progress && progress.step !== "done"
      ? `${progress.label} — ${progress.pct}%`
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pb-6"
      style={{ pointerEvents: "none" }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vtc-onboarding-title"
        className="voca-surface w-full max-w-[380px] shadow-2xl"
        style={{ pointerEvents: "auto" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5 rounded-md border border-white/10 bg-white/5 p-1.5">
              <Sparkles size={14} className="text-white/60" />
            </div>
            <div>
              <h2
                id="vtc-onboarding-title"
                className="text-[14px] font-semibold text-white leading-snug"
              >
                {t("voiceToCode.onboarding.title", {
                  defaultValue: "Nettoyer ta dictée automatiquement ?",
                })}
              </h2>
              <p className="mt-1 text-[11.5px] text-white/45 leading-relaxed">
                {t("voiceToCode.onboarding.subtitle", {
                  defaultValue:
                    "Un petit modèle IA (400 MB) tourne localement et corrige ta dictée à chaque fois que tu codes. 100 % privé.",
                })}
              </p>
            </div>
          </div>
          {!loading && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 ml-2 mt-0.5 rounded p-1 text-white/30 hover:text-white/60 transition-colors"
              aria-label={t("common.dismiss", { defaultValue: "Fermer" })}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Progress bar */}
        {loading && (
          <div className="px-5 pb-3">
            <div className="h-1 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-400/80 transition-all duration-300"
                style={{ width: `${progress?.pct ?? 5}%` }}
              />
            </div>
            {progressLabel && (
              <p className="mt-1.5 text-[10px] text-white/35">
                {progressLabel}
              </p>
            )}
          </div>
        )}

        {/* Done state */}
        {done && (
          <div className="px-5 pb-4 flex items-center gap-2 text-green-400/90">
            <CheckCircle size={13} />
            <p className="text-[12px]">
              {t("voiceToCode.onboarding.done", { defaultValue: "Activé !" })}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-5 pb-3">
            <p className="text-[11px] text-red-400/80">{error}</p>
          </div>
        )}

        {/* Actions */}
        {!done && (
          <div className="border-t border-white/6 px-4 py-3 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              disabled={loading}
            >
              {t("voiceToCode.onboarding.later", { defaultValue: "Plus tard" })}
            </Button>
            <button
              type="button"
              onClick={activate}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 rounded-md text-[12px] font-medium text-white bg-green-500/80 hover:bg-green-500/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading && <LoaderCircle size={11} className="animate-spin" />}
              {loading
                ? t("voiceToCode.onboarding.installing", {
                    defaultValue: "Installation…",
                  })
                : t("voiceToCode.onboarding.activate", {
                    defaultValue: "Activer (400 MB)",
                  })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

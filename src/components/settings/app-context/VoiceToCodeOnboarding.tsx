import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, HardDrive, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSettings } from "../../../hooks/useSettings";

interface VoiceToCodeOnboardingProps {
  onDismiss: () => void;
  onOpenSettings: (section: string) => void;
}

export const VoiceToCodeOnboarding: React.FC<VoiceToCodeOnboardingProps> = ({
  onDismiss,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const { updateSetting } = useSettings();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const chooseLocal = () => {
    updateSetting("voice_to_code_enabled", true);
    onOpenSettings("app-context");
    onDismiss();
  };

  const chooseCloud = () => {
    updateSetting("voice_to_code_enabled", true);
    onDismiss();
  };

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
        className="voca-surface w-full max-w-[400px] shadow-2xl"
        style={{ pointerEvents: "auto" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-1">
              {t("voiceToCode.onboarding.badge", { defaultValue: "Nouveau" })}
            </p>
            <h2
              id="vtc-onboarding-title"
              className="text-[16px] font-semibold text-white leading-snug"
            >
              {t("voiceToCode.onboarding.title", {
                defaultValue: "Voice-to-Code disponible",
              })}
            </h2>
            <p className="mt-1 text-[12px] text-white/45 leading-relaxed">
              {t("voiceToCode.onboarding.subtitle", {
                defaultValue:
                  "Transforme ta dictée en code propre dans VS Code, Cursor et autres éditeurs.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 ml-3 mt-0.5 rounded p-1 text-white/30 hover:text-white/60 transition-colors"
            aria-label={t("common.dismiss", { defaultValue: "Fermer" })}
          >
            <X size={14} />
          </button>
        </div>

        {/* Options */}
        <div className="px-3 pb-3 flex flex-col gap-2">
          {/* Local */}
          <button
            type="button"
            onClick={chooseLocal}
            className="group flex items-start gap-3 rounded-lg border border-white/8 bg-white/3 p-4 text-left transition-colors hover:border-white/20 hover:bg-white/6"
          >
            <div className="shrink-0 mt-0.5 rounded-md border border-white/10 bg-white/5 p-1.5">
              <HardDrive size={14} className="text-white/60" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white">
                {t("voiceToCode.onboarding.localTitle", {
                  defaultValue: "Modèle local (Ollama)",
                })}
              </p>
              <p className="mt-0.5 text-[11.5px] text-white/40 leading-relaxed">
                {t("voiceToCode.onboarding.localDesc", {
                  defaultValue:
                    "100 % privé · Hors-ligne · Tourne sur ta machine (~4 GB)",
                })}
              </p>
            </div>
          </button>

          {/* Cloud */}
          <button
            type="button"
            onClick={chooseCloud}
            className="group flex items-start gap-3 rounded-lg border border-white/8 bg-white/3 p-4 text-left transition-colors hover:border-white/20 hover:bg-white/6"
          >
            <div className="shrink-0 mt-0.5 rounded-md border border-white/10 bg-white/5 p-1.5">
              <Cloud size={14} className="text-white/60" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white">
                {t("voiceToCode.onboarding.cloudTitle", {
                  defaultValue: "LLM cloud (OpenAI, Groq…)",
                })}
              </p>
              <p className="mt-0.5 text-[11.5px] text-white/40 leading-relaxed">
                {t("voiceToCode.onboarding.cloudDesc", {
                  defaultValue:
                    "Utilise ton provider Post-traitement · Envoie du texte à des serveurs",
                })}
              </p>
            </div>
          </button>
        </div>

        <div className="border-t border-white/6 px-5 py-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t("voiceToCode.onboarding.later", { defaultValue: "Plus tard" })}
          </Button>
        </div>
      </div>
    </div>
  );
};

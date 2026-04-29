import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useModelStore } from "@/stores/modelStore";
import type { ModelInfo } from "@/bindings";

export const TranscriptionEngineCard: React.FC = () => {
  const { t } = useTranslation();
  const { currentModel, models, deleteModel } = useModelStore();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const modelInfo: ModelInfo | undefined = models.find(
    (m) => m.id === currentModel,
  );

  const handleReset = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setResetting(true);
    setConfirming(false);
    await deleteModel(currentModel);
    setResetting(false);
  };

  const displayName = modelInfo?.name ?? currentModel ?? "—";

  return (
    <div className="voca-row grouped">
      <div className="min-w-0 flex-1">
        <p className="voca-item-name">
          {t("settings.advanced.transcriptionEngine.title", {
            defaultValue: "Moteur de transcription",
          })}
        </p>
        <p className="voca-item-desc">{displayName}</p>
      </div>
      {currentModel && (
        <button
          type="button"
          onClick={handleReset}
          onBlur={() => setConfirming(false)}
          disabled={resetting}
          className={`shrink-0 text-xs px-3 py-1.5 rounded-md border transition-colors ${
            confirming
              ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "border-white/10 bg-white/5 text-white/50 hover:text-white/80 hover:border-white/20"
          }`}
        >
          {resetting
            ? t("settings.advanced.transcriptionEngine.resetting", {
                defaultValue: "...",
              })
            : confirming
              ? t("settings.advanced.transcriptionEngine.confirmReset", {
                  defaultValue: "Confirmer",
                })
              : t("settings.advanced.transcriptionEngine.reset", {
                  defaultValue: "Réinitialiser",
                })}
        </button>
      )}
    </div>
  );
};

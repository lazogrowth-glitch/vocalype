import React from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import {
  getTranslatedModelName,
  getTranslatedModelDescription,
} from "../../lib/utils/modelTranslation";

const LAUNCH_MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  onModelSelect: (modelId: string) => void;
  hasGeminiKey?: boolean;
}

const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  currentModelId,
  onModelSelect,
  hasGeminiKey = false,
}) => {
  const { t } = useTranslation();
  const downloadedModels = models.filter(
    (m) => m.id === LAUNCH_MODEL_ID && m.is_downloaded,
  );
  void hasGeminiKey;

  const handleModelClick = (modelId: string) => {
    onModelSelect(modelId);
  };

  return (
    <div
      className="absolute bottom-full start-0 z-50 mb-2 max-h-[60vh] w-64 overflow-y-auto rounded-[10px] border border-white/10 py-1"
      style={{
        background: "linear-gradient(180deg,#1b1b1e,#131316)",
        boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
      }}
    >
      {downloadedModels.length > 0 ? (
        <div>
          {downloadedModels.map((model) => (
            <div
              key={model.id}
              onClick={() => handleModelClick(model.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleModelClick(model.id);
                }
              }}
              tabIndex={0}
              role="button"
              className={`mx-1 w-auto rounded-[7px] px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-0 ${
                currentModelId === model.id
                  ? "bg-[rgba(212,168,88,0.14)] text-logo-primary"
                  : "cursor-pointer text-white/90 hover:bg-[#1c1c22] hover:text-logo-primary"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-current">
                    {getTranslatedModelName(model, t)}
                    {model.is_custom && (
                      <span className="ms-1.5 text-[10px] font-medium text-text/40 uppercase">
                        {t("modelSelector.custom")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text/40 italic pe-4">
                    {getTranslatedModelDescription(model, t)}
                  </div>
                </div>
                {currentModelId === model.id && (
                  <div className="text-xs text-logo-primary">
                    {t("modelSelector.active")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 text-sm text-text/60">
          {t("modelSelector.noModelsAvailable")}
        </div>
      )}
    </div>
  );
};

export default ModelDropdown;

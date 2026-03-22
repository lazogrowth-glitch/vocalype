import React from "react";
import { useTranslation } from "react-i18next";
import { Rocket, ShieldCheck, Sparkles, TimerReset } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";

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

interface ProductMode {
  id: string;
  label: string;
  description: string;
  modelId: string;
  model: ModelInfo | null;
}

interface AdaptiveProfileSnapshot {
  active_runtime_model_id?: string | null;
}

interface ProductModesGridProps {
  productModes: ProductMode[];
  currentModel: string | null;
  adaptiveProfile: AdaptiveProfileSnapshot | null;
  onSelect: (modelId: string) => void;
}

export const ProductModesGrid: React.FC<ProductModesGridProps> = ({
  productModes,
  currentModel,
  adaptiveProfile,
  onSelect,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {productModes.map(({ id, label, description, modelId, model }) => {
        const isActiveMode =
          (adaptiveProfile?.active_runtime_model_id || currentModel) ===
          modelId;
        const meta = PRODUCT_MODE_META[id as keyof typeof PRODUCT_MODE_META];
        const Icon = meta.icon;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(modelId)}
            className={`flex w-full items-center gap-4 rounded-[10px] border px-4 py-3.5 text-left transition-all ${
              isActiveMode
                ? "border-logo-primary/30 bg-logo-primary/[0.08]"
                : "border-white/8 bg-white/[0.03] hover:bg-white/[0.05]"
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${meta.tone}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
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
  );
};

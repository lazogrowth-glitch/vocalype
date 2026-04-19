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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            style={{ padding: "22px 24px" }}
            className={`flex min-h-[88px] w-full items-center gap-4 rounded-[10px] border text-left transition-all ${
              isActiveMode
                ? "border-accent/40 bg-surface-elevated"
                : "border-border bg-row hover:border-border-strong hover:bg-surface"
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border ${meta.tone}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <p className="text-[14.5px] font-semibold text-white">
                  {label}
                </p>
                {id === "auto" && (
                  <span className="voca-badge voca-badge-accent">
                    {t("onboarding.recommended")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-5 text-white/50">
                {description}
              </p>
              <p className="mt-1 text-[11.5px] text-white/34">
                {model ? getTranslatedModelName(model, t) : modelId}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
};

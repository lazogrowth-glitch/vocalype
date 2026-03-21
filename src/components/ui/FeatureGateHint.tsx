import React from "react";
import { Cpu, KeyRound, Lock, Sparkles } from "lucide-react";
import { Button } from "./Button";

type FeatureGateTone = "info" | "warning" | "premium";

interface FeatureGateHintProps {
  title: string;
  description: string;
  tone?: FeatureGateTone;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  className?: string;
}

const toneStyles: Record<
  FeatureGateTone,
  {
    container: string;
    icon: string;
    iconNode: React.ReactNode;
    buttonVariant: "primary" | "primary-soft" | "secondary";
  }
> = {
  info: {
    container: "border-white/8 bg-white/[0.03]",
    icon: "border-white/10 bg-white/[0.06] text-white/75",
    iconNode: <KeyRound className="h-4 w-4" />,
    buttonVariant: "secondary",
  },
  warning: {
    container: "border-amber-500/25 bg-amber-500/10",
    icon: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    iconNode: <Cpu className="h-4 w-4" />,
    buttonVariant: "secondary",
  },
  premium: {
    container: "border-logo-primary/20 bg-logo-primary/10",
    icon: "border-logo-primary/20 bg-logo-primary/12 text-logo-primary",
    iconNode: <Sparkles className="h-4 w-4" />,
    buttonVariant: "primary-soft",
  },
};

export const FeatureGateHint: React.FC<FeatureGateHintProps> = ({
  title,
  description,
  tone = "info",
  actionLabel,
  onAction,
  className = "",
}) => {
  const style = toneStyles[tone];

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${style.container} ${className}`.trim()}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${style.icon}`}
        >
          {tone === "premium" && !actionLabel ? <Lock className="h-4 w-4" /> : style.iconNode}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-white/90">{title}</p>
          <p className="mt-1 text-[12px] leading-5 text-white/60">{description}</p>
          {actionLabel && onAction ? (
            <div className="mt-3">
              <Button
                type="button"
                variant={style.buttonVariant}
                size="sm"
                onClick={() => {
                  void onAction();
                }}
              >
                {actionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

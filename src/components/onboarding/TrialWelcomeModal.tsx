import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TrialWelcomeModalProps {
  onDismiss: () => void;
}

const FEATURE_KEYS = [
  "trial.feature1",
  "trial.feature2",
  "trial.feature3",
  "trial.feature4",
] as const;

export const TrialWelcomeModal: React.FC<TrialWelcomeModalProps> = ({
  onDismiss,
}) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus first focusable on open
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
        return;
      }
      if (e.key !== "Tab") return;
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
      onClick={(e) => {
        // Only dismiss if clicking the backdrop, not the card
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-modal-title"
        className="w-full max-w-[420px] rounded-xl border border-white/10 bg-[#181818] p-8 shadow-2xl"
      >
        <div className="mb-5 inline-flex items-center rounded-full border border-logo-primary/25 bg-logo-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-logo-primary">
          {t("trial.welcome.badge")}
        </div>

        <h2
          id="trial-modal-title"
          className="mb-2 text-[21px] font-semibold leading-snug text-white"
        >
          {t("trial.welcome.title")}
        </h2>
        <p className="mb-7 text-[13px] leading-relaxed text-white/45">
          {t("trial.welcome.subtitle")}
        </p>

        <ul className="mb-8 space-y-3.5">
          {FEATURE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center gap-3 text-[13px] text-white/75"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-logo-primary/15">
                <Check
                  size={10}
                  className="text-logo-primary"
                  strokeWidth={2.5}
                />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onDismiss}
        >
          {t("trial.welcome.cta")}
        </Button>
      </div>
    </div>
  );
};

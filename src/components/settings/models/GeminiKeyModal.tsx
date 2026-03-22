import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface GeminiKeyModalProps {
  show: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export const GeminiKeyModal: React.FC<GeminiKeyModalProps> = ({
  show,
  value,
  onChange,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;

    // Focus first focusable on open
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
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
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gemini-modal-title"
        className="bg-background border border-mid-gray/40 rounded-xl p-5 w-96 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 id="gemini-modal-title" className="text-base font-semibold">
            {t("settings.gemini.apiKeyRequired")}
          </h3>
          <p className="text-sm text-text/60 mt-1">
            {t("settings.gemini.apiKeyRequiredDescription")}
          </p>
        </div>
        <Input
          autoFocus
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
          }}
          placeholder={t("settings.gemini.apiKeyPlaceholder")}
          className="w-full"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("settings.gemini.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={!value.trim()}
          >
            {t("settings.gemini.save")}
          </Button>
        </div>
      </div>
    </div>
  );
};

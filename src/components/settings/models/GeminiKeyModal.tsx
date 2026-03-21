import React from "react";
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
        className="bg-background border border-mid-gray/40 rounded-xl p-5 w-96 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold">
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

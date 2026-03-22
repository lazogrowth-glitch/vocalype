import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export type CloudSttProvider = "groq" | "mistral" | "deepgram";

const PROVIDER_LABELS: Record<
  CloudSttProvider,
  { name: string; placeholder: string; docUrl: string }
> = {
  groq: {
    name: "Groq",
    placeholder: "gsk_...",
    docUrl: "https://console.groq.com/keys",
  },
  mistral: {
    name: "Mistral",
    placeholder: "...",
    docUrl: "https://console.mistral.ai/api-keys",
  },
  deepgram: {
    name: "Deepgram",
    placeholder: "...",
    docUrl: "https://console.deepgram.com/",
  },
};

interface CloudSttKeyModalProps {
  show: boolean;
  provider: CloudSttProvider;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export const CloudSttKeyModal: React.FC<CloudSttKeyModalProps> = ({
  show,
  provider,
  value,
  onChange,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const info = PROVIDER_LABELS[provider];

  useEffect(() => {
    if (!show) return;
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !focusable || focusable.length === 0) return;
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
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        className="bg-background border border-mid-gray/40 rounded-xl p-5 w-96 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold">
            {t("cloudStt.keyRequired", {
              name: info.name,
              defaultValue: "{{name}} API Key Required",
            })}
          </h3>
          <p className="text-sm text-text/60 mt-1">
            {t("cloudStt.keyDescription", {
              name: info.name,
              defaultValue: "Enter your {{name}} API key to use this provider.",
            })}{" "}
            <a
              href={info.docUrl}
              target="_blank"
              rel="noreferrer"
              className="underline text-logo-primary/80"
            >
              {t("cloudStt.getKey", { defaultValue: "Get a key →" })}
            </a>
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
          placeholder={info.placeholder}
          className="w-full"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={!value.trim()}
          >
            {t("common.save", { defaultValue: "Save" })}
          </Button>
        </div>
      </div>
    </div>
  );
};

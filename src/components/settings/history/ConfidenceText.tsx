import React from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptionConfidencePayload } from "@/bindings";

interface ConfidenceTextProps {
  text: string;
  confidencePayload?: TranscriptionConfidencePayload | null;
  className?: string;
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.9) {
    return "text-emerald-500";
  }
  if (confidence >= 0.75) {
    return "text-text/90";
  }
  if (confidence >= 0.55) {
    return "text-amber-500";
  }
  return "text-orange-500 underline decoration-dotted underline-offset-2";
}

function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function confidenceLabel(engine: string): string {
  if (engine === "parakeet-v3") {
    return "Parakeet V3";
  }
  if (engine === "whisper") {
    return "Whisper";
  }
  return engine;
}

export const ConfidenceText: React.FC<ConfidenceTextProps> = ({
  text,
  confidencePayload,
  className = "",
}) => {
  const { t } = useTranslation();

  if (!confidencePayload) {
    return <p className={className}>{text}</p>;
  }

  const overall = percent(confidencePayload.overall_confidence);
  const engine = confidenceLabel(confidencePayload.engine);

  if (
    !confidencePayload.mapping_stable ||
    confidencePayload.words.length === 0
  ) {
    return (
      <div className="space-y-1">
        <p className={className}>{text}</p>
        <div className="text-[11px] text-text/45">
          {t("settings.history.transcriptionConfidence", {
            defaultValue: "{{engine}} confidence: {{overall}}",
            engine,
            overall,
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className={`${className} leading-6`}>
        {confidencePayload.words.map((word, index) => (
          <React.Fragment key={`${word.text}-${index}`}>
            {index > 0 ? " " : null}
            <span
              className={confidenceClass(word.confidence)}
              title={t("settings.history.wordConfidenceTitle", {
                defaultValue: "Confidence {{confidence}}",
                confidence: percent(word.confidence),
              })}
            >
              {word.text}
            </span>
          </React.Fragment>
        ))}
      </p>
      <div className="text-[11px] text-text/45">
        {t("settings.history.transcriptionConfidence", {
          defaultValue: "{{engine}} confidence: {{overall}}",
          engine,
          overall,
        })}
      </div>
    </div>
  );
};

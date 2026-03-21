import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { InfoTooltip } from "../ui/InfoTooltip";
import { useSettings } from "../../hooks/useSettings";

interface AdaptiveVocabularyToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AdaptiveVocabularyToggle: React.FC<AdaptiveVocabularyToggleProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("adaptive_vocabulary_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) =>
          updateSetting("adaptive_vocabulary_enabled", value)
        }
        isUpdating={isUpdating("adaptive_vocabulary_enabled")}
        label={
          <span className="flex items-center">
            {t("settings.advanced.adaptiveVocabulary.label", {
              defaultValue: "Vocabulaire adaptatif",
            })}
            <InfoTooltip content={t("tooltips.adaptiveVocabulary")} />
          </span>
        }
        description={t("settings.advanced.adaptiveVocabulary.description", {
          defaultValue:
            "Apprend des orthographes et termes par application sur cet appareil pour mieux guider Whisper.",
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      />
    );
  });

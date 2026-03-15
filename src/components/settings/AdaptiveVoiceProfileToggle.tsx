import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AdaptiveVoiceProfileToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AdaptiveVoiceProfileToggle: React.FC<AdaptiveVoiceProfileToggleProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("adaptive_voice_profile_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) =>
          updateSetting("adaptive_voice_profile_enabled", value)
        }
        isUpdating={isUpdating("adaptive_voice_profile_enabled")}
        label={t("settings.advanced.adaptiveVoiceProfile.label", {
          defaultValue: "Adaptive voice profile",
        })}
        description={t("settings.advanced.adaptiveVoiceProfile.description", {
          defaultValue:
            "Learn your speaking pace and pauses on this device to tune Whisper chunking and pause handling over time.",
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      />
    );
  });

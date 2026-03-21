import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { InfoTooltip } from "../ui/InfoTooltip";
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
        label={
          <span className="flex items-center">
            {t("settings.advanced.adaptiveVoiceProfile.label", {
              defaultValue: "Profil vocal adaptatif",
            })}
            <InfoTooltip content={t("tooltips.adaptiveVoiceProfile")} />
          </span>
        }
        description={t("settings.advanced.adaptiveVoiceProfile.description", {
          defaultValue:
            "Apprend ton rythme de parole et tes pauses sur cet appareil pour ajuster Whisper progressivement.",
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      />
    );
  });

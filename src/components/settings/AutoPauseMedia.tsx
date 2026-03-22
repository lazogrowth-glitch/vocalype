import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AutoPauseMediaProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AutoPauseMedia: React.FC<AutoPauseMediaProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("auto_pause_media") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(v) => updateSetting("auto_pause_media", v)}
        isUpdating={isUpdating("auto_pause_media")}
        label={t("settings.autoPauseMedia.label", {
          defaultValue: "Pause media when recording",
        })}
        description={t("settings.autoPauseMedia.description", {
          defaultValue:
            "Automatically pauses Spotify and other media players when recording starts, and resumes them when done.",
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);

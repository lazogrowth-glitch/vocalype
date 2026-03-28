import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface WakeWordToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const WakeWordToggle: React.FC<WakeWordToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("wake_word_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(v) => updateSetting("wake_word_enabled", v)}
        isUpdating={isUpdating("wake_word_enabled")}
        label={t("settings.wakeWord.label")}
        description={t("settings.wakeWord.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);

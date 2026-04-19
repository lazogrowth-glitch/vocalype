import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface StartupToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const StartupToggle: React.FC<StartupToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const autostartEnabled = getSetting("autostart_enabled") ?? false;

    const handleChange = (enabled: boolean) => {
      updateSetting("autostart_enabled", enabled);
      updateSetting("start_hidden", enabled);
    };

    return (
      <ToggleSwitch
        checked={autostartEnabled}
        onChange={handleChange}
        isUpdating={isUpdating("autostart_enabled") || isUpdating("start_hidden")}
        label={t("settings.advanced.startup.label", {
          defaultValue: "Lancer au démarrage",
        })}
        description={t("settings.advanced.startup.description", {
          defaultValue: "Démarre automatiquement en arrière-plan à l'ouverture de session.",
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      />
    );
  },
);

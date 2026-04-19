import React from "react";
import { useTranslation } from "react-i18next";
import { ShowOverlay } from "../ShowOverlay";
import { CustomWords } from "../CustomWords";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ShowTrayIcon } from "../ShowTrayIcon";
import { AutoSubmit } from "../AutoSubmit";
import { AppendTrailingSpace } from "../AppendTrailingSpace";
import { AdaptiveVocabularyToggle } from "../AdaptiveVocabularyToggle";
import { StartupToggle } from "../StartupToggle";
import { DevWorkflowToggle } from "../DevWorkflowToggle";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="w-full">
      <SettingsGroup title={t("settings.advanced.groups.app")}>
        <StartupToggle descriptionMode="tooltip" grouped={true} />
        <ShowTrayIcon descriptionMode="tooltip" grouped={true} />
        <ShowOverlay descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.output")}>
        <AutoSubmit descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.transcription")}>
        <CustomWords descriptionMode="tooltip" grouped />
        <AdaptiveVocabularyToggle descriptionMode="inline" grouped />
        <AppendTrailingSpace descriptionMode="tooltip" grouped={true} />
        <DevWorkflowToggle />
      </SettingsGroup>
    </div>
  );
};

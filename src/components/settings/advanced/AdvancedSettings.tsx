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
import { AppLanguageSelector } from "../AppLanguageSelector";
import {
  TranscribeFileButton,
  ExportHistoryButton,
  ClearAllHistoryButton,
  OpenRecordingsButton,
} from "../history/HistorySettings";
import { commands } from "@/bindings";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();

  const handleOpenRecordingsFolder = async () => {
    try {
      await commands.openRecordingsFolder();
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  return (
    <div className="w-full">
      <SettingsGroup title={t("settings.advanced.groups.app")}>
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
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

      <SettingsGroup
        title={t("settings.advanced.groups.history", {
          defaultValue: "Historique",
        })}
      >
        <div
          className="settings-group-card"
          style={{
            padding: "16px 20px",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <TranscribeFileButton />
          <ExportHistoryButton />
          <OpenRecordingsButton
            onClick={() => void handleOpenRecordingsFolder()}
            label={t("settings.history.openRecordingsFolder", {
              defaultValue: "Ouvrir le dossier",
            })}
          />
          <ClearAllHistoryButton onCleared={() => {}} />
        </div>
      </SettingsGroup>
    </div>
  );
};

import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ResetButton } from "../ui/ResetButton";
import {
  changeAppLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguageCode,
} from "../../i18n";
import { useSettings } from "@/hooks/useSettings";

interface AppLanguageSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AppLanguageSelector: React.FC<AppLanguageSelectorProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t, i18n } = useTranslation();
    const { settings, updateSetting, resetSetting, isUpdating } = useSettings();

    const currentLanguage = (settings?.app_language ||
      i18n.language) as SupportedLanguageCode;

    const languageOptions = SUPPORTED_LANGUAGES.map((lang) => ({
      value: lang.code,
      label: `${lang.nativeName} (${lang.name})`,
    }));

    const handleLanguageChange = (langCode: string) => {
      void changeAppLanguage(langCode);
      updateSetting("app_language", langCode);
    };

    return (
      <SettingContainer
        title={t("appLanguage.title")}
        description={t("appLanguage.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="flex items-center gap-2">
          <Dropdown
            options={languageOptions}
            selectedValue={currentLanguage}
            onSelect={handleLanguageChange}
            disabled={isUpdating("app_language")}
          />
          <ResetButton
            onClick={() => resetSetting("app_language")}
            disabled={isUpdating("app_language")}
          />
        </div>
      </SettingContainer>
    );
  });

AppLanguageSelector.displayName = "AppLanguageSelector";

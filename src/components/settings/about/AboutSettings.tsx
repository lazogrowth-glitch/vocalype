import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { AppDataDirectory } from "../AppDataDirectory";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { ExportImportSettings } from "../ExportImportSettings";
import { LogDirectory } from "../debug";
import VocalypeLogo from "../../icons/VocalypeLogo";

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.1.2");
      }
    };

    fetchVersion();
  }, []);

  return (
    <div className="w-full">
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <VocalypeLogo width={112} />
        <p className="text-[12px] text-white/30">
          {t("settings.about.versionLabel", {
            defaultValue: "Version v{{version}}",
            version,
          })}
        </p>
        <Button
          variant="secondary"
          size="md"
          className="inline-flex w-auto"
          onClick={() => openUrl("https://vocalype.com/privacy")}
        >
          {t("settings.about.privacyPolicy")}
        </Button>
      </section>

      <SettingsGroup title={t("settings.about.title")}>
        <AppLanguageSelector descriptionMode="tooltip" grouped={true} />
        <SettingContainer
          title={t("settings.about.version.title")}
          description={t("settings.about.version.description")}
          grouped={true}
        >
          <span className="text-[13px] text-white/40">
            {t("footer.version", {
              defaultValue: "v{{version}}",
              version,
            })}
          </span>
        </SettingContainer>

        <AppDataDirectory descriptionMode="tooltip" grouped={true} />
        <ExportImportSettings grouped={true} />
        <LogDirectory grouped={true} />
      </SettingsGroup>
    </div>
  );
};

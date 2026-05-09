import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { SettingContainer } from "../../ui/SettingContainer";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";

interface SupportPathsProps {
  grouped?: boolean;
}

export const SupportPaths: React.FC<SupportPathsProps> = ({
  grouped = true,
}) => {
  const { t } = useTranslation();
  const [logDir, setLogDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    commands
      .getLogDirPath()
      .then((result) => {
        if (!mounted) return;
        if (result.status === "ok") {
          setLogDir(result.data);
        } else {
          setError(getUserFacingErrorMessage(result.error, { t }));
        }
      })
      .catch((nextError) => {
        if (!mounted) return;
        setError(getUserFacingErrorMessage(nextError, { t }));
      });

    return () => {
      mounted = false;
    };
  }, [t]);

  return (
    <SettingContainer
      title={t("settings.debug.paths.title", {
        defaultValue: "Useful paths",
      })}
      description={t("settings.debug.paths.description", {
        defaultValue:
          "These locations help when you need to inspect local files or share a precise log path.",
      })}
      descriptionMode="inline"
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-3 text-[13px] leading-5 text-white/72">
        <div className="rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/38">
            {t("settings.debug.paths.logs", {
              defaultValue: "Logs",
            })}
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-white/78">
            {error ||
              logDir ||
              t("common.loading", {
                defaultValue: "Loading...",
              })}
          </p>
        </div>
        <div className="rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/38">
            {t("settings.debug.paths.settings", {
              defaultValue: "Settings",
            })}
          </p>
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="mt-1 break-all font-mono text-[12px] text-white/78">
            %APPDATA%/com.vocalype.desktop/settings_store.json
          </p>
        </div>
        <div className="rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-white/38">
            {t("settings.debug.paths.models", {
              defaultValue: "Models",
            })}
          </p>
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="mt-1 break-all font-mono text-[12px] text-white/78">
            %APPDATA%/com.vocalype.desktop/models
          </p>
        </div>
      </div>
    </SettingContainer>
  );
};

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";

interface LogDirectoryProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const LogDirectory: React.FC<LogDirectoryProps> = ({
  descriptionMode: _descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const [logDir, setLogDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLogDirectory = async () => {
      try {
        const result = await commands.getLogDirPath();
        if (result.status === "ok") {
          setLogDir(result.data);
        } else {
          setError(getUserFacingErrorMessage(result.error, { t }));
        }
      } catch (err) {
        setError(
          getUserFacingErrorMessage(err, {
            t,
            fallback: "Impossible de charger le dossier des journaux.",
          }),
        );
      } finally {
        setLoading(false);
      }
    };

    loadLogDirectory();
  }, []);

  const handleOpen = async () => {
    if (!logDir) return;
    try {
      await commands.openLogDir();
    } catch (openError) {
      console.error("Failed to open log directory:", openError);
    }
  };

  const truncateMiddle = (value: string) => {
    if (value.length <= 58) return value;
    return `${value.slice(0, 20)}...${value.slice(-24)}`;
  };

  return (
    <SettingContainer
      title={t("settings.debug.logDirectory.title")}
      description={
        logDir
          ? truncateMiddle(logDir)
          : t("settings.debug.logDirectory.description")
      }
      descriptionMode="inline"
      grouped={grouped}
    >
      <Button
        onClick={handleOpen}
        variant="secondary"
        size="sm"
        disabled={loading || !!error || !logDir}
      >
        {t("common.open")}
      </Button>
    </SettingContainer>
  );
};

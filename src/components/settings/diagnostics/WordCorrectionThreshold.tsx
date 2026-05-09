import React from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "../../ui/Slider";
import { useDebouncedSetting, useSettings } from "../../../hooks/useSettings";

interface WordCorrectionThresholdProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const WordCorrectionThreshold: React.FC<
  WordCorrectionThresholdProps
> = ({ descriptionMode = "tooltip", grouped = false }) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const handleThresholdChange = useDebouncedSetting(
    "word_correction_threshold",
    200,
  );

  return (
    <Slider
      value={settings?.word_correction_threshold ?? 0.18}
      onChange={handleThresholdChange}
      min={0.0}
      max={1.0}
      label={t("settings.debug.wordCorrectionThreshold.title")}
      description={t("settings.debug.wordCorrectionThreshold.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    />
  );
};

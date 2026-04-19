import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingsGroup } from "../../ui";

export const VoiceToCode: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, settings } = useSettings();

  const enabled = getSetting("voice_to_code_enabled") ?? false;

  const activeProviderId = settings?.post_process_provider_id ?? "";
  const activeProvider   = settings?.post_process_providers?.find(
    (p) => p.id === activeProviderId,
  );
  const activeModel = settings?.post_process_models?.[activeProviderId] ?? "";
  const isReady     = !!activeProvider && !!activeModel.trim();

  const description = (): string => {
    if (isReady) {
      return t("voiceToCode.readyDescription", {
        defaultValue: `Utilisera ${activeProvider!.label} · ${activeModel}`,
        provider: activeProvider!.label,
        model: activeModel,
      });
    }
    return t("voiceToCode.notReadyDescription", {
      defaultValue:
        "Aucun modèle configuré — active Post-traitement d'abord",
    });
  };

  return (
    <SettingsGroup
      title={t("voiceToCode.title", { defaultValue: "Voice-to-Code" })}
    >
      <ToggleSwitch
        label={t("voiceToCode.enableLabel", {
          defaultValue: "Transformer la dictée en code dans les éditeurs",
        })}
        description={description()}
        checked={enabled}
        onChange={(v) => updateSetting("voice_to_code_enabled", v)}
        disabled={!isReady}
      />
    </SettingsGroup>
  );
};

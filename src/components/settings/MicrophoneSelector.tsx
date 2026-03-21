import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ResetButton } from "../ui/ResetButton";
import { useSettings } from "../../hooks/useSettings";

interface MicrophoneSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const MicrophoneSelector: React.FC<MicrophoneSelectorProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const {
      getSetting,
      updateSetting,
      resetSetting,
      isUpdating,
      isLoading,
      audioDevices,
      refreshAudioDevices,
    } = useSettings();

    const selectedMicrophone =
      getSetting("selected_microphone_index") === "default"
        ? "default"
        : getSetting("selected_microphone_index") || "default";

    const handleMicrophoneSelect = async (deviceIndex: string) => {
      await updateSetting("selected_microphone_index", deviceIndex);
    };

    const handleReset = async () => {
      await resetSetting("selected_microphone_index");
    };

    const nameCounts = audioDevices.reduce<Record<string, number>>((acc, device) => {
      acc[device.name] = (acc[device.name] ?? 0) + 1;
      return acc;
    }, {});

    const microphoneOptions = audioDevices.map((device) => ({
      value: device.index,
      label:
        nameCounts[device.name] > 1 && device.index !== "default"
          ? `${device.name} (${device.index})`
          : device.name,
    }));

    return (
      <SettingContainer
        title={t("settings.sound.microphone.title")}
        description={t("settings.sound.microphone.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="flex w-full items-center justify-between gap-2 min-[760px]:w-auto min-[760px]:justify-start">
          <Dropdown
            options={microphoneOptions}
            selectedValue={selectedMicrophone}
            onSelect={handleMicrophoneSelect}
            placeholder={
              isLoading || audioDevices.length === 0
                ? t("settings.sound.microphone.loading")
                : t("settings.sound.microphone.placeholder")
            }
            disabled={
              isUpdating("selected_microphone_index") ||
              isLoading ||
              audioDevices.length === 0
            }
            onRefresh={refreshAudioDevices}
          />
          <ResetButton
            onClick={handleReset}
            disabled={isUpdating("selected_microphone_index") || isLoading}
          />
        </div>
      </SettingContainer>
    );
  },
);

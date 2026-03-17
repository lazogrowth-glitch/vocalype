import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PushToTalk } from "../PushToTalk";
import { AudioFeedback } from "../AudioFeedback";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { ModelSettingsCard } from "./ModelSettingsCard";
import { LongAudioModelSettings } from "./LongAudioModelSettings";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  const [activeTab, setActiveTab] = useState<"shortcuts" | "audio" | "dictation">(
    "shortcuts",
  );

  const tabs = [
    { id: "shortcuts" as const, label: "Raccourcis" },
    { id: "audio" as const, label: "Audio" },
    { id: "dictation" as const, label: "Dictée" },
  ];

  return (
    <div className="w-full">
      <div className="mb-0 flex gap-1 border-b border-white/8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-[14px] pb-[9px] pt-[7px] text-[13px] transition-colors ${
              activeTab === tab.id
                ? "border-logo-primary text-logo-primary"
                : "border-transparent text-white/40 hover:text-white/65"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "shortcuts" && (
        <SettingsGroup title="Raccourcis clavier">
          <ShortcutInput shortcutId="transcribe" grouped={true} />
          <ShortcutInput shortcutId="cancel" grouped={true} />
          <ShortcutInput shortcutId="pause" grouped={true} />
          <ShortcutInput shortcutId="show_history" grouped={true} />
          <ShortcutInput shortcutId="copy_latest_history" grouped={true} />
          <PushToTalk descriptionMode="tooltip" grouped={true} />
        </SettingsGroup>
      )}

      {activeTab === "audio" && (
        <SettingsGroup title="Audio">
          <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
          <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
          <AudioFeedback descriptionMode="tooltip" grouped={true} />
          <OutputDeviceSelector
            descriptionMode="tooltip"
            grouped={true}
            disabled={!audioFeedbackEnabled}
          />
          <VolumeSlider disabled={!audioFeedbackEnabled} />
        </SettingsGroup>
      )}

      {activeTab === "dictation" && (
        <div className="space-y-6 pt-6">
          <ModelSettingsCard />
          <LongAudioModelSettings />
        </div>
      )}
    </div>
  );
};

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
import { usePlan } from "@/lib/plan/context";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  const { isBasicTier, onStartCheckout } = usePlan();
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
          {isBasicTier && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12px]">
              <span className="text-amber-300/80">
                {t("basic.shortcutsLocked", {
                  defaultValue: "Raccourcis personnalisés réservés à Premium",
                })}
              </span>
              <button
                type="button"
                onClick={() => onStartCheckout().then((url) => url && window.open(url, "_blank"))}
                className="ml-3 shrink-0 rounded bg-amber-500/20 px-2.5 py-1 text-amber-300 transition-colors hover:bg-amber-500/30"
              >
                {t("basic.upgrade", { defaultValue: "Passer à Premium" })}
              </button>
            </div>
          )}
          <ShortcutInput shortcutId="transcribe" grouped={true} disabled={isBasicTier} />
          <ShortcutInput shortcutId="cancel" grouped={true} disabled={isBasicTier} />
          <ShortcutInput shortcutId="pause" grouped={true} disabled={isBasicTier} />
          <ShortcutInput shortcutId="show_history" grouped={true} disabled={isBasicTier} />
          <ShortcutInput shortcutId="copy_latest_history" grouped={true} disabled={isBasicTier} />
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

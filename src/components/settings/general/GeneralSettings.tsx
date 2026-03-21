import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, TriangleAlert } from "lucide-react";
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
import { useStartupWarmupStatus } from "../../../hooks/useStartupWarmupStatus";
import { getStartupWarmupFallbackDetail } from "../../../types/startupWarmup";
import { usePlan } from "@/lib/plan/context";
import { DictionarySettings } from "../dictionary/DictionarySettings";
import { AppContextSettings } from "../app-context/AppContextSettings";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled } = useSettings();
  const { isBasicTier, onStartCheckout } = usePlan();
  const warmupStatus = useStartupWarmupStatus();
  const [activeTab, setActiveTab] = useState<
    "shortcuts" | "audio" | "dictation" | "dictionary" | "context"
  >("shortcuts");

  const shouldShowWarmupNotice =
    warmupStatus &&
    warmupStatus.phase !== "idle" &&
    warmupStatus.phase !== "ready";

  const tabs = [
    { id: "shortcuts" as const, label: "Raccourcis" },
    { id: "audio" as const, label: "Audio" },
    { id: "dictation" as const, label: "Dictée" },
    { id: "dictionary" as const, label: t("dictionary.tab") },
    {
      id: "context" as const,
      label: t("appContext.tab", { defaultValue: "Contexte" }),
    },
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
          {shouldShowWarmupNotice && (
            <div
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-[12px] ${
                warmupStatus.phase === "failed"
                  ? "border-red-400/30 bg-red-400/10 text-red-100"
                  : "border-logo-primary/25 bg-logo-primary/10 text-white/80"
              }`}
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  warmupStatus.phase === "failed"
                    ? "bg-red-400/15 text-red-300"
                    : "bg-logo-primary/15 text-logo-primary"
                }`}
              >
                {warmupStatus.phase === "failed" ? (
                  <TriangleAlert className="h-4 w-4" />
                ) : (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium leading-5">
                  {warmupStatus.message}
                </p>
                <p className="mt-1 leading-5 text-white/55">
                  {warmupStatus.detail || getStartupWarmupFallbackDetail(warmupStatus)}
                </p>
              </div>
            </div>
          )}
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
          {/* ── Command Mode ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 border-t border-white/6 px-4 pb-0.5 pt-2">
            <span className="text-[10.5px] text-white/40">
              {t("commandMode.label", { defaultValue: "Command Mode" })}
            </span>
            <span className="rounded bg-logo-primary/15 px-1.5 py-0.5 text-[9.5px] font-medium text-logo-primary">
              {t("basic.premiumBadge", { defaultValue: "Premium" })}
            </span>
          </div>
          <ShortcutInput shortcutId="command_mode" grouped={true} disabled={isBasicTier} />
          {/* ── Whisper Mode ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 border-t border-white/6 px-4 pb-0.5 pt-2">
            <span className="text-[10.5px] text-white/40">
              {t("whisperMode.label", { defaultValue: "Whisper Mode" })}
            </span>
          </div>
          <ShortcutInput shortcutId="whisper_mode" grouped={true} />
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

      {activeTab === "dictionary" && <DictionarySettings />}

      {activeTab === "context" && <AppContextSettings />}
    </div>
  );
};

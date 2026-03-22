import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { RecordingModeSelector } from "../RecordingModeSelector";
import { AudioFeedback } from "../AudioFeedback";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { ModelSettingsCard } from "./ModelSettingsCard";
import { LongAudioModelSettings } from "./LongAudioModelSettings";
import { useStartupWarmupStatus } from "../../../hooks/useStartupWarmupStatus";
import { getStartupWarmupFallbackDetail } from "../../../types/startupWarmup";
import { usePlan } from "@/lib/subscription/context";
import { DictionarySettings } from "../dictionary/DictionarySettings";
import { AppContextSettings } from "../app-context/AppContextSettings";
import { FeatureGateHint } from "../../ui";

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
    { id: "shortcuts" as const, label: t("settings.general.tabs.shortcuts") },
    { id: "audio" as const, label: t("settings.general.tabs.audio") },
    { id: "dictation" as const, label: t("settings.general.tabs.dictation") },
    { id: "dictionary" as const, label: t("dictionary.tab") },
    {
      id: "context" as const,
      label: t("appContext.tab", { defaultValue: "Contexte" }),
    },
  ];

  return (
    <div className="w-full">
      <div className="mb-0 flex gap-1 border-b border-white/8" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-[14px] pb-[9px] pt-[7px] text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
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
        <div role="tabpanel">
          <SettingsGroup
            title={t("settings.general.tabs.keyboardShortcutsTitle")}
          >
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
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <LoaderCircle
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium leading-5">
                    {warmupStatus.message}
                  </p>
                  <p className="mt-1 leading-5 text-white/55">
                    {warmupStatus.detail ||
                      getStartupWarmupFallbackDetail(warmupStatus)}
                  </p>
                </div>
              </div>
            )}
            {isBasicTier && (
              <FeatureGateHint
                tone="premium"
                title={t("basic.shortcutsLocked", {
                  defaultValue: "Custom shortcuts are a Premium feature",
                })}
                description={t("basic.shortcutsLockedDescription", {
                  defaultValue:
                    "On Basic, the default dictation flow still works, but editing shortcuts, extra history shortcuts, and Command Mode stays locked until you upgrade.",
                })}
                actionLabel={t("basic.upgrade", {
                  defaultValue: "Upgrade to Premium",
                })}
                onAction={async () => {
                  const url = await onStartCheckout();
                  if (url) window.open(url, "_blank");
                }}
              />
            )}
            <ShortcutInput
              shortcutId="transcribe"
              grouped={true}
              disabled={isBasicTier}
            />
            <ShortcutInput
              shortcutId="cancel"
              grouped={true}
              disabled={isBasicTier}
            />
            <ShortcutInput
              shortcutId="pause"
              grouped={true}
              disabled={isBasicTier}
            />
            <ShortcutInput
              shortcutId="show_history"
              grouped={true}
              disabled={isBasicTier}
            />
            <ShortcutInput
              shortcutId="copy_latest_history"
              grouped={true}
              disabled={isBasicTier}
            />
            <RecordingModeSelector grouped={true} />
            {/* ── Command Mode ─────────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 border-t border-white/6 px-4 pb-0.5 pt-2">
              <span className="text-[10.5px] text-white/40">
                {t("commandMode.label", { defaultValue: "Command Mode" })}
              </span>
              <span className="rounded bg-logo-primary/15 px-1.5 py-0.5 text-[9.5px] font-medium text-logo-primary">
                {t("basic.premiumBadge", { defaultValue: "Premium" })}
              </span>
            </div>
            <ShortcutInput
              shortcutId="command_mode"
              grouped={true}
              disabled={isBasicTier}
            />
            {/* ── Whisper Mode ─────────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 border-t border-white/6 px-4 pb-0.5 pt-2">
              <span className="text-[10.5px] text-white/40">
                {t("whisperMode.label", { defaultValue: "Whisper Mode" })}
              </span>
            </div>
            <ShortcutInput shortcutId="whisper_mode" grouped={true} />
          </SettingsGroup>
        </div>
      )}

      {activeTab === "audio" && (
        <div role="tabpanel">
          <SettingsGroup title={t("settings.general.tabs.audio")}>
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
        </div>
      )}

      {activeTab === "dictation" && (
        <div role="tabpanel" className="space-y-6 pt-6">
          <ModelSettingsCard />
          <LongAudioModelSettings />
        </div>
      )}

      {activeTab === "dictionary" && (
        <div role="tabpanel">
          <DictionarySettings />
        </div>
      )}

      {activeTab === "context" && (
        <div role="tabpanel">
          <AppContextSettings />
        </div>
      )}
    </div>
  );
};

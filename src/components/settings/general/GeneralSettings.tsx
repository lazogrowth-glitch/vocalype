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
import { AutoPauseMedia } from "../AutoPauseMedia";
import { WakeWordToggle } from "../WakeWordToggle";
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
    "shortcuts" | "audio" | "dictionary" | "context"
  >("shortcuts");

  const shouldShowWarmupNotice =
    warmupStatus &&
    warmupStatus.phase !== "idle" &&
    warmupStatus.phase !== "ready";

  const tabs = [
    { id: "audio" as const, label: t("settings.general.tabs.audio") },
    { id: "shortcuts" as const, label: t("settings.general.tabs.shortcuts") },
    { id: "dictionary" as const, label: t("dictionary.tab") },
    {
      id: "context" as const,
      label: t("appContext.tab", { defaultValue: "Contexte" }),
    },
  ];

  return (
    <div className="w-full">
      <div className="general-settings-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-active={activeTab === tab.id ? "true" : "false"}
            className="general-settings-tab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "shortcuts" && (
        <div
          role="tabpanel"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {/* Warmup / error notice */}
          {shouldShowWarmupNotice && (
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 16px",
              }}
              className={`rounded-[10px] border text-[12px] ${
                warmupStatus.phase === "failed"
                  ? "border-red-400/30 bg-red-400/10 text-red-100"
                  : "border-logo-primary/25 bg-logo-primary/10 text-white/80"
              }`}
            >
              <div
                style={{ marginTop: 2, flexShrink: 0 }}
                className={`flex h-7 w-7 items-center justify-center rounded-full ${
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
                <p className="font-medium leading-5">{warmupStatus.message}</p>
                <p style={{ marginTop: 4 }} className="leading-5 text-white/55">
                  {warmupStatus.detail ||
                    getStartupWarmupFallbackDetail(warmupStatus)}
                </p>
              </div>
            </div>
          )}

          {/* Premium gate for basic users */}
          {isBasicTier && (
            <div style={{ marginBottom: 16 }}>
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
            </div>
          )}

          {/* ── Main keyboard shortcuts ──────────────────────────────── */}
          <SettingsGroup
            title={t("settings.general.tabs.keyboardShortcutsTitle")}
          >
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
          </SettingsGroup>

          {/* ── Recording mode ───────────────────────────────────────── */}
          <div style={{ marginBottom: 28 }}>
            <RecordingModeSelector grouped={false} />
          </div>

          {/* ── Hands-free / Wake word ────────────────────────────────── */}
          <SettingsGroup>
            <WakeWordToggle grouped={true} descriptionMode="inline" />
          </SettingsGroup>

          {/* ── Command Mode ─────────────────────────────────────────── */}
          <SettingsGroup
            title={t("commandMode.label", { defaultValue: "Command Mode" })}
            titleBadge={
              <span className="rounded bg-logo-primary/15 px-1.5 py-0.5 text-[9.5px] font-medium text-logo-primary">
                {t("basic.premiumBadge", { defaultValue: "Premium" })}
              </span>
            }
          >
            <ShortcutInput
              shortcutId="command_mode"
              grouped={true}
              disabled={isBasicTier}
            />
          </SettingsGroup>

          {/* ── Whisper Mode ─────────────────────────────────────────── */}
          <SettingsGroup
            title={t("whisperMode.label", { defaultValue: "Whisper Mode" })}
          >
            <ShortcutInput shortcutId="whisper_mode" grouped={true} />
          </SettingsGroup>

          {/* ── Agent Key ────────────────────────────────────────────── */}
          <SettingsGroup
            title={t("agentKey.label", { defaultValue: "Agent Key" })}
          >
            <ShortcutInput
              shortcutId="agent_key"
              grouped={true}
              disabled={isBasicTier}
            />
          </SettingsGroup>

          {/* ── Meeting Key ──────────────────────────────────────────── */}
          <SettingsGroup
            title={t("meetingKey.label", { defaultValue: "Meeting Key" })}
          >
            <ShortcutInput
              shortcutId="meeting_key"
              grouped={true}
              disabled={isBasicTier}
            />
          </SettingsGroup>

          <SettingsGroup
            title={t("noteKey.label", { defaultValue: "Note Key" })}
          >
            <ShortcutInput
              shortcutId="note_key"
              grouped={true}
              disabled={isBasicTier}
            />
          </SettingsGroup>
        </div>
      )}

      {activeTab === "audio" && (
        <div role="tabpanel" style={{ paddingTop: 24 }}>
          <SettingsGroup title={t("settings.general.tabs.audio")}>
            <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
            <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
            <AutoPauseMedia descriptionMode="tooltip" grouped={true} />
            <AudioFeedback descriptionMode="tooltip" grouped={true} />
            <OutputDeviceSelector
              descriptionMode="tooltip"
              grouped={true}
              disabled={!audioFeedbackEnabled}
            />
            <VolumeSlider disabled={!audioFeedbackEnabled} />
          </SettingsGroup>
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

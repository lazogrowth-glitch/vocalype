import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { RecordingModeSelector } from "../RecordingModeSelector";
import { useStartupWarmupStatus } from "../../../hooks/useStartupWarmupStatus";
import { getStartupWarmupFallbackDetail } from "../../../types/startupWarmup";
import { usePlan } from "@/lib/subscription/context";
import { DictionarySettings } from "../dictionary/DictionarySettings";
import { FeatureGateHint } from "../../ui";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { isBasicTier, onStartCheckout } = usePlan();
  const warmupStatus = useStartupWarmupStatus();
  const [activeTab, setActiveTab] = useState<"dictation" | "dictionary">(
    "dictation",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const shouldShowWarmupNotice =
    warmupStatus &&
    warmupStatus.phase !== "idle" &&
    warmupStatus.phase !== "ready";

  const tabs = [
    {
      id: "dictation" as const,
      label: t("settings.general.tabs.dictation", { defaultValue: "Dictée" }),
    },
    { id: "dictionary" as const, label: t("dictionary.tab") },
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

      {activeTab === "dictation" && (
        <div
          role="tabpanel"
          style={{ display: "flex", flexDirection: "column", gap: 0 }}
        >
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

          {isBasicTier && (
            <div style={{ marginBottom: 16 }}>
              <FeatureGateHint
                tone="premium"
                title={t("basic.shortcutsLocked", {
                  defaultValue: "Custom shortcuts are a Premium feature",
                })}
                description={t("basic.shortcutsLockedDescription", {
                  defaultValue:
                    "On Basic, the default dictation flow still works, but editing shortcuts stays locked until you upgrade.",
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

          <SettingsGroup
            title={t("settings.general.tabs.primaryShortcut", {
              defaultValue: "Raccourci principal",
            })}
          >
            <ShortcutInput
              shortcutId="transcribe"
              grouped={true}
              disabled={isBasicTier}
            />
          </SettingsGroup>

          <SettingsGroup
            title={t("settings.sound.microphone.title", {
              defaultValue: "Microphone",
            })}
          >
            <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
          </SettingsGroup>

          <SettingsGroup title={t("dictionary.tab")}>
            <div
              className="voca-surface"
              style={{
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <p className="text-[12px] text-white/45 leading-5">
                {t("dictionary.sectionDescription", {
                  defaultValue:
                    "Ajoute les noms de candidats, clients, postes ou acronymes que Vocalype doit mieux reconnaître.",
                })}
              </p>
              <button
                type="button"
                onClick={() => setActiveTab("dictionary")}
                className="shrink-0 text-[12px] text-logo-primary hover:underline transition-opacity"
              >
                {t("dictionary.manage", { defaultValue: "Gérer →" })}
              </button>
            </div>
          </SettingsGroup>

          <div style={{ marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex items-center gap-1.5 py-2 text-[12px] text-white/35 hover:text-white/55 transition-colors"
            >
              {advancedOpen ? (
                <ChevronDown size={13} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} aria-hidden="true" />
              )}
              {t("settings.general.advanced.title", {
                defaultValue: "Options avancées",
              })}
            </button>
            {advancedOpen && (
              <SettingsGroup
                title={t("settings.general.recordingMode.label")}
                description={t("settings.general.recordingMode.description")}
              >
                <RecordingModeSelector grouped={true} />
              </SettingsGroup>
            )}
          </div>
        </div>
      )}

      {activeTab === "dictionary" && (
        <div role="tabpanel">
          <DictionarySettings />
        </div>
      )}
    </div>
  );
};

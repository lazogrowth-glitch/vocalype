/**
 * RecordingModeSelector — replaces the separate PushToTalk + AlwaysOnMicrophone
 * toggles with a single 3-way radio selector.
 *
 * ## Modes
 * | Mode       | push_to_talk | always_on_microphone |
 * |------------|--------------|----------------------|
 * | toggle     | false        | false                |
 * | push_to_talk | true       | false                |
 * | always_on  | false        | true                 |
 *
 * The component writes to the two legacy boolean settings so the Rust backend
 * (and `effective_recording_mode()`) can interpret them correctly until the
 * `recording_mode` field is promoted to a first-class binding.
 */
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";

type RecordingMode = "toggle" | "push_to_talk" | "always_on";

interface RecordingModeSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

function deriveMode(pushToTalk: boolean, alwaysOn: boolean): RecordingMode {
  if (pushToTalk) return "push_to_talk";
  if (alwaysOn) return "always_on";
  return "toggle";
}

export const RecordingModeSelector: React.FC<RecordingModeSelectorProps> =
  React.memo(({ grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const pushToTalk = getSetting("push_to_talk") ?? false;
    const alwaysOn = getSetting("always_on_microphone") ?? false;
    const currentMode = deriveMode(pushToTalk, alwaysOn);

    const isBusy =
      isUpdating("push_to_talk") || isUpdating("always_on_microphone");

    const handleSelect = useCallback(
      async (mode: RecordingMode) => {
        if (isBusy) return;
        switch (mode) {
          case "push_to_talk":
            await updateSetting("push_to_talk", true);
            await updateSetting("always_on_microphone", false);
            break;
          case "always_on":
            await updateSetting("push_to_talk", false);
            await updateSetting("always_on_microphone", true);
            break;
          case "toggle":
          default:
            await updateSetting("push_to_talk", false);
            await updateSetting("always_on_microphone", false);
            break;
        }
      },
      [isBusy, updateSetting],
    );

    const modes: { id: RecordingMode; labelKey: string; descKey: string }[] = [
      {
        id: "toggle",
        labelKey: "settings.general.recordingMode.toggle.label",
        descKey: "settings.general.recordingMode.toggle.description",
      },
      {
        id: "push_to_talk",
        labelKey: "settings.general.recordingMode.pushToTalk.label",
        descKey: "settings.general.recordingMode.pushToTalk.description",
      },
      {
        id: "always_on",
        labelKey: "settings.general.recordingMode.alwaysOn.label",
        descKey: "settings.general.recordingMode.alwaysOn.description",
      },
    ];

    return (
      <div
        className={
          grouped
            ? "border-t border-white/6 px-4 py-3"
            : "rounded-lg bg-white/4 px-4 py-3"
        }
      >
        <p className="mb-1 text-sm font-medium text-white/90">
          {t("settings.general.recordingMode.label")}
        </p>
        <p className="mb-3 text-xs text-white/50">
          {t("settings.general.recordingMode.description")}
        </p>

        <div className="flex flex-col gap-2">
          {modes.map(({ id, labelKey, descKey }) => {
            const selected = currentMode === id;
            return (
              <button
                key={id}
                onClick={() => handleSelect(id)}
                disabled={isBusy}
                className={[
                  "flex items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "bg-white/10 ring-1 ring-white/20"
                    : "hover:bg-white/5",
                  isBusy ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                ].join(" ")}
                aria-pressed={selected}
              >
                {/* Radio dot */}
                <span
                  className={[
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-blue-400 bg-blue-500"
                      : "border-white/30 bg-transparent",
                  ].join(" ")}
                >
                  {selected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </span>

                <span>
                  <span className="block text-sm font-medium text-white/90">
                    {t(labelKey)}
                  </span>
                  <span className="block text-xs text-white/50">
                    {t(descKey)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  });

RecordingModeSelector.displayName = "RecordingModeSelector";

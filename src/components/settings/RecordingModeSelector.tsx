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
  React.memo(() => {
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
      <div className="recording-mode-options">
        {modes.map(({ id, labelKey, descKey }) => {
          const selected = currentMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              disabled={isBusy}
              className="recording-mode-option"
              data-selected={selected ? "true" : undefined}
              aria-pressed={selected}
            >
              <span className="recording-mode-dot" />
              <span>
                <span className="recording-mode-title">{t(labelKey)}</span>
                <span className="recording-mode-desc">{t(descKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  });

RecordingModeSelector.displayName = "RecordingModeSelector";

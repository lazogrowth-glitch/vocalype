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
      <section>
        <div style={{ marginBottom: 14 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1.4,
              color: "rgba(255,255,255,0.34)",
            }}
          >
            {t("settings.general.recordingMode.label")}
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-white/50">
            {t("settings.general.recordingMode.description")}
          </p>
        </div>

        <div className="rounded-[18px] border border-white/8 bg-white/[0.01]">
          {modes.map(({ id, labelKey, descKey }, index) => {
            const selected = currentMode === id;
            return (
              <button
                key={id}
                onClick={() => handleSelect(id)}
                disabled={isBusy}
                style={{ padding: "15px 20px" }}
                className={[
                  "flex w-full items-center gap-3 text-left transition-colors",
                  index !== modes.length - 1
                    ? "border-b border-white/[0.05]"
                    : "",
                  selected ? "bg-white/[0.04]" : "hover:bg-white/[0.03]",
                  isBusy ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                ].join(" ")}
                aria-pressed={selected}
              >
                {/* Radio dot */}
                <span
                  className={[
                    "flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-logo-primary bg-logo-primary"
                      : "border-white/25 bg-transparent",
                  ].join(" ")}
                >
                  {selected && (
                    <span className="h-[6px] w-[6px] rounded-full bg-white" />
                  )}
                </span>

                <span>
                  <span className="block text-[15px] font-medium leading-5 text-white/92">
                    {t(labelKey)}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-white/52">
                    {t(descKey)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  });

RecordingModeSelector.displayName = "RecordingModeSelector";

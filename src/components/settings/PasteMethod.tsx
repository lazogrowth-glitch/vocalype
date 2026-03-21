import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { Input } from "../ui/Input";
import { FeatureGateHint, InfoTooltip } from "../ui";
import { useSettings } from "../../hooks/useSettings";
import { useOsType } from "../../hooks/useOsType";
import type { PasteMethod } from "@/bindings";
import { usePlan } from "@/lib/subscription/context";

interface PasteMethodProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PasteMethodSetting: React.FC<PasteMethodProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const osType = useOsType();
    const { isBasicTier, onStartCheckout } = usePlan();
    const [draftScriptPath, setDraftScriptPath] = useState("");

    const getPasteMethodOptions = (osType: string) => {
      const mod = osType === "macos" ? "Cmd" : "Ctrl";

      const options = [
        {
          value: "ctrl_v",
          label: t("settings.advanced.pasteMethod.options.clipboard", {
            modifier: mod,
          }),
        },
        {
          value: "direct",
          label: t("settings.advanced.pasteMethod.options.direct"),
        },
        {
          value: "none",
          label: t("settings.advanced.pasteMethod.options.none"),
        },
      ];

      // Add Shift+Insert and Ctrl+Shift+V options for Windows and Linux only
      if (osType === "windows" || osType === "linux") {
        options.push(
          {
            value: "ctrl_shift_v",
            label: t(
              "settings.advanced.pasteMethod.options.clipboardCtrlShiftV",
            ),
          },
          {
            value: "shift_insert",
            label: t(
              "settings.advanced.pasteMethod.options.clipboardShiftInsert",
            ),
          },
        );
      }

      // External script is only available on Linux
      if (osType === "linux") {
        options.push({
          value: "external_script",
          label: t("settings.advanced.pasteMethod.options.externalScript"),
        });
      }

      return options;
    };

    const selectedMethod = (getSetting("paste_method") ||
      "ctrl_v") as PasteMethod;
    const externalScriptPath = getSetting("external_script_path") || "";

    useEffect(() => {
      setDraftScriptPath(externalScriptPath);
    }, [externalScriptPath]);

    const saveExternalScriptPath = async () => {
      const trimmed = draftScriptPath.trim();
      await updateSetting("external_script_path", trimmed || null);
    };

    const pasteMethodOptions = getPasteMethodOptions(osType);

    return (
      <SettingContainer
        title={
          <span className="flex items-center">
            {t("settings.advanced.pasteMethod.title")}
            <InfoTooltip content={t("tooltips.pasteMethod")} />
          </span>
        }
        description={t("settings.advanced.pasteMethod.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      >
        <div className="flex flex-col gap-2">
          <Dropdown
            options={pasteMethodOptions}
            selectedValue={selectedMethod}
            onSelect={(value) =>
              updateSetting("paste_method", value as PasteMethod)
            }
            disabled={isUpdating("paste_method")}
          />
          {selectedMethod === "external_script" && (
            <>
              <Input
                type="text"
                value={draftScriptPath}
                onChange={(e) => setDraftScriptPath(e.target.value)}
                onBlur={() => void saveExternalScriptPath()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void saveExternalScriptPath();
                  }
                }}
                placeholder={t(
                  "settings.advanced.pasteMethod.externalScriptPlaceholder",
                )}
                disabled={isUpdating("external_script_path")}
              />
              <p className="text-xs text-mid-gray/70">
                {t("settings.advanced.pasteMethod.externalScriptHelp", {
                  defaultValue:
                    "External scripts must use an absolute path to an executable local file. Changes are saved on blur or Enter.",
                })}
              </p>
            </>
          )}
          {isBasicTier && selectedMethod === "direct" && (
            <FeatureGateHint
              tone="premium"
              title={t("settings.advanced.pasteMethod.premiumDirectTitle", {
                defaultValue: "Direct insertion is reserved for Premium",
              })}
              description={t(
                "settings.advanced.pasteMethod.premiumDirectDescription",
                {
                  defaultValue:
                    "On Basic, VocalType will still keep the result recoverable, but dictation falls back to clipboard handling instead of native direct injection.",
                },
              )}
              actionLabel={t("basic.upgrade", {
                defaultValue: "Upgrade to Premium",
              })}
              onAction={async () => {
                const url = await onStartCheckout();
                if (url) window.open(url, "_blank");
              }}
            />
          )}
        </div>
      </SettingContainer>
    );
  },
);

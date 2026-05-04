import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Zap, CheckCircle, TriangleAlert, Shield } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";

const PROVIDER_ID = "vocalype-cloud";
const MODEL_ID = "llama-3.1-8b-instant";

export const CloudPostProcessToggle: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { setPostProcessProvider, updatePostProcessSetting } =
    useSettingsStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = settings?.post_process_provider_id === PROVIDER_ID;

  const activate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await setPostProcessProvider(PROVIDER_ID);
      await updatePostProcessSetting("model", PROVIDER_ID, MODEL_ID);
      // Enable post-processing so the shortcut is registered
      await updateSetting("post_process_enabled", true);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, { t }));
    } finally {
      setLoading(false);
    }
  }, [setPostProcessProvider, updatePostProcessSetting, updateSetting, t]);

  const deactivate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await setPostProcessProvider("");
      await updateSetting("post_process_enabled", false);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, { t }));
    } finally {
      setLoading(false);
    }
  }, [setPostProcessProvider, updateSetting, t]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 10,
        border: isActive
          ? "1px solid rgba(250,180,60,0.35)"
          : "1px solid rgba(255,255,255,0.07)",
        background: isActive
          ? "rgba(250,180,60,0.05)"
          : "rgba(255,255,255,0.03)",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isActive ? (
          <CheckCircle
            size={15}
            style={{ color: "rgba(250,180,60,0.9)", flexShrink: 0 }}
          />
        ) : (
          <Zap
            size={15}
            style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,255,255,0.9)",
              margin: 0,
            }}
          >
            {t("settings.cloudLlm.label", {
              defaultValue: "Vocalype Cloud ⚡ (faster)",
            })}
          </p>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              margin: "2px 0 0",
            }}
          >
            {isActive
              ? t("settings.cloudLlm.activeDescription", {
                  defaultValue:
                    "Active — post-processing runs on Vocalype servers",
                })
              : t("settings.cloudLlm.description", {
                  defaultValue:
                    "10× faster than local LLM — works on any machine, no GPU needed",
                })}
          </p>
        </div>

        <button
          type="button"
          onClick={isActive ? deactivate : activate}
          disabled={loading}
          style={{
            flexShrink: 0,
            padding: "5px 12px",
            borderRadius: 6,
            border: "none",
            fontSize: 12,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            background: isActive
              ? "rgba(255,255,255,0.08)"
              : "rgba(250,180,60,0.85)",
            color: isActive ? "rgba(255,255,255,0.5)" : "#000",
            transition: "background 0.15s",
          }}
        >
          {isActive
            ? t("settings.cloudLlm.deactivate", { defaultValue: "Disable" })
            : t("settings.cloudLlm.activate", { defaultValue: "Enable" })}
        </button>
      </div>

      {/* Privacy notice — only shown when not yet active */}
      {!isActive && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Shield
            size={11}
            style={{
              color: "rgba(255,255,255,0.3)",
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <p
            style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", margin: 0 }}
          >
            {t("settings.cloudLlm.privacyNotice", {
              defaultValue:
                "Your transcription text is sent to Vocalype servers to be processed. Nothing is stored permanently. Disable to keep everything local.",
            })}
          </p>
        </div>
      )}

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.2)",
          }}
        >
          <TriangleAlert
            size={12}
            style={{
              color: "rgba(255,100,100,0.8)",
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <p
            style={{ fontSize: 11, color: "rgba(255,120,120,0.9)", margin: 0 }}
          >
            {error}
          </p>
        </div>
      )}
    </div>
  );
};

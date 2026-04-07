import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import type { RuntimeDiagnosticsSnapshot } from "../../../types/runtimeObservability";

export const RuntimeDiagnostics: React.FC<{ grouped?: boolean }> = ({
  grouped = true,
}) => {
  const { t, i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const recentErrors = useMemo(
    () => (snapshot?.recent_errors ?? []).slice(-5).reverse(),
    [snapshot],
  );
  const calibrationStates = useMemo(
    () =>
      (snapshot?.adaptive_calibration_state ?? [])
        .slice()
        .sort((a, b) => b.updated_at_ms - a.updated_at_ms),
    [snapshot],
  );
  const parakeetSessions = useMemo(
    () => (snapshot?.parakeet_diagnostics?.recent_sessions ?? []).slice().reverse(),
    [snapshot],
  );
  const adaptiveProfile = snapshot?.adaptive_machine_profile ?? null;
  const voiceProfileSessions = snapshot?.adaptive_voice_profile
    ? t("settings.debug.runtimeDiagnostics.voiceProfileSessions", {
        defaultValue: "{{count}} sessions",
        count: snapshot.adaptive_voice_profile.sessions_count,
      })
    : null;
  const voiceProfileWpm = snapshot?.adaptive_voice_profile
    ? t("settings.debug.runtimeDiagnostics.voiceProfileWpm", {
        defaultValue: "{{value}} wpm",
        value: snapshot.adaptive_voice_profile.avg_words_per_minute.toFixed(0),
      })
    : null;
  const voiceProfilePauses = snapshot?.adaptive_voice_profile
    ? t("settings.debug.runtimeDiagnostics.voiceProfilePauses", {
        defaultValue: "{{value}} ms pauses",
        value: snapshot.adaptive_voice_profile.avg_pause_ms.toFixed(0),
      })
    : null;
  const activeVoiceProfileSessions = snapshot?.active_voice_profile_segment
    ? t("settings.debug.runtimeDiagnostics.voiceProfileSessions", {
        defaultValue: "{{count}} sessions",
        count: snapshot.active_voice_profile_segment.sessions_count,
      })
    : null;
  const activeVoiceProfileWpm = snapshot?.active_voice_profile_segment
    ? t("settings.debug.runtimeDiagnostics.voiceProfileWpm", {
        defaultValue: "{{value}} wpm",
        value: snapshot.active_voice_profile_segment.avg_words_per_minute.toFixed(
          0,
        ),
      })
    : null;
  const activeVoiceProfilePauses = snapshot?.active_voice_profile_segment
    ? t("settings.debug.runtimeDiagnostics.voiceProfilePauses", {
        defaultValue: "{{value}} ms pauses",
        value: snapshot.active_voice_profile_segment.avg_pause_ms.toFixed(0),
      })
    : null;
  const voiceAdjustmentValue = snapshot?.active_voice_runtime_adjustment
    ? t("settings.debug.runtimeDiagnostics.voiceAdjustmentValue", {
        defaultValue: "{{chunkSeconds}}s / {{overlapMs}}ms",
        chunkSeconds:
          snapshot.active_voice_runtime_adjustment.adjusted_chunk_seconds,
        overlapMs: snapshot.active_voice_runtime_adjustment.adjusted_overlap_ms,
      })
    : null;

  const handleCapture = async () => {
    setBusy(true);
    try {
      const data = await invoke<RuntimeDiagnosticsSnapshot>(
        "get_runtime_diagnostics",
      );
      setSnapshot(data);
      setStatus(
        t("settings.debug.runtimeDiagnostics.captured", {
          defaultValue: "Diagnostics captured",
        }),
      );
    } catch (error) {
      setStatus(
        t("settings.debug.runtimeDiagnostics.captureFailed", {
          defaultValue: "Capture failed: {{error}}",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 3000);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "vocalype-runtime-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) {
        setBusy(false);
        return;
      }
      await invoke("export_runtime_diagnostics", { path });
      setStatus(
        t("settings.debug.runtimeDiagnostics.exported", {
          defaultValue: "Diagnostics exported",
        }),
      );
    } catch (error) {
      setStatus(
        t("settings.debug.runtimeDiagnostics.exportFailed", {
          defaultValue: "Export failed: {{error}}",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 3000);
    }
  };

  return (
    <SettingContainer
      title={t("settings.debug.runtimeDiagnostics.title", {
        defaultValue: "Runtime Diagnostics",
      })}
      description={t("settings.debug.runtimeDiagnostics.description", {
        defaultValue:
          "Capture and export a runtime snapshot for troubleshooting transcription and paste issues.",
      })}
      grouped={grouped}
      layout="stacked"
    >
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCapture}
          disabled={busy}
        >
          {t("settings.debug.runtimeDiagnostics.capture", {
            defaultValue: "Capture",
          })}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleExport}
          disabled={busy}
        >
          {t("settings.debug.runtimeDiagnostics.export", {
            defaultValue: "Export JSON",
          })}
        </Button>
        {status && <span className="text-xs text-mid-gray">{status}</span>}
      </div>

      {snapshot && (
        <div className="mt-2 text-xs text-text/80 space-y-1 border border-mid-gray/20 rounded-lg p-2">
          <p>
            {t("settings.debug.runtimeDiagnostics.lifecycle", {
              defaultValue: "Lifecycle",
            })}
            : <span className="font-semibold">{snapshot.lifecycle_state}</span>
          </p>
          {snapshot.operation_id != null && (
            <p>
              {t("settings.debug.runtimeDiagnostics.operationId", {
                defaultValue: "Operation",
              })}
              : <span className="font-semibold">{snapshot.operation_id}</span>
              {snapshot.active_stage ? ` Â· ${snapshot.active_stage}` : ""}
            </p>
          )}
          {snapshot.cancelled_at_stage && (
            <p>
              {t("settings.debug.runtimeDiagnostics.cancelledAt", {
                defaultValue: "Cancelled at",
              })}
              :{" "}
              <span className="font-semibold">
                {snapshot.cancelled_at_stage}
              </span>
            </p>
          )}
          {snapshot.partial_result && (
            <p>
              {t("settings.debug.runtimeDiagnostics.partialResult", {
                defaultValue: "Partial result",
              })}
              :{" "}
              <span className="font-semibold">
                {t("common.yes", { defaultValue: "yes" })}
              </span>
            </p>
          )}
          <p>
            {t("settings.debug.runtimeDiagnostics.model", {
              defaultValue: "Model",
            })}
            :{" "}
            <span className="font-semibold">
              {snapshot.loaded_model_name ||
                snapshot.loaded_model_id ||
                snapshot.selected_model}
            </span>
          </p>
          {adaptiveProfile && (
            <>
              <p>
                {t("settings.debug.runtimeDiagnostics.recommendedModel", {
                  defaultValue: "Recommended",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.recommended_model_id}
                </span>
              </p>
              <p>
                {t("settings.debug.runtimeDiagnostics.activeModel", {
                  defaultValue: "Active now",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.active_runtime_model_id ||
                    snapshot.loaded_model_id ||
                    snapshot.selected_model}
                </span>
              </p>
              <p>
                {t("settings.debug.runtimeDiagnostics.machineTier", {
                  defaultValue: "Machine tier",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.machine_tier} (
                  {adaptiveProfile.machine_score_details.final_score.toFixed(2)}
                  )
                </span>
              </p>
              <p>
                {t("settings.debug.runtimeDiagnostics.gpu", {
                  defaultValue: "GPU",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.gpu_kind}
                </span>
                {adaptiveProfile.gpu_name
                  ? ` Â· ${adaptiveProfile.gpu_name}`
                  : ""}
              </p>
              <p>
                {t("settings.debug.runtimeDiagnostics.npu", {
                  defaultValue: "NPU",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.npu_kind}
                </span>
                {adaptiveProfile.npu_name
                  ? ` Â· ${adaptiveProfile.npu_name}`
                  : ""}
                {" · "}
                <span className="text-text/60">
                  {t("settings.debug.runtimeDiagnostics.copilotPlus", {
                    defaultValue: "Copilot+",
                  })}
                  :{" "}
                  {adaptiveProfile.copilot_plus_detected
                    ? t("common.yes", { defaultValue: "yes" })
                    : t("common.no", { defaultValue: "no" })}
                </span>
              </p>
              <p>
                {t("settings.debug.runtimeDiagnostics.backend", {
                  defaultValue: "Whisper backend",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.active_backend || "n/a"}
                </span>
                {" / "}
                <span className="text-text/60">
                  {t("settings.debug.runtimeDiagnostics.recommended", {
                    defaultValue: "recommended",
                  })}
                  : {adaptiveProfile.recommended_backend || "n/a"}
                </span>
              </p>
              <p>
                {t("settings.debug.runtimeDiagnostics.power", {
                  defaultValue: "Power",
                })}
                :{" "}
                <span className="font-semibold">
                  {adaptiveProfile.power_mode}
                </span>
                {" · "}
                <span className="text-text/60">
                  {t("settings.debug.runtimeDiagnostics.battery", {
                    defaultValue: "battery",
                  })}
                  :{" "}
                  {adaptiveProfile.on_battery == null
                    ? t("settings.debug.runtimeDiagnostics.unknown", {
                        defaultValue: "unknown",
                      })
                    : adaptiveProfile.on_battery
                      ? t("common.yes", { defaultValue: "yes" })
                      : t("common.no", { defaultValue: "no" })}
                </span>
                {" · "}
                <span className="text-text/60">
                  {t("settings.debug.runtimeDiagnostics.thermal", {
                    defaultValue: "thermal",
                  })}
                  :{" "}
                  {adaptiveProfile.thermal_degraded
                    ? t("common.yes", { defaultValue: "yes" })
                    : t("common.no", { defaultValue: "no" })}
                </span>
              </p>
              {adaptiveProfile.large_skip_reason && (
                <p>
                  {t("settings.debug.runtimeDiagnostics.largeSkip", {
                    defaultValue: "Large skipped",
                  })}
                  :{" "}
                  <span className="text-text/60">
                    {adaptiveProfile.large_skip_reason}
                  </span>
                </p>
              )}
            </>
          )}
          <p>
            {t("settings.debug.runtimeDiagnostics.pasteMethod", {
              defaultValue: "Paste method",
            })}
            : <span className="font-semibold">{snapshot.paste_method}</span>
          </p>
          <p>
            {t("settings.debug.runtimeDiagnostics.microphoneRuntime", {
              defaultValue: "Microphone runtime",
            })}
            :{" "}
            <span className="font-semibold">
              {snapshot.microphone_stream_open
                ? t("settings.debug.runtimeDiagnostics.streamOpen", {
                    defaultValue: "stream open",
                  })
                : t("settings.debug.runtimeDiagnostics.streamClosed", {
                    defaultValue: "stream closed",
                  })}
            </span>
            {" · "}
            <span className="text-text/60">
              {snapshot.microphone_backend_ready
                ? t("settings.debug.runtimeDiagnostics.backendReady", {
                    defaultValue: "backend ready",
                  })
                : t("settings.debug.runtimeDiagnostics.backendNotReady", {
                    defaultValue: "backend not ready",
                  })}
            </span>
            {" · "}
            <span className="text-text/60">
              {snapshot.selected_microphone_available
                ? t("settings.debug.runtimeDiagnostics.deviceAvailable", {
                    defaultValue: "device available",
                  })
                : t("settings.debug.runtimeDiagnostics.deviceMissing", {
                    defaultValue: "device missing",
                  })}
            </span>
          </p>
          <p>
            {t("settings.debug.runtimeDiagnostics.inputLevel", {
              defaultValue: "Input level",
            })}
            : <span className="font-semibold">{snapshot.input_level_state}</span>
            {" · "}
            <span className="text-text/60">
              ema {snapshot.input_energy_ema.toFixed(4)}
            </span>
            {" · "}
            <span className="text-text/60">
              peak {snapshot.input_peak_energy.toFixed(4)}
            </span>
            {snapshot.adaptive_silence_threshold_ms != null && (
              <>
                {" · "}
                <span className="text-text/60">
                  silence {snapshot.adaptive_silence_threshold_ms}ms
                </span>
              </>
            )}
          </p>
          <p>
            {t("settings.debug.runtimeDiagnostics.microphonePermission", {
              defaultValue: "Microphone permission",
            })}
            :{" "}
            <span className="font-semibold">
              {snapshot.microphone_permission_state}
            </span>
          </p>
          {snapshot.device_resolution && (
            <p>
              {t("settings.debug.runtimeDiagnostics.deviceResolution", {
                defaultValue: "Device resolution",
              })}
              :{" "}
              <span className="font-semibold">
                {snapshot.device_resolution}
              </span>
            </p>
          )}
          {snapshot.last_audio_error && (
            <p className="break-words">
              {t("settings.debug.runtimeDiagnostics.lastAudioError", {
                defaultValue: "Last audio error",
              })}
              :{" "}
              <span className="font-semibold">{snapshot.last_audio_error}</span>
            </p>
          )}
          <p>
            {t("settings.debug.runtimeDiagnostics.updatedAt", {
              defaultValue: "Captured at",
            })}
            : {new Date(snapshot.captured_at_ms).toLocaleString(i18n.language)}
          </p>
          {snapshot.machine_status && (
            <p>
              {t("settings.debug.runtimeDiagnostics.machineStatus", {
                defaultValue: "Machine status",
              })}
              :{" "}
              <span className="font-semibold">
                {snapshot.machine_status.headline}
              </span>
              {` Â· ${snapshot.machine_status.detail}`}
            </p>
          )}
          {snapshot.current_app_context && (
            <p>
              {t("settings.debug.runtimeDiagnostics.currentAppContext", {
                defaultValue: "Current app context",
              })}
              :{" "}
              <span className="font-semibold">
                {snapshot.current_app_context.category}
              </span>
              {snapshot.current_app_context.process_name
                ? ` Â· ${snapshot.current_app_context.process_name}`
                : ""}
              {snapshot.current_app_context.window_title
                ? ` Â· ${snapshot.current_app_context.window_title}`
                : ""}
            </p>
          )}
          {snapshot.last_transcription_app_context && (
            <p>
              {t("settings.debug.runtimeDiagnostics.lastAppContext", {
                defaultValue: "Last transcription context",
              })}
              :{" "}
              <span className="font-semibold">
                {snapshot.last_transcription_app_context.category}
              </span>
              {snapshot.last_transcription_app_context.process_name
                ? ` Â· ${snapshot.last_transcription_app_context.process_name}`
                : ""}
              {snapshot.last_transcription_app_context.window_title
                ? ` Â· ${snapshot.last_transcription_app_context.window_title}`
                : ""}
            </p>
          )}
          {snapshot.adaptive_voice_profile_enabled &&
            snapshot.adaptive_voice_profile && (
              <>
                <p>
                  {t("settings.debug.runtimeDiagnostics.voiceProfile", {
                    defaultValue: "Voice profile",
                  })}
                  :{" "}
                  <span className="font-semibold">{voiceProfileSessions}</span>
                  {" · "}
                  <span className="text-text/60">{voiceProfileWpm}</span>
                  {" · "}
                  <span className="text-text/60">{voiceProfilePauses}</span>
                </p>
                {snapshot.active_voice_runtime_adjustment && (
                  <p>
                    {t("settings.debug.runtimeDiagnostics.voiceAdjustment", {
                      defaultValue: "Voice adjustment",
                    })}
                    :{" "}
                    <span className="font-semibold">
                      {voiceAdjustmentValue}
                    </span>
                    {snapshot.active_voice_runtime_adjustment.reason
                      ? ` Â· ${snapshot.active_voice_runtime_adjustment.reason}`
                      : ""}
                  </p>
                )}
                {snapshot.adaptive_voice_profile.preferred_terms.length > 0 && (
                  <p className="truncate">
                    {t("settings.debug.runtimeDiagnostics.voiceTerms", {
                      defaultValue: "Preferred terms",
                    })}
                    :{" "}
                    <span className="text-text/60">
                      {snapshot.adaptive_voice_profile.preferred_terms
                        .slice(0, 8)
                        .join(", ")}
                    </span>
                  </p>
                )}
              </>
            )}
          {snapshot.active_voice_profile_segment && (
            <>
              <p>
                {t("settings.debug.runtimeDiagnostics.activeVoiceProfile", {
                  defaultValue: "Active voice segment",
                })}
                :{" "}
                <span className="font-semibold">
                  {activeVoiceProfileSessions}
                </span>
                {" Ã‚Â· "}
                <span className="text-text/60">{activeVoiceProfileWpm}</span>
                {" Ã‚Â· "}
                <span className="text-text/60">{activeVoiceProfilePauses}</span>
              </p>
              {snapshot.active_voice_profile_segment.preferred_terms.length >
                0 && (
                <p className="truncate">
                  {t("settings.debug.runtimeDiagnostics.activeVoiceTerms", {
                    defaultValue: "Active segment terms",
                  })}
                  :{" "}
                  <span className="text-text/60">
                    {snapshot.active_voice_profile_segment.preferred_terms
                      .slice(0, 8)
                      .join(", ")}
                  </span>
                </p>
              )}
            </>
          )}
          {recentErrors.length > 0 && (
            <div className="pt-1">
              <p className="font-semibold mb-1">
                {t("settings.debug.runtimeDiagnostics.recentErrors", {
                  defaultValue: "Recent runtime errors",
                })}
              </p>
              {recentErrors.map((err) => (
                <p key={`${err.code}-${err.timestamp_ms}`} className="truncate">
                  [{err.stage}] {err.code}: {err.message}
                </p>
              ))}
            </div>
          )}
          {parakeetSessions.length > 0 && (
            <div className="pt-1">
              <p className="font-semibold mb-1">
                {t("settings.debug.runtimeDiagnostics.parakeetSessions", {
                  defaultValue: "Parakeet quality sessions",
                })}
              </p>
              {parakeetSessions.slice(0, 3).map((session) => (
                <p
                  key={`${session.session_id}-${session.last_updated_ms}`}
                  className="break-words"
                >
                  {session.model_name || session.model_id}
                  {" · "}
                  {session.selected_language}
                  {" · "}
                  {session.total_chunks} chunks
                  {" · "}
                  {session.retry_chunks} retries
                  {" · "}
                  {session.filtered_chunks} filtered
                  {" Â· risk "}
                  {(session.quality_risk_score * 100).toFixed(0)}%
                  {" · "}
                  {session.estimated_issue}
                  {session.assembled_preview
                    ? ` Â· ${session.assembled_preview}`
                    : ""}
                </p>
              ))}
            </div>
          )}
          {calibrationStates.length > 0 && (
            <div className="pt-1">
              <p className="font-semibold mb-1">
                {t("settings.debug.runtimeDiagnostics.calibration", {
                  defaultValue: "Adaptive calibration",
                })}
              </p>
              {calibrationStates.slice(0, 4).map((entry) => (
                <p
                  key={`${entry.model_id}-${entry.phase}`}
                  className="truncate"
                >
                  {entry.model_id} [{entry.phase}] {entry.state}
                  {entry.detail ? ` â€” ${entry.detail}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </SettingContainer>
  );
};


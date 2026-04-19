/* eslint-disable i18next/no-literal-string */
import React, { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import type { RuntimeDiagnosticsSnapshot } from "../../../types/runtimeObservability";

interface VoiceFeedbackEntry {
  id: string;
  created_at_ms: number;
  expected_text: string;
  actual_text: string;
  notes?: string | null;
  selected_language?: string | null;
  tags: string[];
  keep_audio_reference: boolean;
  runtime: RuntimeDiagnosticsSnapshot;
}

interface VoiceFeedbackSummary {
  total_entries: number;
  top_languages: [string, number][];
  top_tags: [string, number][];
  top_input_levels: [string, number][];
  top_issues: [string, number][];
}

export const ParakeetLab: React.FC<{ grouped?: boolean }> = ({
  grouped = true,
}) => {
  const { t, i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    null,
  );
  const [feedbackEntries, setFeedbackEntries] = useState<VoiceFeedbackEntry[]>(
    [],
  );
  const [feedbackSummary, setFeedbackSummary] =
    useState<VoiceFeedbackSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const sessions = useMemo(
    () =>
      (snapshot?.parakeet_diagnostics?.recent_sessions ?? []).slice().reverse(),
    [snapshot],
  );
  const active = snapshot?.parakeet_diagnostics?.active_session ?? null;
  const activeVoiceSegment = snapshot?.active_voice_profile_segment ?? null;
  const activeVoiceAdjustment =
    snapshot?.active_voice_runtime_adjustment ?? null;

  const refresh = async () => {
    setBusy(true);
    try {
      const [data, feedback, summary] = await Promise.all([
        invoke<RuntimeDiagnosticsSnapshot>("get_runtime_diagnostics"),
        invoke<VoiceFeedbackEntry[]>("list_voice_feedback_command", {
          limit: 6,
        }),
        invoke<VoiceFeedbackSummary>("summarize_voice_feedback_command", {
          limit: 200,
        }),
      ]);
      setSnapshot(data);
      setFeedbackEntries(feedback);
      setFeedbackSummary(summary);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingContainer
      title={t("settings.debug.parakeetLab.title", {
        defaultValue: "Parakeet Lab",
      })}
      description={t("settings.debug.parakeetLab.description", {
        defaultValue:
          "Inspect recent Parakeet V3 chunking and quality signals while tuning long dictation behavior.",
      })}
      grouped={grouped}
      layout="stacked"
    >
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={refresh} disabled={busy}>
          {t("settings.debug.parakeetLab.refresh", {
            defaultValue: "Refresh",
          })}
        </Button>
      </div>

      {(active || sessions.length > 0 || snapshot) && (
        <div className="mt-2 space-y-3 rounded-lg border border-mid-gray/20 p-3 text-xs text-text/80">
          <div className="rounded-md border border-white/8 bg-white/[0.02] p-2">
            <p className="font-semibold">
              {t("settings.debug.parakeetLab.runtime", {
                defaultValue: "Runtime view",
              })}
            </p>
            <p>
              model{" "}
              {snapshot?.loaded_model_name ||
                snapshot?.loaded_model_id ||
                "n/a"}
              {" · "}
              lang {snapshot?.selected_language || "n/a"}
              {" · "}
              input {snapshot?.input_level_state || "unknown"}
            </p>
            {activeVoiceAdjustment && (
              <p>
                adjustment {activeVoiceAdjustment.adjusted_chunk_seconds}s
                {" / "}
                {activeVoiceAdjustment.adjusted_overlap_ms}ms
                {activeVoiceAdjustment.reason
                  ? ` · ${activeVoiceAdjustment.reason}`
                  : ""}
              </p>
            )}
            {activeVoiceSegment && (
              <>
                <p>
                  voice segment {activeVoiceSegment.sessions_count} sessions
                  {" · "}
                  {activeVoiceSegment.avg_words_per_minute.toFixed(0)} wpm
                  {" · "}
                  {activeVoiceSegment.avg_pause_ms.toFixed(0)} ms pauses
                </p>
                {activeVoiceSegment.preferred_terms.length > 0 && (
                  <p className="break-words text-text/60">
                    {activeVoiceSegment.preferred_terms.slice(0, 10).join(", ")}
                  </p>
                )}
              </>
            )}
          </div>

          {active && (
            <div>
              <p className="font-semibold">
                {t("settings.debug.parakeetLab.active", {
                  defaultValue: "Active session",
                })}
              </p>
              <p>
                {active.model_name || active.model_id}
                {" · "}
                {active.selected_language}
                {" · "}
                {active.recording_mode}
              </p>
              <p>
                chunks sent {active.chunk_candidates_sent}
                {" · rejected "}
                {active.chunk_candidates_rejected}
              </p>
              <p>
                retries {active.retry_chunks}
                {" · filtered "}
                {active.filtered_chunks}
                {" · recovered "}
                {active.finalization_recoveries}
              </p>
              <p>
                risk {(active.quality_risk_score * 100).toFixed(0)}%
                {" · issue "}
                {active.estimated_issue}
                {" · density "}
                {active.audio_to_word_ratio.toFixed(2)} w/s
              </p>
            </div>
          )}

          {sessions.length > 0 && (
            <div>
              <p className="mb-1 font-semibold">
                {t("settings.debug.parakeetLab.recent", {
                  defaultValue: "Recent sessions",
                })}
              </p>
              <div className="space-y-2">
                {sessions.slice(0, 5).map((session) => (
                  <div
                    key={`${session.session_id}-${session.last_updated_ms}`}
                    className="rounded-md border border-white/8 bg-white/[0.02] p-2"
                  >
                    <p className="font-medium">
                      {session.model_name || session.model_id}
                      {" · "}
                      {session.selected_language}
                      {" · risk "}
                      {(session.quality_risk_score * 100).toFixed(0)}%
                    </p>
                    <p>
                      {session.total_chunks} chunks
                      {" · "}
                      {session.retry_chunks} retries
                      {" · "}
                      {session.filtered_chunks} filtered
                      {" · "}
                      {session.finalization_recoveries} recovered
                      {" · "}
                      {session.trimmed_words_total} trimmed words
                    </p>
                    <p>
                      issue: {session.estimated_issue}
                      {" · "}
                      density: {session.audio_to_word_ratio.toFixed(2)} w/s
                    </p>
                    {session.assembled_preview && (
                      <p className="break-words text-text/60">
                        {session.assembled_preview}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {feedbackEntries.length > 0 && (
            <div>
              <p className="mb-1 font-semibold">
                {t("settings.debug.parakeetLab.feedback", {
                  defaultValue: "Recent real-world failures",
                })}
              </p>
              {feedbackSummary && (
                <div className="mb-2 rounded-md border border-white/8 bg-white/[0.02] p-2">
                  <p className="font-medium">
                    {feedbackSummary.total_entries} feedback entries
                  </p>
                  {feedbackSummary.top_issues.length > 0 && (
                    <p>
                      top issues:{" "}
                      {feedbackSummary.top_issues
                        .map(([label, count]) => `${label} (${count})`)
                        .join(", ")}
                    </p>
                  )}
                  {feedbackSummary.top_input_levels.length > 0 && (
                    <p>
                      input levels:{" "}
                      {feedbackSummary.top_input_levels
                        .map(([label, count]) => `${label} (${count})`)
                        .join(", ")}
                    </p>
                  )}
                  {feedbackSummary.top_languages.length > 0 && (
                    <p>
                      languages:{" "}
                      {feedbackSummary.top_languages
                        .map(([label, count]) => `${label} (${count})`)
                        .join(", ")}
                    </p>
                  )}
                  {feedbackSummary.top_tags.length > 0 && (
                    <p className="break-words">
                      tags:{" "}
                      {feedbackSummary.top_tags
                        .map(([label, count]) => `${label} (${count})`)
                        .join(", ")}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {feedbackEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-white/8 bg-white/[0.02] p-2"
                  >
                    <p className="font-medium">
                      {new Date(entry.created_at_ms).toLocaleString(
                        i18n.language,
                      )}
                      {entry.selected_language
                        ? ` · ${entry.selected_language}`
                        : ""}
                      {entry.tags.length > 0
                        ? ` · ${entry.tags.join(", ")}`
                        : ""}
                    </p>
                    <p>
                      model{" "}
                      {entry.runtime.loaded_model_name ||
                        entry.runtime.loaded_model_id ||
                        entry.runtime.selected_model}
                      {" · "}
                      input {entry.runtime.input_level_state}
                      {" · "}
                      lifecycle {entry.runtime.lifecycle_state}
                    </p>
                    {entry.runtime.active_voice_runtime_adjustment && (
                      <p>
                        adjust{" "}
                        {
                          entry.runtime.active_voice_runtime_adjustment
                            .adjusted_chunk_seconds
                        }
                        s{" / "}
                        {
                          entry.runtime.active_voice_runtime_adjustment
                            .adjusted_overlap_ms
                        }
                        ms
                        {entry.runtime.active_voice_runtime_adjustment.reason
                          ? ` · ${entry.runtime.active_voice_runtime_adjustment.reason}`
                          : ""}
                      </p>
                    )}
                    {entry.runtime.parakeet_diagnostics.active_session && (
                      <p>
                        risk{" "}
                        {(
                          entry.runtime.parakeet_diagnostics.active_session
                            .quality_risk_score * 100
                        ).toFixed(0)}
                        %{" · "}
                        {
                          entry.runtime.parakeet_diagnostics.active_session
                            .estimated_issue
                        }
                        {" · recovered "}
                        {
                          entry.runtime.parakeet_diagnostics.active_session
                            .finalization_recoveries
                        }
                      </p>
                    )}
                    {entry.expected_text && (
                      <p className="break-words text-text/70">
                        expected: {entry.expected_text}
                      </p>
                    )}
                    {entry.actual_text && (
                      <p className="break-words text-text/55">
                        actual: {entry.actual_text}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="break-words text-text/50">{entry.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SettingContainer>
  );
};

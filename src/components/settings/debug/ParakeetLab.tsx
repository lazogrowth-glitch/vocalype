import React, { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import type { RuntimeDiagnosticsSnapshot } from "../../../types/runtimeObservability";

export const ParakeetLab: React.FC<{ grouped?: boolean }> = ({
  grouped = true,
}) => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const sessions = useMemo(
    () => (snapshot?.parakeet_diagnostics?.recent_sessions ?? []).slice().reverse(),
    [snapshot],
  );
  const active = snapshot?.parakeet_diagnostics?.active_session ?? null;

  const refresh = async () => {
    setBusy(true);
    try {
      const data = await invoke<RuntimeDiagnosticsSnapshot>(
        "get_runtime_diagnostics",
      );
      setSnapshot(data);
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
        <Button
          size="sm"
          variant="secondary"
          onClick={refresh}
          disabled={busy}
        >
          {t("settings.debug.parakeetLab.refresh", {
            defaultValue: "Refresh",
          })}
        </Button>
      </div>

      {(active || sessions.length > 0) && (
        <div className="mt-2 space-y-3 rounded-lg border border-mid-gray/20 p-3 text-xs text-text/80">
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
        </div>
      )}
    </SettingContainer>
  );
};

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { Textarea } from "../../ui/Textarea";

interface VoiceFeedbackEntry {
  id: string;
  created_at_ms: number;
  expected_text: string;
  actual_text: string;
  notes?: string | null;
  selected_language?: string | null;
  tags: string[];
  keep_audio_reference: boolean;
}

interface VoiceFeedbackInput {
  expected_text: string;
  actual_text: string;
  notes?: string | null;
  selected_language?: string | null;
  tags: string[];
  keep_audio_reference: boolean;
}

const fieldClasses =
  "w-full rounded-md border border-mid-gray/80 bg-mid-gray/10 px-3 py-2 text-sm font-semibold text-white/85 transition-[background-color,border-color] duration-150 hover:bg-logo-primary/10 hover:border-logo-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background focus:bg-logo-primary/10 focus:border-logo-primary";

export const VoiceFeedbackPanel: React.FC<{ grouped?: boolean }> = ({
  grouped = true,
}) => {
  const { t, i18n } = useTranslation();
  const [expectedText, setExpectedText] = useState("");
  const [actualText, setActualText] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [tags, setTags] = useState("");
  const [keepAudioReference, setKeepAudioReference] = useState(false);
  const [entries, setEntries] = useState<VoiceFeedbackEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadEntries = async () => {
    const data = await invoke<VoiceFeedbackEntry[]>("list_voice_feedback_command", {
      limit: 8,
    });
    setEntries(data);
  };

  useEffect(() => {
    void loadEntries();
  }, []);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const payload: VoiceFeedbackInput = {
        expected_text: expectedText,
        actual_text: actualText,
        notes: notes.trim() || null,
        selected_language: selectedLanguage.trim() || null,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        keep_audio_reference: keepAudioReference,
      };
      await invoke<VoiceFeedbackEntry>("submit_voice_feedback_command", {
        input: payload,
      });
      setStatus(
        t("settings.debug.voiceFeedback.saved", {
          defaultValue: "Voice feedback saved",
        }),
      );
      setExpectedText("");
      setActualText("");
      setNotes("");
      setTags("");
      setKeepAudioReference(false);
      await loadEntries();
    } catch (error) {
      setStatus(
        t("settings.debug.voiceFeedback.saveFailed", {
          defaultValue: "Save failed: {{error}}",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 3000);
    }
  };

  return (
    <SettingContainer
      title={t("settings.debug.voiceFeedback.title", {
        defaultValue: "Voice Feedback",
      })}
      description={t("settings.debug.voiceFeedback.description", {
        defaultValue:
          "Save real transcription failures with runtime context so we can improve the voice pipeline from real usage.",
      })}
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-3">
        <Textarea
          value={expectedText}
          onChange={(event) => setExpectedText(event.target.value)}
          placeholder={t("settings.debug.voiceFeedback.expected", {
            defaultValue: "What you meant to say",
          })}
          variant="compact"
        />
        <Textarea
          value={actualText}
          onChange={(event) => setActualText(event.target.value)}
          placeholder={t("settings.debug.voiceFeedback.actual", {
            defaultValue: "What the app wrote",
          })}
          variant="compact"
        />
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t("settings.debug.voiceFeedback.notes", {
            defaultValue: "Notes: low voice, noisy room, French drift, weird punctuation...",
          })}
          variant="compact"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className={fieldClasses}
            value={selectedLanguage}
            onChange={(event) => setSelectedLanguage(event.target.value)}
            placeholder={t("settings.debug.voiceFeedback.language", {
              defaultValue: "Language, e.g. en or fr",
            })}
          />
          <input
            className={fieldClasses}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={t("settings.debug.voiceFeedback.tags", {
              defaultValue: "Tags, comma-separated",
            })}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-text/70">
          <input
            type="checkbox"
            checked={keepAudioReference}
            onChange={(event) => setKeepAudioReference(event.target.checked)}
          />
          {t("settings.debug.voiceFeedback.keepAudio", {
            defaultValue: "Keep audio reference flag for follow-up review",
          })}
        </label>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSubmit}
            disabled={busy || (!expectedText.trim() && !actualText.trim())}
          >
            {t("settings.debug.voiceFeedback.submit", {
              defaultValue: "Save Feedback",
            })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void loadEntries()}>
            {t("settings.debug.voiceFeedback.refresh", {
              defaultValue: "Refresh",
            })}
          </Button>
          {status && <span className="text-xs text-mid-gray">{status}</span>}
        </div>

        {entries.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold text-white/80">
              {t("settings.debug.voiceFeedback.recent", {
                defaultValue: "Recent feedback",
              })}
            </p>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-md border border-white/8 bg-white/[0.02] p-2 text-xs text-text/75"
              >
                <p className="font-medium text-white/80">
                  {new Date(entry.created_at_ms).toLocaleString(i18n.language)}
                  {entry.selected_language ? ` · ${entry.selected_language}` : ""}
                  {entry.tags.length > 0 ? ` · ${entry.tags.join(", ")}` : ""}
                </p>
                {entry.expected_text && (
                  <p className="break-words">
                    <span className="text-text/55">
                      {t("settings.debug.voiceFeedback.expectedLabel", {
                        defaultValue: "Expected",
                      })}
                      :
                    </span>{" "}
                    {entry.expected_text}
                  </p>
                )}
                {entry.actual_text && (
                  <p className="break-words">
                    <span className="text-text/55">
                      {t("settings.debug.voiceFeedback.actualLabel", {
                        defaultValue: "Actual",
                      })}
                      :
                    </span>{" "}
                    {entry.actual_text}
                  </p>
                )}
                {entry.notes && (
                  <p className="break-words text-text/60">{entry.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingContainer>
  );
};

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AudioPlayer } from "../../ui/AudioPlayer";
import {
  Copy,
  Star,
  Check,
  Trash2,
  RefreshCw,
  Loader2,
  Download,
  FileAudio,
  Eraser,
  Sparkles,
  Pencil,
  X,
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  commands,
  type HistoryEntry,
  type PostProcessAction,
} from "@/bindings";
import { formatDateTime } from "@/utils/dateFormat";
import { useOsType } from "@/hooks/useOsType";
import { useModelStore } from "@/stores/modelStore";
import { ConfidenceText } from "./ConfidenceText";
import { usePlan } from "@/lib/subscription/context";
import { Button } from "../../ui/Button";
import { useSettings } from "@/hooks/useSettings";

const PAGE_SIZE = 30;

// ── Correction types ──────────────────────────────────────────────────────────

interface CorrectionSuggestion {
  from: string;
  to: string;
  count: number;
  already_in_dict: boolean;
  auto_add: boolean;
}

// ── Correction suggestion banner ──────────────────────────────────────────────

const CorrectionBanner: React.FC<{
  suggestions: CorrectionSuggestion[];
  onConfirm: (s: CorrectionSuggestion) => void;
  onDismiss: (s: CorrectionSuggestion) => void;
}> = ({ suggestions, onConfirm, onDismiss }) => {
  const { t } = useTranslation();
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {suggestions.map((s) => (
        <div
          key={s.from}
          className="flex items-center justify-between gap-3 rounded-lg border border-logo-primary/20 bg-logo-primary/[0.06] px-3 py-2"
        >
          <span className="text-[12px] text-white/70">
            {t("settings.history.correctionSuggestion", {
              defaultValue: 'Toujours remplacer "{{from}}" par "{{to}}" ?',
              from: s.from,
              to: s.to,
            })}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onConfirm(s)}
              className="rounded-md bg-logo-primary/20 px-2.5 py-1 text-[11px] font-medium text-logo-primary transition-colors hover:bg-logo-primary/30"
            >
              {t("settings.history.correctionYes", { defaultValue: "Oui" })}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(s)}
              className="rounded-md px-2 py-1 text-[11px] text-white/40 transition-colors hover:text-white/60"
            >
              {t("settings.history.correctionNo", { defaultValue: "Ignorer" })}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    type="button"
    onClick={onClick}
    variant="secondary"
    size="sm"
    title={label}
  >
    {label}
  </Button>
);

// ── Export button ─────────────────────────────────────────────────────────────

const ExportHistoryButton: React.FC = () => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      const filePath = await save({
        defaultPath: `vocalype-history-${new Date().toISOString().slice(0, 10)}.txt`,
        filters: [
          { name: "Texte", extensions: ["txt"] },
          { name: "CSV", extensions: ["csv"] },
          { name: "Markdown", extensions: ["md"] },
          { name: "JSON", extensions: ["json"] },
        ],
      });
      if (!filePath) return;

      setExporting(true);
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "txt";
      const format = ["csv", "md", "json"].includes(ext) ? ext : "txt";

      const result = await commands.exportHistoryEntries(format);
      if (result.status === "ok") {
        await writeTextFile(filePath, result.data);
        toast.success(
          t("settings.history.exportSuccess", {
            defaultValue: "Historique exporté.",
          }),
        );
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      console.error(e);
      toast.error(
        t("settings.history.exportError", {
          defaultValue: "Échec de l'export.",
        }),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handleExport}
      disabled={exporting}
      variant="primary-soft"
      size="sm"
      className="inline-flex items-center gap-2"
      title={t("settings.history.exportMyData", {
        defaultValue: "Exporter mes données",
      })}
    >
      {exporting ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Download size={11} />
      )}
      {t("settings.history.exportMyData", {
        defaultValue: "Exporter mes données",
      })}
    </Button>
  );
};

// ── Clear all history button ───────────────────────────────────────────────────

const ClearAllHistoryButton: React.FC<{ onCleared: () => void }> = ({
  onCleared,
}) => {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try {
      await invoke("clear_all_history");
      toast.success(
        t("settings.history.clearAllSuccess", {
          defaultValue: "Historique effacé.",
        }),
      );
      setConfirmDeleteAll(false);
      onCleared();
    } catch (e) {
      console.error(e);
      toast.error(
        t("settings.history.clearAllError", {
          defaultValue: "Échec de la suppression de l'historique.",
        }),
      );
    } finally {
      setClearing(false);
    }
  };

  if (confirmDeleteAll) {
    return (
      <div
        role="alertdialog"
        aria-live="assertive"
        className="flex items-center gap-2 flex-wrap"
      >
        <span className="text-sm text-text/80">
          {t("settings.history.confirmDeleteAllMessage")}
        </span>
        <button
          autoFocus
          onClick={handleClear}
          disabled={clearing}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-red-500/14 px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-40"
        >
          {clearing ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            t("settings.history.confirmYes")
          )}
        </button>
        <button
          onClick={() => setConfirmDeleteAll(false)}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-text/70 transition-colors hover:bg-white/[0.07] hover:text-text/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary"
        >
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      onClick={() => setConfirmDeleteAll(true)}
      disabled={clearing}
      variant="danger-ghost"
      size="sm"
      className="inline-flex items-center gap-2 rounded-xl border border-red-500/18 bg-red-500/[0.04] text-red-300/78 hover:border-red-500/28 hover:bg-red-500/[0.08] hover:text-red-200"
      title={t("settings.history.clearAll", {
        defaultValue: "Effacer tout l'historique",
      })}
    >
      {clearing ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Eraser size={11} />
      )}
      {t("settings.history.clearAll", {
        defaultValue: "Effacer tout l'historique",
      })}
    </Button>
  );
};

// ── Transcribe from file button ───────────────────────────────────────────────

const TranscribeFileButton: React.FC = () => {
  const { t } = useTranslation();
  const [transcribing, setTranscribing] = useState(false);

  const handleTranscribeFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "flac"] }],
      });
      if (!selected || typeof selected !== "string") return;

      setTranscribing(true);
      const result = await commands.transcribeAudioFile(selected);
      if (result.status === "ok") {
        await navigator.clipboard.writeText(result.data);
        toast.success(
          t("settings.history.transcribeFileSuccess", {
            defaultValue: "Transcription copiée dans le presse-papier.",
          }),
        );
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      console.error(e);
      toast.error(
        t("settings.history.transcribeFileError", {
          defaultValue: "Échec de la transcription du fichier.",
        }),
      );
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handleTranscribeFile}
      disabled={transcribing}
      variant="secondary"
      size="sm"
      className="inline-flex items-center gap-2"
      title={t("settings.history.transcribeFile", {
        defaultValue: "Transcrire un fichier",
      })}
    >
      {transcribing ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <FileAudio size={11} />
      )}
      {t("settings.history.transcribeFile", {
        defaultValue: "Transcrire un fichier",
      })}
    </Button>
  );
};

const BASIC_HISTORY_LIMIT = 5;

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const { isBasicTier, onStartCheckout } = usePlan();
  const { getSetting } = useSettings();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const postProcessActions = getSetting("post_process_actions") || [];

  const handleConfigureActions = () => {
    window.dispatchEvent(
      new CustomEvent("vocalype:navigate-settings", {
        detail: "postprocessing",
      }),
    );
  };

  const loadHistoryEntries = useCallback(async () => {
    try {
      const [entries, more] = await invoke<[HistoryEntry[], boolean]>(
        "get_history_entries_paginated",
        { limit: PAGE_SIZE, offset: 0 },
      );
      setHistoryEntries(entries);
      setHasMore(more);
      setOffset(PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreEntries = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const [entries, more] = await invoke<[HistoryEntry[], boolean]>(
        "get_history_entries_paginated",
        { limit: PAGE_SIZE, offset },
      );
      setHistoryEntries((prev) => [...prev, ...entries]);
      setHasMore(more);
      setOffset((prev) => prev + PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load more history entries:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, offset]);

  useEffect(() => {
    loadHistoryEntries();

    // Listen for history update events
    const setupListener = async () => {
      const unlisten = await listen("history-updated", () => {
        loadHistoryEntries();
      });

      // Return cleanup function
      return unlisten;
    };

    const unlistenPromise = setupListener();

    return () => {
      unlistenPromise.then((unlisten) => {
        if (unlisten) {
          unlisten();
        }
      });
    };
  }, [loadHistoryEntries]);

  const toggleSaved = async (id: number) => {
    try {
      await commands.toggleHistoryEntrySaved(id);
      // No need to reload here - the event listener will handle it
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast.error(
        t("settings.history.copyFailed", {
          defaultValue: "Failed to copy transcription.",
        }),
      );
      return false;
    }
  };

  const getAudioUrl = useCallback(
    async (fileName: string) => {
      try {
        const result = await commands.getAudioFilePath(fileName);
        if (result.status === "ok") {
          if (osType === "linux") {
            const fileData = await readFile(result.data);
            const blob = new Blob([fileData], { type: "audio/wav" });

            return URL.createObjectURL(blob);
          }

          return convertFileSrc(result.data, "asset");
        }
        return null;
      } catch (error) {
        console.error("Failed to get audio file path:", error);
        return null;
      }
    },
    [osType],
  );

  const pendingDeletesRef = useRef<
    Map<
      number,
      { entry: HistoryEntry; timeoutId: ReturnType<typeof setTimeout> }
    >
  >(new Map());

  const deleteAudioEntry = async (id: number) => {
    try {
      await commands.deleteHistoryEntry(id);
    } catch (error) {
      console.error("Failed to delete audio entry:", error);
      throw error;
    }
  };

  const handleDeleteWithUndo = useCallback(
    (entry: HistoryEntry) => {
      // Optimistically remove from UI
      setHistoryEntries((prev) => prev.filter((e) => e.id !== entry.id));

      const timeoutId = setTimeout(async () => {
        pendingDeletesRef.current.delete(entry.id);
        try {
          await invoke("delete_history_entry", { id: entry.id });
        } catch {
          // Restore if backend fails
          setHistoryEntries((prev) =>
            [entry, ...prev].sort(
              (a, b) => Number(b.timestamp) - Number(a.timestamp),
            ),
          );
          toast.error(t("settings.history.deleteError"));
        }
      }, 5000);

      pendingDeletesRef.current.set(entry.id, { entry, timeoutId });

      toast(t("settings.history.deletedUndo"), {
        duration: 5000,
        action: {
          label: t("settings.history.undo"),
          onClick: () => {
            const pending = pendingDeletesRef.current.get(entry.id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingDeletesRef.current.delete(entry.id);
              setHistoryEntries((prev) =>
                [entry, ...prev].sort(
                  (a, b) => Number(b.timestamp) - Number(a.timestamp),
                ),
              );
            }
          },
        },
      });
    },
    [t],
  );

  useEffect(() => {
    return () => {
      pendingDeletesRef.current.forEach(({ timeoutId, entry }) => {
        clearTimeout(timeoutId);
        invoke("delete_history_entry", { id: entry.id }).catch(console.error);
      });
    };
  }, []);

  const openRecordingsFolder = async () => {
    try {
      await commands.openRecordingsFolder();
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  if (loading) {
    return (
      <div
        className="w-full"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
            {t("settings.history.title")}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <TranscribeFileButton />
            <ExportHistoryButton />
            <OpenRecordingsButton
              onClick={openRecordingsFolder}
              label={t("settings.history.openFolder")}
            />
          </div>
        </div>
        <div
          style={{ padding: "10px 16px" }}
          className="text-center text-text/60"
        >
          {t("settings.history.loading")}
        </div>
      </div>
    );
  }

  if (historyEntries.length === 0) {
    return (
      <div
        className="w-full"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
            {t("settings.history.title")}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <TranscribeFileButton />
            <OpenRecordingsButton
              onClick={openRecordingsFolder}
              label={t("settings.history.openFolder")}
            />
          </div>
        </div>
        <div
          style={{ padding: "10px 16px" }}
          className="text-center text-text/60"
        >
          {t("settings.history.empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <h2 className="text-[18px] font-bold tracking-[0] text-white/90">
            {t("settings.history.title")}
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-white/58">
            {t("shell.sectionDescriptions.history")}
          </p>
        </div>

        <div className="settings-group-card">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              padding: "20px 24px",
            }}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <TranscribeFileButton />
              <ExportHistoryButton />
              <OpenRecordingsButton
                onClick={openRecordingsFolder}
                label={t("settings.history.openFolder")}
              />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{ position: "relative", flex: "1 1 560px", minWidth: 0 }}
              >
                <svg
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                  }}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-white/30"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("settings.history.search", {
                    defaultValue: "Rechercher une transcription…",
                  })}
                  style={{ padding: "12px 16px 12px 38px", width: "100%" }}
                  className="rounded-[8px] border border-border bg-surface text-[13px] text-white/82 placeholder-white/25 outline-none transition-all focus:border-logo-primary/35 focus:bg-surface-elevated"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                    className="text-white/30 transition-colors hover:text-white/60"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ClearAllHistoryButton onCleared={loadHistoryEntries} />
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-visible">
          {isBasicTier && historyEntries.length > BASIC_HISTORY_LIMIT && (
            <div
              style={{
                padding: "10px 16px",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-[12px]"
            >
              <span className="text-amber-300/80">
                {t("basic.historyLimited", {
                  defaultValue: `Historique limité à ${BASIC_HISTORY_LIMIT} entrées en Basic`,
                  limit: BASIC_HISTORY_LIMIT,
                })}
              </span>
              <button
                type="button"
                onClick={() =>
                  onStartCheckout().then(
                    (url) => url && window.open(url, "_blank"),
                  )
                }
                style={{ padding: "10px 16px" }}
                className="ml-3 shrink-0 rounded bg-amber-500/20 text-amber-300 transition-colors hover:bg-amber-500/30"
              >
                {t("basic.upgrade", { defaultValue: "Passer à Premium" })}
              </button>
            </div>
          )}
          {postProcessActions.length === 0 && (
            <div
              className="voca-surface mb-4 text-[12.5px] leading-6 text-white/42"
              style={{ padding: "20px 24px" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-logo-primary/14 bg-logo-primary/[0.08] text-logo-primary">
                    <Sparkles size={14} aria-hidden="true" />
                  </span>
                  <span className="max-w-[680px]">
                    {t("settings.history.noAiActionsHint", {
                      defaultValue:
                        "Créez une action dans Post-traitement pour corriger, résumer ou reformater vos anciennes dictées ici.",
                    })}
                  </span>
                </div>
                <Button
                  type="button"
                  onClick={handleConfigureActions}
                  variant="primary-soft"
                  size="sm"
                  className="shrink-0"
                >
                  {t("settings.history.configureActions", {
                    defaultValue: "Configurer les actions",
                  })}
                </Button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {(isBasicTier
              ? historyEntries.slice(0, BASIC_HISTORY_LIMIT)
              : historyEntries
            )
              .filter(
                (entry) =>
                  !searchQuery.trim() ||
                  entry.transcription_text
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                  (entry.post_processed_text ?? "")
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
              )
              .map((entry) => (
                <HistoryEntryComponent
                  key={entry.id}
                  entry={entry}
                  onToggleSaved={() => toggleSaved(entry.id)}
                  onCopyText={() =>
                    copyToClipboard(
                      entry.post_processed_text ?? entry.transcription_text,
                    )
                  }
                  getAudioUrl={getAudioUrl}
                  deleteAudio={deleteAudioEntry}
                  onDeleteWithUndo={handleDeleteWithUndo}
                  postProcessActions={postProcessActions}
                  onActionApplied={loadHistoryEntries}
                  onStartCheckout={onStartCheckout}
                />
              ))}
            {searchQuery.trim() &&
              (isBasicTier
                ? historyEntries.slice(0, BASIC_HISTORY_LIMIT)
                : historyEntries
              ).filter(
                (e) =>
                  e.transcription_text
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                  (e.post_processed_text ?? "")
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
              ).length === 0 && (
                <div
                  style={{ padding: "32px 16px" }}
                  className="text-center text-[13px] text-white/30 italic"
                >
                  {t("settings.history.noResults", {
                    defaultValue: "Aucun résultat pour « " + searchQuery + " »",
                  })}
                </div>
              )}
          </div>
          {hasMore && !searchQuery && (
            <div className="pt-3 pb-1 flex justify-center">
              <button
                type="button"
                onClick={loadMoreEntries}
                disabled={loadingMore}
                className="text-[12px] text-white/30 transition-colors hover:text-white/55 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore
                  ? t("settings.history.loadingMore", {
                      defaultValue: "Loading…",
                    })
                  : t("settings.history.loadMore", {
                      defaultValue: "Load more",
                    })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  onToggleSaved: () => void;
  onCopyText: () => Promise<boolean>;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
  onDeleteWithUndo?: (entry: HistoryEntry) => void;
  postProcessActions: PostProcessAction[];
  onActionApplied: () => Promise<void>;
  onStartCheckout: () => Promise<string | null>;
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  onToggleSaved,
  onCopyText,
  getAudioUrl,
  deleteAudio,
  onDeleteWithUndo,
  postProcessActions,
  onActionApplied,
  onStartCheckout,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [processingActionKey, setProcessingActionKey] = useState<number | null>(
    null,
  );
  const [clearingPostProcess, setClearingPostProcess] = useState(false);
  const [showAllActions, setShowAllActions] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // ── Inline edit state ────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState(entry.transcription_text);
  const [savingEdit, setSavingEdit] = useState(false);
  const [correctionSuggestions, setCorrectionSuggestions] = useState<
    CorrectionSuggestion[]
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleStartEdit = () => {
    setEditText(entry.transcription_text);
    setCorrectionSuggestions([]);
    setEditMode(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setCorrectionSuggestions([]);
  };

  const handleSaveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === entry.transcription_text) {
      setEditMode(false);
      return;
    }
    setSavingEdit(true);
    try {
      await invoke("update_history_entry_text", {
        id: entry.id,
        newText: trimmed,
      });

      // Analyse what changed and show suggestions
      const suggestions = await invoke<CorrectionSuggestion[]>(
        "analyze_correction",
        {
          original: entry.transcription_text,
          corrected: trimmed,
        },
      );
      const actionable = suggestions.filter((s) => !s.already_in_dict);
      if (actionable.length > 0) {
        setCorrectionSuggestions(actionable);
      }
      setEditMode(false);
    } catch (e) {
      console.error("Failed to save edit:", e);
      toast.error(
        t("settings.history.editSaveFailed", {
          defaultValue: "Impossible de sauvegarder la correction.",
        }),
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmSuggestion = async (s: CorrectionSuggestion) => {
    try {
      await invoke("record_correction", {
        from: s.from,
        to: s.to,
        addToDict: true,
      });
      setCorrectionSuggestions((prev) => prev.filter((x) => x.from !== s.from));
      toast.success(
        t("settings.history.correctionAdded", {
          defaultValue: '"{{from}}" → "{{to}}" ajouté au dictionnaire.',
          from: s.from,
          to: s.to,
        }),
      );
    } catch (e) {
      console.error("Failed to add dictionary entry:", e);
    }
  };

  const handleDismissSuggestion = async (s: CorrectionSuggestion) => {
    try {
      // Still record the correction count — may auto-add later
      await invoke("record_correction", {
        from: s.from,
        to: s.to,
        addToDict: false,
      });
    } catch {
      // Best-effort
    }
    setCorrectionSuggestions((prev) => prev.filter((x) => x.from !== s.from));
  };
  const models = useModelStore((s) => s.models);

  const downloadedModels = models.filter(
    (m) => m.id === "parakeet-tdt-0.6b-v3-multilingual" && m.is_downloaded,
  );
  const sortedPostProcessActions = [...postProcessActions].sort(
    (a, b) => a.key - b.key,
  );
  const visiblePostProcessActions = showAllActions
    ? sortedPostProcessActions
    : sortedPostProcessActions.slice(0, 4);
  const hiddenActionCount =
    sortedPostProcessActions.length - visiblePostProcessActions.length;

  const handleLoadAudio = useCallback(
    () => getAudioUrl(entry.file_name),
    [getAudioUrl, entry.file_name],
  );

  const handleCopyText = async () => {
    const copied = await onCopyText();
    if (!copied) {
      return;
    }
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleCopyExplicitText = async (
    text: string,
    successMessage: string,
  ) => {
    const copied = await copyToClipboardText(text);
    if (!copied) return;
    toast.success(successMessage);
  };

  const copyToClipboardText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("Failed to copy explicit history text:", error);
      toast.error(
        t("settings.history.copyFailed", {
          defaultValue: "Failed to copy transcription.",
        }),
      );
      return false;
    }
  };

  const showActionError = (error: string) => {
    const normalized = error.toLowerCase();
    if (error === "PREMIUM_REQUIRED" || normalized.includes("premium")) {
      toast.error(
        t("settings.history.actionNeedsPremium", {
          defaultValue:
            "Cette action nécessite Premium. Passez à Premium pour transformer l'historique.",
        }),
        {
          action: {
            label: t("basic.upgrade", { defaultValue: "Passer à Premium" }),
            onClick: () =>
              onStartCheckout().then(
                (url) => url && window.open(url, "_blank"),
              ),
          },
        },
      );
      return;
    }
    if (
      error === "NO_AI_MODEL_CONFIGURED" ||
      normalized.includes("no provider") ||
      normalized.includes("no model") ||
      normalized.includes("api")
    ) {
      toast.error(
        t("settings.history.actionNeedsModel", {
          defaultValue:
            "Configurez un modèle IA dans Modèles > Post-traitement pour utiliser cette action.",
        }),
      );
      return;
    }
    if (error === "ACTION_NOT_FOUND") {
      toast.error(
        t("settings.history.actionNotFound", {
          defaultValue:
            "Cette action n'existe plus. Vérifiez vos actions dans Post-traitement.",
        }),
      );
      return;
    }
    if (error === "EMPTY_HISTORY_ENTRY") {
      toast.error(
        t("settings.history.emptyActionSource", {
          defaultValue: "Cette entrée d'historique est vide.",
        }),
      );
      return;
    }
    toast.error(error);
  };

  const handleDeleteEntry = async () => {
    if (onDeleteWithUndo) {
      onDeleteWithUndo(entry);
      return;
    }
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
    }
  };

  const handleReprocess = async (modelId: string) => {
    setShowModelPicker(false);
    setReprocessing(true);
    try {
      await commands.reprocessHistoryEntry(entry.id, modelId);
    } catch (error) {
      console.error("Failed to reprocess entry:", error);
    } finally {
      setReprocessing(false);
    }
  };

  const handleApplyAction = async (action: PostProcessAction) => {
    if (processingActionKey !== null) return;
    setProcessingActionKey(action.key);
    try {
      const result = await commands.applyHistoryPostProcessAction(
        entry.id,
        action.key,
      );
      if (result.status !== "ok") {
        showActionError(result.error);
        return;
      }
      toast.success(
        t("settings.history.actionApplied", {
          defaultValue: "Action appliquée.",
        }),
      );
      await onActionApplied();
    } catch (error) {
      console.error("Failed to apply history action:", error);
      toast.error(
        t("settings.history.actionFailed", {
          defaultValue: "Impossible d'appliquer l'action.",
        }),
      );
    } finally {
      setProcessingActionKey(null);
    }
  };

  const handleClearPostProcess = async () => {
    if (clearingPostProcess) return;
    setClearingPostProcess(true);
    try {
      const result = await commands.clearHistoryPostProcessAction(entry.id);
      if (result.status !== "ok") {
        showActionError(result.error);
        return;
      }
      toast.success(
        t("settings.history.originalRestored", {
          defaultValue: "Original restauré.",
        }),
      );
      await onActionApplied();
    } catch (error) {
      console.error("Failed to clear history post-processing:", error);
      toast.error(
        t("settings.history.restoreOriginalFailed", {
          defaultValue: "Impossible de restaurer l'original.",
        }),
      );
    } finally {
      setClearingPostProcess(false);
    }
  };

  useEffect(() => {
    if (!showModelPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModelPicker]);

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  return (
    <div
      className="voca-surface"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "24px",
      }}
    >
      <div className="flex justify-between items-center">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <p className="text-[11.5px] text-white/32">{formattedDate}</p>
          {entry.model_name && (
            <span
              style={{ padding: "2px 8px" }}
              className="rounded-md bg-logo-primary/8 text-[10px] font-medium text-logo-primary/70"
            >
              {entry.model_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleStartEdit}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-white/8 bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/70"
            title={t("settings.history.editTranscription", {
              defaultValue: "Modifier la transcription",
            })}
          >
            <Pencil width={14} height={14} />
          </button>
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() =>
                !reprocessing && setShowModelPicker(!showModelPicker)
              }
              disabled={reprocessing}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/8 bg-white/[0.04] text-white/40 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                reprocessing
                  ? t("settings.history.reprocessing")
                  : t("settings.history.reprocess")
              }
            >
              {reprocessing ? (
                <Loader2 width={16} height={16} className="animate-spin" />
              ) : (
                <RefreshCw width={16} height={16} />
              )}
            </button>
            {showModelPicker && downloadedModels.length > 0 && (
              <div
                style={{ padding: "4px 0" }}
                className="absolute right-0 top-full mt-1 z-50 bg-background border border-mid-gray/20 rounded-lg shadow-lg min-w-[200px]"
              >
                <p
                  style={{ padding: "4px 12px" }}
                  className="text-xs text-text/50 font-medium"
                >
                  {t("settings.history.selectModel")}
                </p>
                {downloadedModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => handleReprocess(model.id)}
                    style={{ padding: "10px 16px" }}
                    className="w-full text-left text-sm hover:bg-mid-gray/10 transition-colors cursor-pointer"
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleCopyText}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-white/8 bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/70"
            title={t("settings.history.copyToClipboard")}
          >
            {showCopied ? (
              <Check width={16} height={16} />
            ) : (
              <Copy width={16} height={16} />
            )}
          </button>
          <button
            onClick={onToggleSaved}
            className={`flex h-7 w-7 items-center justify-center rounded-[6px] border border-white/8 bg-white/[0.04] transition-colors cursor-pointer ${
              entry.saved
                ? "text-logo-primary hover:text-logo-primary/80"
                : "text-white/40 hover:bg-white/[0.08] hover:text-white/70"
            }`}
            title={
              entry.saved
                ? t("settings.history.unsave")
                : t("settings.history.save")
            }
          >
            <Star
              width={16}
              height={16}
              fill={entry.saved ? "currentColor" : "none"}
            />
          </button>
          <button
            onClick={handleDeleteEntry}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-white/8 bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.08] hover:text-red-300"
            title={t("settings.history.delete")}
          >
            <Trash2 width={16} height={16} />
          </button>
        </div>
      </div>
      {entry.post_processed_text ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingBottom: 8,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span className="text-xs font-medium text-white/40">
                {t("settings.history.postProcessed")}
              </span>
              {entry.post_process_action_key != null && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-logo-primary/10 text-logo-primary font-medium">
                  {t("settings.history.action", {
                    key: entry.post_process_action_key,
                  })}
                </span>
              )}
              <Button
                type="button"
                onClick={() => void handleClearPostProcess()}
                disabled={clearingPostProcess}
                variant="secondary"
                size="sm"
              >
                {clearingPostProcess ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  t("settings.history.restoreOriginal", {
                    defaultValue: "Original",
                  })
                )}
              </Button>
            </div>
            <p className="text-[13.5px] italic text-white/82 select-text cursor-text">
              {entry.post_processed_text}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() =>
                  void handleCopyExplicitText(
                    entry.post_processed_text ?? "",
                    t("settings.history.copiedAiResult", {
                      defaultValue: "Résultat IA copié.",
                    }),
                  )
                }
                variant="primary-soft"
                size="sm"
              >
                {t("settings.history.copyAiResult", {
                  defaultValue: "Copier résultat IA",
                })}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void handleCopyExplicitText(
                    entry.transcription_text,
                    t("settings.history.copiedOriginal", {
                      defaultValue: "Original copié.",
                    }),
                  )
                }
                variant="secondary"
                size="sm"
              >
                {t("settings.history.copyOriginal", {
                  defaultValue: "Copier original",
                })}
              </Button>
            </div>
          </div>
          <div>
            <span className="mb-0.5 block text-xs font-medium text-white/40">
              {t("settings.history.originalTranscript")}
            </span>
            <ConfidenceText
              text={entry.transcription_text}
              confidencePayload={entry.confidence_payload}
              className="text-[13px] italic text-white/48 select-text cursor-text"
            />
          </div>
        </div>
      ) : editMode ? (
        <div className="flex flex-col gap-2 pb-2">
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-[10px] border border-logo-primary/30 bg-white/[0.06] px-3 py-2 text-[13.5px] italic text-white/82 outline-none focus:border-logo-primary/50"
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancelEdit();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                void handleSaveEdit();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={savingEdit}
              className="inline-flex items-center gap-1.5 rounded-md bg-logo-primary/20 px-3 py-1.5 text-[12px] font-medium text-logo-primary transition-colors hover:bg-logo-primary/30 disabled:opacity-50"
            >
              {savingEdit ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              {t("settings.history.saveEdit", { defaultValue: "Sauvegarder" })}
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] text-white/40 transition-colors hover:text-white/60"
            >
              <X size={12} />
              {t("settings.history.cancelEdit", { defaultValue: "Annuler" })}
            </button>
            <span className="ml-auto text-[10.5px] text-white/25">
              {t("settings.history.editHint", {
                defaultValue: "Ctrl+Entrée pour sauvegarder",
              })}
            </span>
          </div>
        </div>
      ) : (
        <>
          <ConfidenceText
            text={entry.transcription_text}
            confidencePayload={entry.confidence_payload}
            className="pb-2 text-[13.5px] italic text-white/82 select-text cursor-text"
          />
          <CorrectionBanner
            suggestions={correctionSuggestions}
            onConfirm={(s) => void handleConfirmSuggestion(s)}
            onDismiss={(s) => void handleDismissSuggestion(s)}
          />
        </>
      )}
      {postProcessActions.length > 0 && (
        <div
          className="mt-3 rounded-[10px] border border-border bg-surface-elevated"
          style={{ padding: "20px 24px" }}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="h-[3px] w-12 rounded-full bg-logo-primary" />
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-white/30">
              <Sparkles size={11} aria-hidden="true" />
              {t("settings.history.aiActions", {
                defaultValue: "Actions IA",
              })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {visiblePostProcessActions.map((action) => (
              <Button
                key={action.key}
                type="button"
                onClick={() => void handleApplyAction(action)}
                disabled={processingActionKey !== null}
                variant="secondary"
                size="sm"
                title={action.name}
                className="max-w-[190px]"
              >
                {processingActionKey === action.key ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <span className="font-mono text-[10.5px] text-white/34">
                    {action.key}
                  </span>
                )}
                <span className="truncate">{action.name}</span>
              </Button>
            ))}
            {hiddenActionCount > 0 && (
              <Button
                type="button"
                onClick={() => setShowAllActions(true)}
                variant="secondary"
                size="sm"
              >
                +{hiddenActionCount}
              </Button>
            )}
            {showAllActions && sortedPostProcessActions.length > 4 && (
              <Button
                type="button"
                onClick={() => setShowAllActions(false)}
                variant="ghost"
                size="sm"
              >
                {t("settings.history.showLessActions", {
                  defaultValue: "Moins",
                })}
              </Button>
            )}
          </div>
        </div>
      )}
      <AudioPlayer
        onLoadRequest={handleLoadAudio}
        className="w-full max-w-[320px]"
      />
    </div>
  );
};

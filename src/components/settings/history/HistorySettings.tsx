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
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { commands, type HistoryEntry } from "@/bindings";
import { formatDateTime } from "@/utils/dateFormat";
import { useOsType } from "@/hooks/useOsType";
import { useModelStore } from "@/stores/modelStore";
import { ConfidenceText } from "./ConfidenceText";
import { usePlan } from "@/lib/subscription/context";

const PAGE_SIZE = 30;

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="text-[12px] text-white/30 transition-colors hover:text-white/55"
    title={label}
  >
    {label}
  </button>
);

// ── Export button ─────────────────────────────────────────────────────────────

const ExportHistoryButton: React.FC = () => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      const filePath = await save({
        defaultPath: `vocaltype-history-${new Date().toISOString().slice(0, 10)}.txt`,
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
    <button
      type="button"
      onClick={handleExport}
      disabled={exporting}
      className="flex items-center gap-1.5 rounded-md border border-logo-primary/30 bg-logo-primary/5 px-2.5 py-1 text-[12px] text-logo-primary/80 transition-colors hover:bg-logo-primary/10 hover:text-logo-primary disabled:opacity-40"
      title={t("settings.history.exportMyData", {
        defaultValue: "Export my data",
      })}
    >
      {exporting ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Download size={11} />
      )}
      {t("settings.history.exportMyData", { defaultValue: "Export my data" })}
    </button>
  );
};

// ── Clear all history button ───────────────────────────────────────────────────

const ClearAllHistoryButton: React.FC<{ onCleared: () => void }> = ({
  onCleared,
}) => {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    const confirmed = window.confirm(
      t("settings.history.clearAllConfirm", {
        defaultValue:
          "Are you sure? This will permanently delete all recordings and transcriptions.",
      }),
    );
    if (!confirmed) return;

    setClearing(true);
    try {
      await invoke("clear_all_history");
      toast.success(
        t("settings.history.clearAllSuccess", {
          defaultValue: "All history cleared.",
        }),
      );
      onCleared();
    } catch (e) {
      console.error(e);
      toast.error(
        t("settings.history.clearAllError", {
          defaultValue: "Failed to clear history.",
        }),
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClear}
      disabled={clearing}
      className="flex items-center gap-1 text-[12px] text-red-400/60 transition-colors hover:text-red-400 disabled:opacity-40"
      title={t("settings.history.clearAll", {
        defaultValue: "Clear all history",
      })}
    >
      {clearing ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Eraser size={11} />
      )}
      {t("settings.history.clearAll", { defaultValue: "Clear all history" })}
    </button>
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
    <button
      type="button"
      onClick={handleTranscribeFile}
      disabled={transcribing}
      className="flex items-center gap-1 text-[12px] text-white/30 transition-colors hover:text-white/55 disabled:opacity-40"
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
    </button>
  );
};

const BASIC_HISTORY_LIMIT = 5;

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const { isBasicTier, onStartCheckout } = usePlan();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

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
      <div className="w-full space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
                {t("settings.history.title")}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <TranscribeFileButton />
              <ExportHistoryButton />
              <OpenRecordingsButton
                onClick={openRecordingsFolder}
                label={t("settings.history.openFolder")}
              />
            </div>
          </div>
          <div className="overflow-visible">
            <div className="px-4 py-3 text-center text-text/60">
              {t("settings.history.loading")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (historyEntries.length === 0) {
    return (
      <div className="w-full space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
                {t("settings.history.title")}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <TranscribeFileButton />
              <OpenRecordingsButton
                onClick={openRecordingsFolder}
                label={t("settings.history.openFolder")}
              />
            </div>
          </div>
          <div className="overflow-visible">
            <div className="px-4 py-3 text-center text-text/60">
              {t("settings.history.empty")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
              {t("settings.history.title")}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <TranscribeFileButton />
            <ExportHistoryButton />
            <ClearAllHistoryButton onCleared={loadHistoryEntries} />
            <OpenRecordingsButton
              onClick={openRecordingsFolder}
              label={t("settings.history.openFolder")}
            />
          </div>
        </div>
        <div className="overflow-visible">
          {isBasicTier && historyEntries.length > BASIC_HISTORY_LIMIT && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12px]">
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
                className="ml-3 shrink-0 rounded bg-amber-500/20 px-2.5 py-1 text-amber-300 transition-colors hover:bg-amber-500/30"
              >
                {t("basic.upgrade", { defaultValue: "Passer à Premium" })}
              </button>
            </div>
          )}
          <div className="divide-y divide-white/8">
            {(isBasicTier
              ? historyEntries.slice(0, BASIC_HISTORY_LIMIT)
              : historyEntries
            ).map((entry) => (
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
              />
            ))}
          </div>
          {hasMore && (
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
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  onToggleSaved,
  onCopyText,
  getAudioUrl,
  deleteAudio,
  onDeleteWithUndo,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const models = useModelStore((s) => s.models);

  const downloadedModels = models.filter((m) => m.is_downloaded);

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
    <div className="flex flex-col gap-3 py-[14px]">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <p className="text-[11.5px] text-white/32">{formattedDate}</p>
          {entry.model_name && (
            <span className="rounded-md bg-logo-primary/8 px-2 py-0.5 text-[10px] font-medium text-logo-primary/70">
              {entry.model_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
              <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-mid-gray/20 rounded-lg shadow-lg py-1 min-w-[200px]">
                <p className="px-3 py-1 text-xs text-text/50 font-medium">
                  {t("settings.history.selectModel")}
                </p>
                {downloadedModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => handleReprocess(model.id)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-mid-gray/10 transition-colors cursor-pointer"
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
        <div className="space-y-2 pb-2">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
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
            </div>
            <p className="text-[13.5px] italic text-white/82 select-text cursor-text">
              {entry.post_processed_text}
            </p>
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
      ) : (
        <ConfidenceText
          text={entry.transcription_text}
          confidencePayload={entry.confidence_payload}
          className="pb-2 text-[13.5px] italic text-white/82 select-text cursor-text"
        />
      )}
      <AudioPlayer
        onLoadRequest={handleLoadAudio}
        className="w-full max-w-[320px]"
      />
    </div>
  );
};

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AudioPlayer } from "../../ui/AudioPlayer";
import {
  Check,
  Loader2,
  Download,
  FileAudio,
  Eraser,
  Sparkles,
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
import { useOsType } from "@/hooks/useOsType";
import { ConfidenceText } from "./ConfidenceText";
import { usePlan } from "@/lib/subscription/context";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { Button } from "../../ui/Button";
import { useSettings } from "@/hooks/useSettings";

const PAGE_SIZE = 30;
const BASIC_HISTORY_LIMIT = 5;

// ── Design tokens ──────────────────────────────────────────────────────────────
const T = {
  gold: "#c9a84c",
  goldSoft: "rgba(201,168,76,0.12)",
  goldLine: "rgba(201,168,76,0.32)",
  line: "rgba(255,255,255,0.06)",
  line2: "rgba(255,255,255,0.10)",
  txt1: "rgba(255,255,255,0.94)",
  txt2: "rgba(255,255,255,0.64)",
  txt3: "rgba(255,255,255,0.38)",
  txt4: "rgba(255,255,255,0.22)",
};

// ── Shared style atoms ─────────────────────────────────────────────────────────
const menuItemStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 14px",
  textAlign: "left",
  fontSize: 13,
  color: T.txt1,
  background: "none",
  border: "none",
  borderRadius: 7,
  fontFamily: "inherit",
  cursor: "pointer",
  display: "block",
};

const textActionBase: React.CSSProperties = {
  fontSize: 12,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  cursor: "pointer",
  padding: "4px 8px",
  borderRadius: 6,
  background: "none",
  border: "none",
  fontFamily: "inherit",
};

// ── Correction types ──────────────────────────────────────────────────────────
interface CorrectionSuggestion {
  from: string;
  to: string;
  count: number;
  already_in_dict: boolean;
  auto_add: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function toMs(ts: number): number {
  return ts * 1000;
}

function fmtTime(ts: number, locale?: string): string {
  return new Date(toMs(ts)).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDetailDate(ts: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(toMs(ts)));
}

function getGroupKey(ts: number): "today" | "yesterday" | "week" | "older" {
  const d = new Date(toMs(ts));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 6 * 86400000);
  const entryDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (entryDay >= today) return "today";
  if (entryDay >= yesterday) return "yesterday";
  if (entryDay >= weekAgo) return "week";
  return "older";
}

function groupEntries(
  entries: HistoryEntry[],
  labels: Record<"today" | "yesterday" | "week" | "older", string>,
): { key: string; label: string; entries: HistoryEntry[] }[] {
  const map: Record<string, HistoryEntry[]> = {};
  for (const e of entries) {
    const k = getGroupKey(e.timestamp);
    if (!map[k]) map[k] = [];
    map[k].push(e);
  }
  return (["today", "yesterday", "week", "older"] as const)
    .filter((k) => map[k]?.length)
    .map((k) => ({ key: k, label: labels[k], entries: map[k] }));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Correction suggestion banner ───────────────────────────────────────────────
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

// ── Utility export components ──────────────────────────────────────────────────

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

export const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
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

export const ExportHistoryButton: React.FC = () => {
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
        toast.error(getUserFacingErrorMessage(result.error, { t }));
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

export const ClearAllHistoryButton: React.FC<{ onCleared: () => void }> = ({
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
          defaultValue: "Échec de la suppression.",
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
          className="inline-flex h-9 items-center justify-center rounded-lg bg-red-500/14 px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 disabled:opacity-40"
        >
          {clearing ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            t("settings.history.confirmYes")
          )}
        </button>
        <button
          onClick={() => setConfirmDeleteAll(false)}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-text/70 transition-colors hover:bg-white/[0.07] hover:text-text/90"
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

export const TranscribeFileButton: React.FC = () => {
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
            defaultValue: "Transcription copiée.",
          }),
        );
      } else {
        toast.error(getUserFacingErrorMessage(result.error, { t }));
      }
    } catch (e) {
      console.error(e);
      toast.error(
        t("settings.history.transcribeFileError", {
          defaultValue: "Échec de la transcription.",
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

// ── Main component ─────────────────────────────────────────────────────────────

export const HistorySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const osType = useOsType();
  const { isBasicTier, onStartCheckout, openUpgradePlans } = usePlan();
  const { getSetting } = useSettings();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "favoris">("all");
  const [showCopied, setShowCopied] = useState(false);
  const [showTransform, setShowTransform] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [processingActionKey, setProcessingActionKey] = useState<number | null>(
    null,
  );
  const [clearingPostProcess, setClearingPostProcess] = useState(false);
  const [correctionSuggestions, setCorrectionSuggestions] = useState<
    CorrectionSuggestion[]
  >([]);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const pendingDeletesRef = useRef<
    Map<
      number,
      { entry: HistoryEntry; timeoutId: ReturnType<typeof setTimeout> }
    >
  >(new Map());

  const postProcessActions: PostProcessAction[] =
    getSetting("post_process_actions") || [];
  const sortedActions = [...postProcessActions].sort((a, b) => a.key - b.key);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    let list = isBasicTier ? entries.slice(0, BASIC_HISTORY_LIMIT) : entries;
    if (filter === "favoris") list = list.filter((e) => e.saved);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.transcription_text.toLowerCase().includes(q) ||
          (e.post_processed_text ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [entries, isBasicTier, filter, searchQuery]);

  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const groupLabels = useMemo(
    () => ({
      today: t("settings.history.groupToday", { defaultValue: "Today" }),
      yesterday: t("settings.history.groupYesterday", {
        defaultValue: "Yesterday",
      }),
      week: t("settings.history.groupWeek", { defaultValue: "This week" }),
      older: t("settings.history.groupOlder", { defaultValue: "Older" }),
    }),
    [t],
  );
  const grouped = useMemo(
    () => groupEntries(filteredEntries, groupLabels),
    [filteredEntries, groupLabels],
  );

  const selectedEntry = useMemo(
    () =>
      entries.find((e) => e.id === selectedId) ?? filteredEntries[0] ?? null,
    [entries, selectedId, filteredEntries],
  );

  const currentEntryId = selectedId ?? filteredEntries[0]?.id ?? null;

  // Reset detail state when selection changes
  useEffect(() => {
    setEditMode(false);
    setShowTransform(false);
    setShowCopied(false);
    setCorrectionSuggestions([]);
  }, [currentEntryId]);

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadEntries = useCallback(async () => {
    try {
      const [list, more] = await invoke<[HistoryEntry[], boolean]>(
        "get_history_entries_paginated",
        { limit: PAGE_SIZE, offset: 0 },
      );
      setEntries(list);
      setHasMore(more);
      setOffset(PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const [list, more] = await invoke<[HistoryEntry[], boolean]>(
        "get_history_entries_paginated",
        { limit: PAGE_SIZE, offset },
      );
      setEntries((prev) => [...prev, ...list]);
      setHasMore(more);
      setOffset((prev) => prev + PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load more history entries:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, offset]);

  useEffect(() => {
    loadEntries();
    const setup = async () => {
      const unlisten = await listen("history-updated", () => loadEntries());
      return unlisten;
    };
    const promise = setup();
    return () => {
      promise.then((unlisten) => unlisten?.());
    };
  }, [loadEntries]);

  useEffect(() => {
    return () => {
      pendingDeletesRef.current.forEach(({ timeoutId, entry }) => {
        clearTimeout(timeoutId);
        invoke("delete_history_entry", { id: entry.id }).catch(console.error);
      });
    };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const toggleSaved = async (id: number) => {
    try {
      await commands.toggleHistoryEntrySaved(id);
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
    }
  };

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
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
      } catch {
        return null;
      }
    },
    [osType],
  );

  const handleDeleteWithUndo = useCallback(
    (entry: HistoryEntry) => {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (selectedId === entry.id) setSelectedId(null);

      const timeoutId = setTimeout(async () => {
        pendingDeletesRef.current.delete(entry.id);
        try {
          await invoke("delete_history_entry", { id: entry.id });
        } catch {
          setEntries((prev) =>
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
              setEntries((prev) =>
                [entry, ...prev].sort(
                  (a, b) => Number(b.timestamp) - Number(a.timestamp),
                ),
              );
            }
          },
        },
      });
    },
    [t, selectedId],
  );

  const handleCopy = async () => {
    if (!selectedEntry) return;
    const text =
      selectedEntry.post_processed_text ?? selectedEntry.transcription_text;
    const ok = await copyText(text);
    if (ok) {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    }
  };

  const handleCopyExplicit = async (text: string) => {
    const ok = await copyText(text);
    if (ok)
      toast.success(
        t("settings.history.copiedAiResult", { defaultValue: "Copié." }),
      );
  };

  const showActionError = (error: string) => {
    const normalized = error.toLowerCase();
    if (error === "PREMIUM_REQUIRED" || normalized.includes("premium")) {
      toast.error(
        t("settings.history.actionNeedsPremium", {
          defaultValue: "Cette action nécessite Premium.",
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
            "Configurez un modèle IA dans Modèles > Post-traitement.",
        }),
      );
      return;
    }
    toast.error(getUserFacingErrorMessage(error, { t }));
  };

  const handleApplyAction = async (action: PostProcessAction) => {
    if (!selectedEntry || processingActionKey !== null) return;
    setProcessingActionKey(action.key);
    try {
      const result = await commands.applyHistoryPostProcessAction(
        selectedEntry.id,
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
      await loadEntries();
    } catch {
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
    if (!selectedEntry || clearingPostProcess) return;
    setClearingPostProcess(true);
    try {
      const result = await commands.clearHistoryPostProcessAction(
        selectedEntry.id,
      );
      if (result.status !== "ok") {
        showActionError(result.error);
        return;
      }
      toast.success(
        t("settings.history.originalRestored", {
          defaultValue: "Original restauré.",
        }),
      );
      await loadEntries();
    } catch {
      toast.error(
        t("settings.history.restoreOriginalFailed", {
          defaultValue: "Impossible de restaurer l'original.",
        }),
      );
    } finally {
      setClearingPostProcess(false);
    }
  };

  const handleStartEdit = () => {
    if (!selectedEntry) return;
    setEditText(selectedEntry.transcription_text);
    setCorrectionSuggestions([]);
    setEditMode(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setCorrectionSuggestions([]);
  };

  const handleSaveEdit = async () => {
    if (!selectedEntry) return;
    const trimmed = editText.trim();
    if (!trimmed || trimmed === selectedEntry.transcription_text) {
      setEditMode(false);
      return;
    }
    setSavingEdit(true);
    try {
      await invoke("update_history_entry_text", {
        id: selectedEntry.id,
        newText: trimmed,
      });
      const suggestions = await invoke<CorrectionSuggestion[]>(
        "analyze_correction",
        {
          original: selectedEntry.transcription_text,
          corrected: trimmed,
        },
      );
      const actionable = suggestions.filter((s) => !s.already_in_dict);
      if (actionable.length > 0) setCorrectionSuggestions(actionable);
      setEditMode(false);
      await loadEntries();
    } catch {
      toast.error(
        t("settings.history.editSaveFailed", {
          defaultValue: "Impossible de sauvegarder.",
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
    } catch (e) {
      console.error(e);
    }
  };

  const handleDismissSuggestion = async (s: CorrectionSuggestion) => {
    try {
      await invoke("record_correction", {
        from: s.from,
        to: s.to,
        addToDict: false,
      });
    } catch {
      /* best-effort */
    }
    setCorrectionSuggestions((prev) => prev.filter((x) => x.from !== s.from));
  };

  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      )
        setShowMoreMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoreMenu]);

  // ── Helpers for entry cards ──────────────────────────────────────────────────
  const entryText = (e: HistoryEntry) =>
    e.post_processed_text || e.transcription_text || "";

  const entryAiBadge = (e: HistoryEntry): string | null => {
    if (!e.post_processed_text) return null;
    const action = postProcessActions.find(
      (a) => a.key === e.post_process_action_key,
    );
    return action?.name ?? "IA";
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <style>{`
        .hist-filter-chip:hover { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.18) !important; }
        .hist-filter-chip-active:hover { filter: brightness(1.1); }
        .hist-entry:hover { background: rgba(255,255,255,0.03) !important; }
        .hist-copy-btn:hover { filter: brightness(1.12); box-shadow: 0 4px 14px rgba(201,168,76,0.35) !important; }
        .hist-more-btn:hover { background: #24242c !important; border-color: rgba(255,255,255,0.15) !important; }
        .hist-menu-item:hover { background: #1c1c22 !important; color: #c9a84c !important; }
        .hist-text-action:hover { background: rgba(255,255,255,0.06) !important; }
        .hist-text-action-gold:hover { background: rgba(201,168,76,0.12) !important; }
        .hist-del-btn:hover { background: rgba(239,68,68,0.12) !important; color: #fca5a5 !important; }
        .hist-load-more:hover { color: rgba(255,255,255,0.55) !important; }
        .hist-tab:hover { color: rgba(255,255,255,0.72) !important; }
        button { transition: background .14s, filter .14s, border-color .14s, color .14s, box-shadow .14s; }
      `}</style>

      {/* ── Page head ── */}
      <div style={{ padding: "26px 32px 18px", flexShrink: 0 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: T.txt1,
          }}
        >
          {t("sidebar.history", { defaultValue: "Historique" })}
        </h1>
        <p style={{ fontSize: 13, color: T.txt3, marginTop: 4 }}>
          {t("settings.history.subtitle", {
            defaultValue: "Retrouve, copie et réutilise tes dernières dictées.",
          })}
        </p>
      </div>

      {/* ── Toolbar ── */}
      <div
        style={{
          padding: "0 32px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* Search */}
        <div
          style={{
            position: "relative",
            flex: 1,
            maxWidth: 380,
            height: 36,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${T.line2}`,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            padding: "0 12px 0 36px",
          }}
        >
          <svg
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: T.txt3,
            }}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("settings.history.search", {
              defaultValue: "Rechercher une transcription…",
            })}
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              fontFamily: "inherit",
              fontSize: 13,
              color: T.txt1,
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                color: T.txt3,
                cursor: "pointer",
                lineHeight: 1,
                background: "none",
                border: "none",
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            {
              key: "all" as const,
              label: t("settings.history.filterAll", { defaultValue: "All" }),
            },
            {
              key: "favoris" as const,
              label: t("settings.history.filterFavorites", {
                defaultValue: "Favorites",
              }),
            },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                filter === key ? "hist-filter-chip-active" : "hist-filter-chip"
              }
              style={{
                padding: "0 12px",
                height: 30,
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
                border: `1px solid ${filter === key ? T.goldLine : T.line2}`,
                background: filter === key ? T.goldSoft : "transparent",
                fontSize: 12,
                color: filter === key ? T.gold : T.txt2,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Split view ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          borderTop: `1px solid ${T.line}`,
        }}
      >
        {/* ── LIST ── */}
        <div
          style={{
            borderRight: `1px solid ${T.line}`,
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.012)",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "6px 12px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            {/* Basic tier banner */}
            {isBasicTier && entries.length > BASIC_HISTORY_LIMIT && (
              <div
                style={{
                  margin: "8px 2px 4px",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(245,158,11,0.3)",
                  background: "rgba(245,158,11,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span style={{ color: "rgba(252,211,77,0.8)" }}>
                  {t("basic.historyLimited", {
                    defaultValue: `Limité à ${BASIC_HISTORY_LIMIT} entrées`,
                    limit: BASIC_HISTORY_LIMIT,
                  })}
                </span>
                <button
                  type="button"
                  onClick={openUpgradePlans}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "rgba(245,158,11,0.2)",
                    color: "rgba(252,211,77,0.9)",
                    fontSize: 11,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    border: "none",
                  }}
                >
                  {t("basic.upgrade", { defaultValue: "Upgrade" })}
                </button>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div
                style={{
                  padding: "48px 16px",
                  textAlign: "center",
                  color: T.txt3,
                  fontSize: 13,
                }}
              >
                {t("settings.history.loading")}
              </div>
            )}

            {/* Empty */}
            {!loading && filteredEntries.length === 0 && (
              <div
                style={{
                  padding: "48px 16px",
                  textAlign: "center",
                  color: T.txt3,
                  fontSize: 13,
                }}
              >
                {searchQuery
                  ? t("settings.history.noResults", {
                      defaultValue:
                        "Aucun résultat pour « " + searchQuery + " »",
                    })
                  : t("settings.history.empty")}
              </div>
            )}

            {/* Grouped entries */}
            {grouped.map((group) => (
              <React.Fragment key={group.key}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: T.txt3,
                    padding: "18px 8px 8px",
                    letterSpacing: "0.01em",
                    flexShrink: 0,
                  }}
                >
                  {group.label}
                </div>
                {group.entries.map((entry) => {
                  const isSelected = entry.id === currentEntryId;
                  const badge = entryAiBadge(entry);
                  return (
                    <article
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      onMouseEnter={() => setHoveredId(entry.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{
                        position: "relative",
                        padding: "14px 14px",
                        borderRadius: 10,
                        border: `1px solid ${isSelected ? "rgba(201,168,76,0.22)" : "transparent"}`,
                        background: isSelected
                          ? "rgba(201,168,76,0.06)"
                          : hoveredId === entry.id
                            ? "rgba(255,255,255,0.025)"
                            : "transparent",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        cursor: "pointer",
                        overflow: "hidden",
                        flexShrink: 0,
                        transition: "background 0.12s",
                      }}
                    >
                      {isSelected && (
                        <span
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 16,
                            bottom: 16,
                            width: 2,
                            background: T.gold,
                            borderRadius: 2,
                          }}
                        />
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 11.5,
                          color: T.txt3,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        <span>{fmtTime(entry.timestamp, locale)}</span>
                        {badge && (
                          <span
                            style={{
                              marginLeft: "auto",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              color: T.gold,
                              fontWeight: 500,
                              fontSize: 11,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: T.gold,
                                flexShrink: 0,
                              }}
                            />
                            {badge}
                          </span>
                        )}
                      </div>
                      <div className="hist-entry-text">{entryText(entry)}</div>
                    </article>
                  );
                })}
              </React.Fragment>
            ))}

            {/* Load more */}
            {hasMore && !searchQuery && !loading && (
              <div style={{ paddingTop: 12, textAlign: "center" }}>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="hist-load-more"
                  style={{
                    fontSize: 12,
                    color: T.txt3,
                    fontFamily: "inherit",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {loadingMore
                    ? t("settings.history.loadingMore", {
                        defaultValue: "Chargement…",
                      })
                    : t("settings.history.loadMore", {
                        defaultValue: "Voir plus",
                      })}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── DETAIL ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {!selectedEntry ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.txt3,
                fontSize: 13,
              }}
            >
              {!loading &&
                t("settings.history.selectEntry", {
                  defaultValue: "Sélectionne une entrée pour voir le détail.",
                })}
            </div>
          ) : (
            <>
              {/* Detail head */}
              <div
                style={{
                  padding: "28px 36px 22px",
                  borderBottom: `1px solid ${T.line}`,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 18,
                  flexShrink: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: T.txt3,
                      marginBottom: 8,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtDetailDate(selectedEntry.timestamp, locale)}
                    {" · "}
                    {wordCount(
                      selectedEntry.post_processed_text ??
                        selectedEntry.transcription_text,
                    )}{" "}
                    {t("settings.history.wordsCount", {
                      defaultValue: "words",
                      count: wordCount(
                        selectedEntry.post_processed_text ??
                          selectedEntry.transcription_text,
                      ),
                    })}
                  </div>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: T.txt1,
                      lineHeight: 1.25,
                    }}
                  >
                    {(
                      selectedEntry.post_processed_text ??
                      selectedEntry.transcription_text
                    )
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 80)}
                  </h2>
                </div>

                {/* Actions */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  {/* ★ Favori */}
                  <button
                    type="button"
                    onClick={() => void toggleSaved(selectedEntry.id)}
                    className="hist-more-btn"
                    title={t(
                      selectedEntry.saved
                        ? "settings.history.unsave"
                        : "settings.history.save",
                    )}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      border: `1px solid ${selectedEntry.saved ? "rgba(201,168,76,0.35)" : T.line2}`,
                      background: selectedEntry.saved
                        ? "rgba(201,168,76,0.1)"
                        : "rgba(255,255,255,0.03)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: selectedEntry.saved ? T.gold : T.txt2,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition:
                        "background .14s, border-color .14s, color .14s",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill={selectedEntry.saved ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>

                  {/* ⋯ menu */}
                  <div ref={moreMenuRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setShowMoreMenu((v) => !v)}
                      className="hist-more-btn"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 9,
                        border: `1px solid ${T.line2}`,
                        background: "rgba(255,255,255,0.03)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: T.txt2,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <circle cx="5" cy="12" r="1.4" />
                        <circle cx="12" cy="12" r="1.4" />
                        <circle cx="19" cy="12" r="1.4" />
                      </svg>
                    </button>
                    {showMoreMenu && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 6px)",
                          right: 0,
                          minWidth: 150,
                          zIndex: 50,
                          borderRadius: 10,
                          border: `1px solid ${T.line2}`,
                          background: "linear-gradient(180deg,#1b1b1e,#131316)",
                          boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
                          padding: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            handleStartEdit();
                          }}
                          className="hist-menu-item"
                          style={menuItemStyle}
                        >
                          {t("settings.history.edit", {
                            defaultValue: "Modifier",
                          })}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            void toggleSaved(selectedEntry.id);
                          }}
                          className="hist-menu-item"
                          style={{
                            ...menuItemStyle,
                            color: selectedEntry.saved ? T.gold : T.txt2,
                          }}
                        >
                          {selectedEntry.saved
                            ? t("settings.history.sauvegarde", {
                                defaultValue: "★ Épinglé",
                              })
                            : t("settings.history.reutiliser", {
                                defaultValue: "Épingler",
                              })}
                        </button>
                        {sortedActions.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMoreMenu(false);
                              setShowTransform((v) => !v);
                            }}
                            className="hist-menu-item"
                            style={menuItemStyle}
                          >
                            {t("settings.history.transformer", {
                              defaultValue: "Transformer",
                            })}
                          </button>
                        )}
                        <div
                          style={{
                            height: 1,
                            background: T.line,
                            margin: "4px 0",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            handleDeleteWithUndo(selectedEntry);
                          }}
                          className="hist-del-btn"
                          style={{ ...menuItemStyle, color: "#f87171" }}
                        >
                          {t("settings.history.delete", {
                            defaultValue: "Supprimer",
                          })}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Copy primary */}
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="hist-copy-btn"
                    style={{
                      height: 36,
                      padding: "0 14px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 9,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      background: T.gold,
                      color: "#1a1407",
                      border: "none",
                      boxShadow:
                        "0 4px 14px rgba(201,168,76,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    {showCopied
                      ? t("settings.history.copied", {
                          defaultValue: "✓ Copié",
                        })
                      : t("settings.history.copy", { defaultValue: "Copier" })}
                  </button>
                </div>
              </div>

              {/* Detail body */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "22px 36px 28px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                }}
              >
                {/* No-AI-actions hint */}
                {postProcessActions.length === 0 && (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: `1px solid ${T.line}`,
                      background: "rgba(255,255,255,0.018)",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        border: `1px solid rgba(201,168,76,0.14)`,
                        background: "rgba(201,168,76,0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        color: T.gold,
                      }}
                    >
                      <Sparkles size={13} />
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12.5,
                        color: T.txt3,
                        lineHeight: 1.6,
                      }}
                    >
                      {t("settings.history.noAiActionsHint", {
                        defaultValue:
                          "Créez une action dans Post-traitement pour reformater vos dictées.",
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("vocalype:navigate-settings", {
                            detail: "postprocessing",
                          }),
                        )
                      }
                      style={{
                        flexShrink: 0,
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontFamily: "inherit",
                        background: "rgba(201,168,76,0.1)",
                        color: T.gold,
                        border: `1px solid rgba(201,168,76,0.2)`,
                        cursor: "pointer",
                      }}
                    >
                      {t("settings.history.configureActions", {
                        defaultValue: "Configurer",
                      })}
                    </button>
                  </div>
                )}

                {/* Audio player */}
                {selectedEntry.file_name && (
                  <AudioPlayer
                    key={selectedEntry.id}
                    onLoadRequest={() => getAudioUrl(selectedEntry.file_name)}
                    seed={selectedEntry.file_name}
                    className="w-full"
                  />
                )}

                {/* Transform panel */}
                {showTransform && sortedActions.length > 0 && (
                  <div
                    style={{
                      padding: "14px 18px",
                      borderRadius: 12,
                      border: `1px solid ${T.line}`,
                      background: "rgba(255,255,255,0.018)",
                    }}
                  >
                    <p
                      style={{
                        marginBottom: 10,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: T.txt4,
                      }}
                    >
                      {t("settings.history.transformerEn", {
                        defaultValue: "Transformer en",
                      })}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {sortedActions.map((action) => (
                        <Button
                          key={action.key}
                          type="button"
                          onClick={() => void handleApplyAction(action)}
                          disabled={processingActionKey !== null}
                          variant="secondary"
                          size="sm"
                        >
                          {processingActionKey === action.key ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : null}
                          <span className="truncate">{action.name}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Post-processed text block */}
                {selectedEntry.post_processed_text && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: T.txt3,
                          letterSpacing: "0.02em",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: T.gold,
                          }}
                        />
                        {postProcessActions.find(
                          (a) =>
                            a.key === selectedEntry.post_process_action_key,
                        )?.name ??
                          t("settings.history.postProcessed", {
                            defaultValue: "Processed",
                          })}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyExplicit(
                            selectedEntry.post_processed_text ?? "",
                          )
                        }
                        className="hist-text-action-gold"
                        style={{
                          ...textActionBase,
                          color: T.gold,
                          marginLeft: "auto",
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        {t("settings.history.copyAiResult", {
                          defaultValue: "Copy result",
                        })}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleClearPostProcess()}
                        disabled={clearingPostProcess}
                        style={{ ...textActionBase, color: T.txt3 }}
                      >
                        {clearingPostProcess ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : null}
                        {t("settings.history.restoreOriginal", {
                          defaultValue: "Restaurer original",
                        })}
                      </button>
                    </div>
                    <div
                      style={{
                        border: `1px solid rgba(201,168,76,0.22)`,
                        borderRadius: 12,
                        background:
                          "linear-gradient(180deg, rgba(201,168,76,0.04), rgba(201,168,76,0.012))",
                        padding: "18px 22px",
                        fontSize: 14.5,
                        lineHeight: 1.7,
                        color: T.txt1,
                        letterSpacing: "-0.005em",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        userSelect: "text",
                        cursor: "text",
                      }}
                    >
                      {selectedEntry.post_processed_text}
                    </div>
                  </div>
                )}

                {/* Original text block */}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: T.txt3,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {t("settings.history.original", {
                        defaultValue: "Original",
                      })}
                    </span>
                    {!editMode && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyExplicit(
                              selectedEntry.transcription_text,
                            )
                          }
                          className="hist-text-action"
                          style={{
                            ...textActionBase,
                            color: T.txt3,
                            marginLeft: "auto",
                          }}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          {t("settings.history.copyOriginal", {
                            defaultValue: "Copy original",
                          })}
                        </button>
                        <button
                          type="button"
                          onClick={handleStartEdit}
                          className="hist-text-action"
                          style={{ ...textActionBase, color: T.txt3 }}
                        >
                          {t("settings.history.edit", {
                            defaultValue: "Modifier",
                          })}
                        </button>
                      </>
                    )}
                  </div>

                  {editMode ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <textarea
                        ref={textareaRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={5}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          borderRadius: 12,
                          border: `1px solid rgba(201,168,76,0.3)`,
                          background: "rgba(255,255,255,0.04)",
                          padding: "14px 18px",
                          fontSize: 14,
                          lineHeight: 1.65,
                          color: T.txt1,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") handleCancelEdit();
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                            void handleSaveEdit();
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit()}
                          disabled={savingEdit}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 14px",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 500,
                            fontFamily: "inherit",
                            background: "rgba(201,168,76,0.2)",
                            color: T.gold,
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          {savingEdit ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          {t("settings.history.saveEdit", {
                            defaultValue: "Sauvegarder",
                          })}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 10px",
                            borderRadius: 8,
                            fontSize: 12,
                            fontFamily: "inherit",
                            background: "none",
                            border: "none",
                            color: T.txt3,
                            cursor: "pointer",
                          }}
                        >
                          <X size={12} />
                          {t("settings.history.cancelEdit", {
                            defaultValue: "Annuler",
                          })}
                        </button>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10.5,
                            color: T.txt4,
                          }}
                        >
                          {t("settings.history.editHint", {
                            defaultValue: "Ctrl+Entrée pour sauvegarder",
                          })}
                        </span>
                      </div>
                      <CorrectionBanner
                        suggestions={correctionSuggestions}
                        onConfirm={(s) => void handleConfirmSuggestion(s)}
                        onDismiss={(s) => void handleDismissSuggestion(s)}
                      />
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          border: `1px solid ${T.line}`,
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.018)",
                          padding: "18px 22px",
                          fontSize: 14.5,
                          lineHeight: 1.7,
                          color: T.txt2,
                          letterSpacing: "-0.005em",
                          fontStyle: selectedEntry.post_processed_text
                            ? "italic"
                            : "normal",
                          opacity: selectedEntry.post_processed_text ? 0.85 : 1,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          cursor: "text",
                          userSelect: "text",
                        }}
                      >
                        <ConfidenceText
                          text={selectedEntry.transcription_text}
                          confidencePayload={selectedEntry.confidence_payload}
                          className=""
                        />
                      </div>
                      <CorrectionBanner
                        suggestions={correctionSuggestions}
                        onConfirm={(s) => void handleConfirmSuggestion(s)}
                        onDismiss={(s) => void handleDismissSuggestion(s)}
                      />
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

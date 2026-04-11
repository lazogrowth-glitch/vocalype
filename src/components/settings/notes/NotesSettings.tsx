/* eslint-disable i18next/no-literal-string */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Archive,
  CheckSquare,
  Copy,
  Download,
  FileAudio,
  FileText,
  Mic,
  Pin,
  Plus,
  Search,
  Sparkles,
  Square,
  Tag,
  Trash2,
} from "lucide-react";
import { commands, type NoteEntry } from "@/bindings";
import { Button } from "../../ui/Button";

function formatNoteDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

const UNTITLED = "Sans titre";

function noteTitle(note: NoteEntry): string {
  if (note.title && note.title.trim()) return note.title;
  const firstLine = note.content.split("\n")[0]?.trim();
  return firstLine || UNTITLED;
}

function notePreview(note: NoteEntry): string {
  const body = note.content.replace(/\s+/g, " ").trim();
  if (!body) {
    return "Aucun contenu";
  }
  return body;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function formatImportTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function InfoPanel({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const { t } = useTranslation();
  if (!value.trim()) {
    return null;
  }

  return (
    <div className="rounded-[16px] border border-white/8 bg-white/[0.03]">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-logo-primary/18 bg-logo-primary/[0.08] text-logo-primary/82">
          {icon}
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-white/64 uppercase">
            {label}
          </p>
          <p className="text-[10.5px] text-white/24">
            {t("common.words", { count: countWords(value) })}
          </p>
        </div>
      </div>
      <div className="px-4 py-4 text-[12.5px] leading-7 whitespace-pre-wrap text-white/72">
        {value}
      </div>
    </div>
  );
}

export const NotesSettings: React.FC = () => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [listFilter, setListFilter] = useState<
    "all" | "pinned" | "recent" | "archived"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteCaptureActive, setNoteCaptureActive] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const contentWasFocusedRef = useRef(false);
  const latestBindingIdRef = useRef<string | null>(null);
  const latestLifecycleStateRef = useRef<string | null>(null);
  const handledPreviewOpRef = useRef<number | null>(null);
  const pendingFallbackTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const selectedNoteRef = useRef<NoteEntry | null>(null);
  const editTitleRef = useRef("");
  const editContentRef = useRef("");

  const loadNotes = useCallback(async () => {
    const res = await commands.getNotes();
    if (res.status === "ok") setNotes(res.data);
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const unlisten: Array<() => void> = [];

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<NoteEntry>("note-created", (event) => {
        const note = event.payload;
        setNotes((prev) => [
          note,
          ...prev.filter((entry) => entry.id !== note.id),
        ]);
        setSelectedId(note.id);
        setEditTitle(note.title);
        setEditContent(note.content);
      }).then((dispose) => unlisten.push(dispose));

      listen<{ id: number; text: string }>("note-segment-added", (event) => {
        const { id, text } = event.payload;
        setNotes((prev) =>
          prev.map((note) =>
            note.id === id
              ? {
                  ...note,
                  content: note.content + text,
                  updated_at: Date.now(),
                }
              : note,
          ),
        );

        if (selectedId === id) {
          setEditContent((prev) => prev + text);
        }
      }).then((dispose) => unlisten.push(dispose));
    });

    return () => {
      unlisten.forEach((dispose) => dispose());
    };
  }, [selectedId]);

  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;
  const noteCategories = Array.from(
    new Set(notes.map((note) => note.category.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  const recentThreshold = Date.now() - 1000 * 60 * 60 * 24 * 7;
  const visibleNotes = notes.filter((note) => {
    if (listFilter === "pinned") {
      return note.is_pinned;
    }
    if (listFilter === "recent") {
      return note.updated_at >= recentThreshold;
    }
    if (listFilter === "archived") {
      return note.is_archived;
    }
    if (note.is_archived) {
      return false;
    }
    if (categoryFilter !== "all" && note.category.trim() !== categoryFilter) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (selectedNote) {
      setEditTitle(selectedNote.title);
      setEditCategory(selectedNote.category);
      setEditContent(selectedNote.content);
    }
  }, [selectedId, selectedNote]);

  useEffect(() => {
    selectedNoteRef.current = selectedNote;
  }, [selectedNote]);

  useEffect(() => {
    void invoke("set_active_note", { id: selectedId }).catch(() => undefined);
  }, [selectedId]);

  useEffect(() => {
    editTitleRef.current = editTitle;
  }, [editTitle]);

  useEffect(() => {
    editContentRef.current = editContent;
  }, [editContent]);

  const handleCreate = async () => {
    const res = await commands.createNote("", "");
    if (res.status === "ok") {
      setNotes((prev) => [res.data, ...prev]);
      setSelectedId(res.data.id);
      setEditTitle("");
      setEditCategory("");
      setEditContent("");
    }
  };

  const handleCategoryChange = async (value: string) => {
    setEditCategory(value);
    if (selectedId === null) {
      return;
    }

    const normalized = value.trim();
    const res = await commands.setNoteCategory(selectedId, normalized);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setNotes((prev) =>
      prev.map((note) =>
        note.id === selectedId
          ? { ...note, category: normalized, updated_at: Date.now() }
          : note,
      ),
    );
  };

  const handleToggleNoteCapture = async () => {
    try {
      if (selectedId === null && !noteCaptureActive) {
        const created = await commands.createNote("", "");
        if (created.status !== "ok") {
          toast.error(created.error);
          return;
        }
        setNotes((prev) => [created.data, ...prev]);
        setSelectedId(created.data.id);
      }

      await invoke("trigger_transcription_binding", { bindingId: "note_key" });
    } catch (error) {
      toast.error(
        t("notes.captureError", {
          defaultValue: "Impossible de lancer la dictée de note",
        }),
      );
    }
  };

  const handleCloseNote = async () => {
    try {
      await invoke("close_note");
      setNoteCaptureActive(false);
      toast.success(
        t("notes.closed", {
          defaultValue:
            "Note vocale terminee - la prochaine dictée creera une nouvelle note",
        }),
      );
    } catch {
      toast.error(
        t("notes.closeError", {
          defaultValue: "Impossible de terminer la note active",
        }),
      );
    }
  };

  const handleExportNote = async () => {
    if (!selectedNote) {
      return;
    }

    try {
      const safeTitle =
        (editTitle.trim() || noteTitle(selectedNote))
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "note";

      const filePath = await save({
        defaultPath: `${safeTitle}.md`,
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "Texte", extensions: ["txt"] },
        ],
      });

      if (!filePath) {
        return;
      }

      const ext =
        filePath.split(".").pop()?.toLowerCase() === "txt" ? "txt" : "md";
      const result = await commands.exportNote(selectedNote.id, ext);
      if (result.status !== "ok") {
        toast.error(result.error);
        return;
      }

      await writeTextFile(filePath, result.data);
      toast.success(
        t("notes.exportSuccess", {
          defaultValue: "Note exportee.",
        }),
      );
    } catch {
      toast.error(
        t("notes.exportError", {
          defaultValue: "Impossible d'exporter la note",
        }),
      );
    }
  };

  const handleImportAudio = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "flac"] }],
      });
      if (!selected || typeof selected !== "string") {
        return;
      }

      toast.loading(
        t("notes.importingAudio", {
          defaultValue: "Transcription du fichier audio...",
        }),
        { id: "notes-audio-import" },
      );

      const result = await commands.transcribeAudioFileDetailed(selected);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "notes-audio-import" });
        return;
      }

      const importedText = result.data.text.trim();
      if (!importedText) {
        toast.error(
          t("notes.importAudioEmpty", {
            defaultValue: "Aucun texte n'a ete extrait du fichier",
          }),
          { id: "notes-audio-import" },
        );
        return;
      }

      const timestampedImport =
        result.data.segments.length > 1
          ? result.data.segments
              .map(
                (segment) =>
                  `[${formatImportTimestamp(segment.start_ms)}] ${segment.text.trim()}`,
              )
              .join("\n")
          : importedText;

      if (selectedId === null) {
        const created = await commands.createNote("", timestampedImport);
        if (created.status !== "ok") {
          toast.error(created.error, { id: "notes-audio-import" });
          return;
        }
        setNotes((prev) => [created.data, ...prev]);
        setSelectedId(created.data.id);
        setEditTitle(created.data.title);
        setEditContent(created.data.content);
      } else {
        const current = editContentRef.current.trimEnd();
        const nextContent = current
          ? `${current}\n\n${timestampedImport}`
          : timestampedImport;
        setEditContent(nextContent);
        editContentRef.current = nextContent;
        scheduleSave(selectedId, editTitleRef.current, nextContent);
        setNotes((prev) =>
          prev.map((note) =>
            note.id === selectedId
              ? { ...note, content: nextContent, updated_at: Date.now() }
              : note,
          ),
        );
      }

      toast.success(
        t("notes.importAudioSuccess", {
          defaultValue: "Audio ajoute a la note.",
        }),
        { id: "notes-audio-import" },
      );
    } catch {
      toast.error(
        t("notes.importAudioError", {
          defaultValue: "Impossible d'importer le fichier audio",
        }),
        { id: "notes-audio-import" },
      );
    }
  };

  const handleCopyNote = async () => {
    const text = editContentRef.current.trim();
    if (!text) {
      toast.error(
        t("notes.copyEmpty", {
          defaultValue: "Aucun contenu a copier",
        }),
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        t("notes.copySuccess", {
          defaultValue: "Note copiee.",
        }),
      );
    } catch {
      toast.error(
        t("notes.copyError", {
          defaultValue: "Impossible de copier la note",
        }),
      );
    }
  };

  const handleSummarizeNote = async () => {
    if (!selectedNote) {
      return;
    }

    try {
      toast.loading(
        t("notes.summarizing", {
          defaultValue: "Generation du resume...",
        }),
        { id: "notes-summarize" },
      );
      const result = await commands.summarizeNote(selectedNote.id);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "notes-summarize" });
        return;
      }

      const summary = result.data.trim();
      setNotes((prev) =>
        prev.map((note) =>
          note.id === selectedNote.id
            ? { ...note, summary, updated_at: Date.now() }
            : note,
        ),
      );
      toast.success(
        t("notes.summarizeSuccess", {
          defaultValue: "Resume mis a jour.",
        }),
        { id: "notes-summarize" },
      );
    } catch {
      toast.error(
        t("notes.summarizeError", {
          defaultValue: "Impossible de generer le resume",
        }),
        { id: "notes-summarize" },
      );
    }
  };

  const handleExtractActions = async () => {
    if (!selectedNote) {
      return;
    }

    try {
      toast.loading(
        t("notes.extractingActions", {
          defaultValue: "Extraction des actions...",
        }),
        { id: "notes-actions" },
      );
      const result = await commands.extractNoteActions(selectedNote.id);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "notes-actions" });
        return;
      }

      const actions = result.data.trim();
      setNotes((prev) =>
        prev.map((note) =>
          note.id === selectedNote.id
            ? { ...note, action_items: actions, updated_at: Date.now() }
            : note,
        ),
      );
      toast.success(
        t("notes.extractActionsSuccess", {
          defaultValue: "Actions mises a jour.",
        }),
        { id: "notes-actions" },
      );
    } catch {
      toast.error(
        t("notes.extractActionsError", {
          defaultValue: "Impossible d'extraire les actions",
        }),
        { id: "notes-actions" },
      );
    }
  };

  const handleGenerateTitle = async () => {
    if (!selectedNote) {
      return;
    }

    try {
      toast.loading(
        t("notes.generatingTitle", {
          defaultValue: "Generation du titre...",
        }),
        { id: "notes-title" },
      );
      const result = await commands.generateNoteTitle(selectedNote.id);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "notes-title" });
        return;
      }

      const title = result.data.trim();
      setEditTitle(title);
      editTitleRef.current = title;
      setNotes((prev) =>
        prev.map((note) =>
          note.id === selectedNote.id
            ? { ...note, title, updated_at: Date.now() }
            : note,
        ),
      );
      toast.success(
        t("notes.generateTitleSuccess", {
          defaultValue: "Titre genere.",
        }),
        { id: "notes-title" },
      );
    } catch {
      toast.error(
        t("notes.generateTitleError", {
          defaultValue: "Impossible de generer le titre",
        }),
        { id: "notes-title" },
      );
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await commands.deleteNote(id);
    if (res.status === "ok") {
      setNotes((prev) => prev.filter((note) => note.id !== id));
      if (selectedId === id) setSelectedId(null);
    } else {
      toast.error(res.error);
    }
  };

  const handleTogglePinned = async (note: NoteEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextPinned = !note.is_pinned;
    const res = await commands.setNotePinned(note.id, nextPinned);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setNotes((prev) =>
      [
        ...prev.map((entry) =>
          entry.id === note.id
            ? { ...entry, is_pinned: nextPinned, updated_at: Date.now() }
            : entry,
        ),
      ].sort(
        (a, b) =>
          Number(b.is_pinned) - Number(a.is_pinned) ||
          b.updated_at - a.updated_at,
      ),
    );
  };

  const handleToggleArchived = async (note: NoteEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextArchived = !note.is_archived;
    const res = await commands.setNoteArchived(note.id, nextArchived);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setNotes((prev) =>
      [
        ...prev.map((entry) =>
          entry.id === note.id
            ? { ...entry, is_archived: nextArchived, updated_at: Date.now() }
            : entry,
        ),
      ].sort(
        (a, b) =>
          Number(a.is_archived) - Number(b.is_archived) ||
          Number(b.is_pinned) - Number(a.is_pinned) ||
          b.updated_at - a.updated_at,
      ),
    );
  };

  const handleDuplicate = async (note: NoteEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await commands.duplicateNote(note.id);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setNotes((prev) => [res.data, ...prev]);
    setSelectedId(res.data.id);
    setEditTitle(res.data.title);
    setEditContent(res.data.content);
  };

  const scheduleSave = useCallback(
    (id: number, title: string, content: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        const res = await commands.updateNote(id, title, content);
        if (res.status === "ok") {
          setNotes((prev) =>
            prev.map((note) =>
              note.id === id
                ? { ...note, title, content, updated_at: Date.now() }
                : note,
            ),
          );
        }
        setSaving(false);
      }, 800);
    },
    [],
  );

  const handleTitleChange = (value: string) => {
    setEditTitle(value);
    if (selectedId !== null) scheduleSave(selectedId, value, editContent);
  };

  const handleContentChange = (value: string) => {
    setEditContent(value);
    if (selectedId !== null) scheduleSave(selectedId, editTitle, value);
  };

  const handleContentPaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    event.preventDefault();
    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText) {
      return;
    }

    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? editContent.length;
    const end = textarea.selectionEnd ?? editContent.length;
    const nextValue =
      editContent.slice(0, start) + pastedText + editContent.slice(end);

    setEditContent(nextValue);
    editContentRef.current = nextValue;
    if (selectedId !== null) {
      scheduleSave(selectedId, editTitle, nextValue);
    }

    requestAnimationFrame(() => {
      const cursor = start + pastedText.length;
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
    });
  };

  useEffect(() => {
    let lifecycleDispose: (() => void) | null = null;
    let previewDispose: (() => void) | null = null;
    let cancelled = false;

    const appendToNoteEditor = (text: string) => {
      const note = selectedNoteRef.current;
      if (!note || !text.trim()) {
        return;
      }

      const trimmed = text.trim();
      const currentContent = editContentRef.current;
      const nextContent =
        currentContent.trim().length > 0
          ? `${currentContent.trimEnd()}\n${trimmed}`
          : trimmed;

      editContentRef.current = nextContent;
      setEditContent(nextContent);
      scheduleSave(note.id, editTitleRef.current, nextContent);

      requestAnimationFrame(() => {
        const textarea = contentRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.selectionStart = textarea.value.length;
        textarea.selectionEnd = textarea.value.length;
      });
    };

    void listen<{ binding_id?: string | null; state?: string | null }>(
      "transcription-lifecycle",
      (event) => {
        latestBindingIdRef.current = event.payload.binding_id ?? null;
        latestLifecycleStateRef.current = event.payload.state ?? null;
        setNoteCaptureActive(
          event.payload.binding_id === "note_key" &&
            [
              "preparing_microphone",
              "recording",
              "paused",
              "stopping",
              "transcribing",
              "pasting",
            ].includes(event.payload.state ?? ""),
        );
        if (
          event.payload.state === "preparing_microphone" ||
          event.payload.state === "recording" ||
          event.payload.state === "stopping" ||
          event.payload.state === "transcribing" ||
          event.payload.state === "pasting"
        ) {
          const textarea = contentRef.current;
          if (textarea && document.activeElement === textarea) {
            contentWasFocusedRef.current = true;
            textarea.blur();
          }
        }

        if (
          event.payload.state === "completed" ||
          event.payload.state === "cancelled" ||
          event.payload.state === "error" ||
          event.payload.state === "idle"
        ) {
          if (contentWasFocusedRef.current) {
            requestAnimationFrame(() => {
              contentRef.current?.focus();
            });
            contentWasFocusedRef.current = false;
          }
        }
      },
    ).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      lifecycleDispose = dispose;
    });

    void listen<{
      operation_id?: number | null;
      text?: string | null;
      stable?: boolean;
    }>("transcription-preview", (event) => {
      const operationId = event.payload.operation_id ?? null;
      const text = event.payload.text ?? "";

      if (!event.payload.stable || !operationId || !text.trim()) {
        return;
      }

      if (handledPreviewOpRef.current === operationId) {
        return;
      }

      if (latestBindingIdRef.current === "note_key") {
        return;
      }

      if (
        latestLifecycleStateRef.current === "preparing_microphone" ||
        latestLifecycleStateRef.current === "recording" ||
        latestLifecycleStateRef.current === "paused" ||
        latestLifecycleStateRef.current === "stopping"
      ) {
        return;
      }

      handledPreviewOpRef.current = operationId;

      if (pendingFallbackTimeoutRef.current) {
        clearTimeout(pendingFallbackTimeoutRef.current);
      }

      pendingFallbackTimeoutRef.current = setTimeout(() => {
        const trimmed = text.trim();
        const currentContent = editContentRef.current.trimEnd();
        if (
          currentContent === trimmed ||
          currentContent.endsWith(`\n${trimmed}`) ||
          currentContent.endsWith(` ${trimmed}`)
        ) {
          return;
        }

        appendToNoteEditor(trimmed);
      }, 900);
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      previewDispose = dispose;
    });

    return () => {
      cancelled = true;
      if (pendingFallbackTimeoutRef.current) {
        clearTimeout(pendingFallbackTimeoutRef.current);
      }
      lifecycleDispose?.();
      previewDispose?.();
    };
  }, [scheduleSave]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      void loadNotes();
      return;
    }
    const res = await commands.searchNotes(query);
    if (res.status === "ok") setNotes(res.data);
  };

  return (
    <div
      className="grid h-full gap-5 overflow-hidden"
      style={{ minHeight: 0, gridTemplateColumns: "380px minmax(0, 1fr)" }}
    >
      <div
        className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-white/8 bg-white/[0.02]"
        style={{ minHeight: 0 }}
      >
        <div
          className="flex items-center gap-3 border-b border-white/8"
          style={{ padding: "16px 18px" }}
        >
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-white/28"
            />
            <input
              type="text"
              placeholder={t("notes.search", {
                defaultValue: "Rechercher...",
              })}
              value={searchQuery}
              onChange={(e) => void handleSearch(e.target.value)}
              style={{ padding: "11px 12px 11px 36px" }}
              className="w-full rounded-[12px] border border-white/8 bg-white/[0.04] text-[12.5px] text-white/76 placeholder-white/25 outline-none transition-all focus:border-white/14 focus:bg-white/[0.06]"
            />
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            variant="secondary"
            size="sm"
            className="shrink-0 px-3"
            title={t("notes.new", { defaultValue: "Nouvelle note" })}
          >
            <Plus size={14} />
          </Button>
        </div>

        <div
          className="flex items-center gap-2 border-b border-white/8"
          style={{ padding: "10px 18px" }}
        >
          {[
            { id: "all", label: t("common.all", { defaultValue: "Tout" }) },
            {
              id: "pinned",
              label: t("common.pinned", { defaultValue: "Epingles" }),
            },
            {
              id: "recent",
              label: t("common.recent", { defaultValue: "Recents" }),
            },
            {
              id: "archived",
              label: t("common.archived", { defaultValue: "Archives" }),
            },
          ].map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() =>
                setListFilter(
                  filter.id as "all" | "pinned" | "recent" | "archived",
                )
              }
              style={{ padding: "9px 14px", minHeight: 36 }}
              className={`inline-flex items-center justify-center rounded-[12px] border text-[12px] tracking-[0.01em] font-medium leading-none transition-all ${
                listFilter === filter.id
                  ? "border-logo-primary/24 bg-logo-primary/10 text-logo-primary/92"
                  : "border-white/8 bg-white/[0.025] text-white/42 hover:bg-white/[0.05] hover:text-white/72"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {noteCategories.length > 0 && (
          <div
            className="flex items-center gap-2 overflow-x-auto border-b border-white/8"
            style={{ padding: "10px 18px" }}
          >
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[10.5px] font-medium transition-all ${
                categoryFilter === "all"
                  ? "border-logo-primary/24 bg-logo-primary/10 text-logo-primary/92"
                  : "border-white/8 bg-white/[0.025] text-white/42 hover:bg-white/[0.05] hover:text-white/72"
              }`}
            >
              Toutes categories
            </button>
            {noteCategories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[10.5px] font-medium transition-all ${
                  categoryFilter === category
                    ? "border-logo-primary/24 bg-logo-primary/10 text-logo-primary/92"
                    : "border-white/8 bg-white/[0.025] text-white/42 hover:bg-white/[0.05] hover:text-white/72"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {visibleNotes.length === 0 && (
            <div
              style={{ padding: "72px 28px" }}
              className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[16px] border border-dashed border-white/8 bg-black/10 text-center text-[12.5px] text-white/30"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
                <FileText size={20} className="opacity-50" />
              </div>
              <p className="max-w-[240px] whitespace-pre-line leading-7">
                {t("notes.empty", {
                  defaultValue:
                    "Aucune note pour l'instant.\nCliquez sur + pour en creer une.",
                })}
              </p>
              <Button
                type="button"
                onClick={() => void handleToggleNoteCapture()}
                variant="primary-soft"
                size="sm"
              >
                <Mic size={14} />
                {t("notes.startCapture", {
                  defaultValue: "Dicter une note",
                })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleImportAudio()}
                variant="secondary"
                size="sm"
              >
                <FileAudio size={14} />
                {t("notes.importAudio", {
                  defaultValue: "Importer un audio",
                })}
              </Button>
            </div>
          )}

          {visibleNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => setSelectedId(note.id)}
              className={`group mb-1 flex cursor-pointer items-start justify-between gap-3 rounded-[14px] border transition-colors ${
                selectedId === note.id
                  ? "border-logo-primary/30 bg-logo-primary/[0.08] text-white/92"
                  : "border-transparent text-white/55 hover:border-white/6 hover:bg-white/[0.045] hover:text-white/78"
              }`}
              style={{
                padding: "14px 16px",
                opacity: note.is_archived ? 0.68 : 1,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {noteTitle(note)}
                  </p>
                  {note.category.trim() && (
                    <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[9px] font-medium tracking-[0.04em] text-white/46 uppercase">
                      {note.category}
                    </span>
                  )}
                  {noteCaptureActive && selectedId === note.id && (
                    <span className="shrink-0 rounded-full border border-logo-primary/24 bg-logo-primary/10 px-2 py-1 text-[9px] font-medium tracking-[0.06em] text-logo-primary/90 uppercase">
                      Actif
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-5 text-white/28">
                  {notePreview(note)}
                </p>
                <p className="mt-2 truncate text-[10px] text-white/24">
                  {formatNoteDate(note.updated_at)} · {t("common.words", { count: countWords(note.content) })}
                </p>
                <div className="mt-3 max-w-[220px]">
                  <input
                    type="text"
                    list="note-categories"
                    placeholder={t("notes.category")}
                    value={editCategory}
                    onChange={(e) => void handleCategoryChange(e.target.value)}
                    className="w-full rounded-[12px] border border-white/8 bg-white/[0.04] px-3 py-2 text-[12px] text-white/72 placeholder-white/22 outline-none transition-all focus:border-white/14 focus:bg-white/[0.06]"
                  />
                  <datalist id="note-categories">
                    {noteCategories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={(e) => void handleToggleArchived(note, e)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-all ${
                    note.is_archived
                      ? "border-white/10 bg-white/[0.06] text-white/64"
                      : "border-transparent text-white/0 hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  }`}
                  title={note.is_archived ? "Desarchiver" : "Archiver"}
                >
                  <Archive size={13} />
                </button>
                <button
                  onClick={(e) => void handleDuplicate(note, e)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-transparent text-white/0 transition-all hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  title="Dupliquer"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={(e) => void handleTogglePinned(note, e)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-all ${
                    note.is_pinned
                      ? "border-logo-primary/24 bg-logo-primary/10 text-logo-primary/88"
                      : "border-transparent text-white/0 hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  }`}
                  title={note.is_pinned ? "Retirer l'epingle" : "Epingler"}
                >
                  <Pin size={13} />
                </button>
                <button
                  onClick={(e) => void handleDelete(note.id, e)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-all ${
                    selectedId === note.id
                      ? "border-white/8 bg-black/10 text-white/32 hover:border-white/12 hover:bg-white/[0.06] hover:text-white/70"
                      : "border-transparent text-white/0 hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  }`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-white/8 bg-white/[0.02]"
        style={{ minHeight: 0 }}
      >
        {selectedNote === null ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <div className="flex min-h-[440px] w-full flex-col items-center justify-center gap-6 rounded-[18px] bg-white/[0.015] px-12 text-center text-white/20">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <FileText size={30} className="opacity-45" />
              </div>
              <p className="max-w-[440px] text-[15px] leading-8 text-white/30">
                {t("notes.selectOrCreate", {
                  defaultValue:
                    "Selectionnez une note ou creez-en une nouvelle",
                })}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="border-b border-white/8 bg-white/[0.02]"
              style={{ padding: "18px 22px 16px" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    placeholder={t("notes.titlePlaceholder", {
                      defaultValue: "Titre",
                    })}
                    value={editTitle}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    className="w-full bg-transparent text-[17px] font-semibold text-white/88 placeholder-white/20 outline-none"
                  />
                  <p className="mt-1 text-[10.5px] text-white/25">
                    {saving
                      ? t("notes.saving", { defaultValue: "Enregistrement..." })
                      : `${formatNoteDate(selectedNote.updated_at)} · ${t("common.words", { count: countWords(editContent) })}`}
                  </p>
                  <div className="mt-3 max-w-[220px]">
                    <input
                      type="text"
                      list="note-categories"
                      placeholder="Categorie / dossier"
                      value={editCategory}
                      onChange={(e) =>
                        void handleCategoryChange(e.target.value)
                      }
                      className="w-full rounded-[12px] border border-white/8 bg-white/[0.04] px-3 py-2 text-[12px] text-white/72 placeholder-white/22 outline-none transition-all focus:border-white/14 focus:bg-white/[0.06]"
                    />
                    <datalist id="note-categories">
                      {noteCategories.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleGenerateTitle()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    <Tag size={13} />
                    {t("notes.titleAi", { defaultValue: "Titre IA" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleExtractActions()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    <CheckSquare size={13} />
                    {t("notes.actions", { defaultValue: "Actions" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSummarizeNote()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    <Sparkles size={13} />
                    {t("notes.summarize", { defaultValue: "Resumer" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleCopyNote()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    <Copy size={13} />
                    {t("common.copy", { defaultValue: "Copier" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleImportAudio()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    <FileAudio size={13} />
                    {t("notes.importAudio", { defaultValue: "Importer" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleExportNote()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    <Download size={13} />
                    {t("notes.export", { defaultValue: "Exporter" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleToggleNoteCapture()}
                    variant={noteCaptureActive ? "secondary" : "primary-soft"}
                    size="sm"
                    className="mt-1 shrink-0"
                  >
                    {noteCaptureActive ? (
                      <Square size={13} />
                    ) : (
                      <Mic size={13} />
                    )}
                    {noteCaptureActive
                      ? t("notes.stopCapture", { defaultValue: "Arreter" })
                      : t("notes.startCapture", { defaultValue: "Dicter" })}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleCloseNote()}
                    variant="secondary"
                    size="sm"
                    className="mt-1 shrink-0"
                    title={t("notes.closeTitle", {
                      defaultValue:
                        "Terminer la note active - la prochaine dictée creera une nouvelle note",
                    })}
                  >
                    {t("notes.close", { defaultValue: "Nouvelle note" })}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <InfoPanel
                  icon={<Sparkles size={14} />}
                  label={t("notes.summarize", { defaultValue: "Resumer" })}
                  value={selectedNote.summary}
                />
                <InfoPanel
                  icon={<CheckSquare size={14} />}
                  label={t("notes.actions", { defaultValue: "Actions" })}
                  value={selectedNote.action_items}
                />
              </div>

              <textarea
                ref={contentRef}
                placeholder={t("notes.contentPlaceholder", {
                  defaultValue: "Commencez a ecrire...",
                })}
                value={editContent}
                onChange={(e) => handleContentChange(e.target.value)}
                onPaste={handleContentPaste}
                onFocus={() => {
                  contentWasFocusedRef.current = true;
                }}
                onBlur={() => {
                  if (document.activeElement !== contentRef.current) {
                    contentWasFocusedRef.current = false;
                  }
                }}
                style={{ padding: "18px 20px", fontFamily: "inherit" }}
                className="min-h-[320px] flex-1 resize-none rounded-[16px] border border-white/8 bg-black/10 text-[13px] leading-7 text-white/78 placeholder-white/20 outline-none"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

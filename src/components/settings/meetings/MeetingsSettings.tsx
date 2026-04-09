/* eslint-disable no-console, i18next/no-literal-string */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Archive,
  CheckSquare,
  ChevronRight,
  Copy,
  Download,
  FileAudio,
  Mic,
  Pin,
  Plus,
  Search,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Video,
} from "lucide-react";
import {
  commands,
  type MeetingEntry,
  type MeetingSegmentEntry,
} from "@/bindings";
import { Button } from "../../ui/Button";

function formatDate(ms: number): string {
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

function formatTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function meetingTitle(meeting: MeetingEntry): string {
  if (meeting.title && meeting.title.trim()) return meeting.title;
  return "Reunion";
}

function meetingPreview(meeting: MeetingEntry): string {
  const body = meeting.transcript.replace(/\s+/g, " ").trim();
  if (!body) {
    return "Aucune transcription";
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

type MeetingChapter = {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  preview: string;
  segmentCount: number;
};

function buildMeetingChapters(
  segments: MeetingSegmentEntry[],
): MeetingChapter[] {
  if (segments.length === 0) {
    return [];
  }

  const chapters: MeetingChapter[] = [];
  let current: MeetingSegmentEntry[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    const combined = current
      .map((segment) => segment.content.trim())
      .filter(Boolean)
      .join(" ");
    const words = combined.split(/\s+/).filter(Boolean);
    const label = words.slice(0, 6).join(" ") || "Chapitre";
    chapters.push({
      id: `${current[0].id}-${current[current.length - 1].id}`,
      startMs: current[0].timestamp_ms,
      endMs: current[current.length - 1].timestamp_ms,
      label,
      preview: combined,
      segmentCount: current.length,
    });
    current = [];
  };

  for (const segment of segments) {
    if (current.length === 0) {
      current.push(segment);
      continue;
    }

    const previous = current[current.length - 1];
    const gapMs = segment.timestamp_ms - previous.timestamp_ms;
    const currentPreview = current
      .map((entry) => entry.content.trim())
      .join(" ")
      .trim();
    const shouldSplit =
      gapMs > 90_000 || current.length >= 4 || currentPreview.length > 260;

    if (shouldSplit) {
      flush();
    }

    current.push(segment);
  }

  flush();
  return chapters;
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
            {countWords(value)} mots
          </p>
        </div>
      </div>
      <div className="px-4 py-4 text-[12.5px] leading-7 whitespace-pre-wrap text-white/72">
        {value}
      </div>
    </div>
  );
}

function ChapterPanel({
  chapters,
  aiTitles,
  onJump,
}: {
  chapters: MeetingChapter[];
  aiTitles: string[];
  onJump: (chapter: MeetingChapter) => void;
}) {
  if (chapters.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[16px] border border-white/8 bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-white/64 uppercase">
            Chapitres
          </p>
          <p className="text-[10.5px] text-white/24">
            {chapters.length} repere{chapters.length > 1 ? "s" : ""} temporel
            {chapters.length > 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-2 p-3 xl:grid-cols-2">
        {chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            type="button"
            onClick={() => onJump(chapter)}
            className="group flex items-start gap-3 rounded-[14px] border border-white/6 bg-black/10 px-3 py-3 text-left transition-all hover:border-logo-primary/18 hover:bg-logo-primary/[0.05]"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full border border-logo-primary/18 bg-logo-primary/[0.08] px-2 py-1 text-[10px] font-medium text-logo-primary/88">
                  {formatTime(chapter.startMs)}
                </span>
                <span className="truncate text-[11.5px] font-medium text-white/82">
                  {aiTitles[index] || chapter.label}
                </span>
              </div>
              <p className="line-clamp-2 text-[11px] leading-5 text-white/34">
                {chapter.preview}
              </p>
            </div>
            <ChevronRight
              size={14}
              className="mt-1 shrink-0 text-white/20 transition-colors group-hover:text-logo-primary/72"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export const MeetingsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<MeetingEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [listFilter, setListFilter] = useState<
    "all" | "pinned" | "recent" | "archived"
  >("all");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTranscript, setEditTranscript] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [aiChapterTitles, setAiChapterTitles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [detectedApp, setDetectedApp] = useState<string | null>(null);
  const [meetingCaptureActive, setMeetingCaptureActive] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptWasFocusedRef = useRef(false);
  const latestBindingIdRef = useRef<string | null>(null);
  const latestLifecycleStateRef = useRef<string | null>(null);
  const handledPreviewOpRef = useRef<number | null>(null);
  const lastMeetingSegmentRef = useRef<string | null>(null);
  const pendingFallbackTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const selectedMeetingRef = useRef<MeetingEntry | null>(null);
  const editTitleRef = useRef("");
  const editTranscriptRef = useRef("");

  const loadMeetings = useCallback(async () => {
    const res = await commands.getMeetings();
    if (res.status === "ok") setMeetings(res.data);
  }, []);

  useEffect(() => {
    void loadMeetings();
    commands.detectActiveMeetingApp().then((res) => {
      setDetectedApp(res);
    });
  }, [loadMeetings]);

  useEffect(() => {
    const unlisten: Array<() => void> = [];

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{
        id: number;
        text: string;
        timestamp_ms?: number;
        segment_id?: number;
      }>("meeting-segment-added", (event) => {
        const { id, text, timestamp_ms, segment_id } = event.payload;
        console.debug("[MeetingsSettings] meeting-segment-added", {
          id,
          text,
          selectedId,
        });
        lastMeetingSegmentRef.current = text.trim();
        setMeetings((prev) =>
          prev.map((meeting) =>
            meeting.id === id
              ? {
                  ...meeting,
                  transcript: meeting.transcript + text,
                  segments:
                    timestamp_ms && segment_id
                      ? [
                          ...meeting.segments,
                          {
                            id: segment_id,
                            meeting_id: id,
                            timestamp_ms,
                            content: text,
                          },
                        ]
                      : meeting.segments,
                  updated_at: Date.now(),
                }
              : meeting,
          ),
        );
        if (selectedId === id) {
          setEditTranscript((prev) => prev + text);
        }
        void loadMeetings();
      }).then((dispose) => unlisten.push(dispose));

      listen<MeetingEntry>("meeting-created", () => {
        void loadMeetings();
      }).then((dispose) => unlisten.push(dispose));
    });

    return () => {
      unlisten.forEach((dispose) => dispose());
    };
  }, [selectedId, loadMeetings]);

  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedId) ?? null;
  const meetingCategories = Array.from(
    new Set(meetings.map((meeting) => meeting.category.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  const meetingChapters = selectedMeeting
    ? buildMeetingChapters(selectedMeeting.segments)
    : [];
  const recentThreshold = Date.now() - 1000 * 60 * 60 * 24 * 7;
  const visibleMeetings = meetings.filter((meeting) => {
    if (listFilter === "pinned") {
      return meeting.is_pinned;
    }
    if (listFilter === "recent") {
      return meeting.updated_at >= recentThreshold;
    }
    if (listFilter === "archived") {
      return meeting.is_archived;
    }
    if (meeting.is_archived) {
      return false;
    }
    if (
      categoryFilter !== "all" &&
      meeting.category.trim() !== categoryFilter
    ) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (selectedMeeting) {
      console.debug("[MeetingsSettings] selectedMeeting -> editor sync", {
        meetingId: selectedMeeting.id,
        transcriptLength: selectedMeeting.transcript.length,
        transcriptPreview: selectedMeeting.transcript.slice(0, 120),
      });
      setEditTitle(selectedMeeting.title);
      setEditCategory(selectedMeeting.category);
      setEditTranscript(selectedMeeting.transcript);
      setAiChapterTitles([]);
    }
  }, [selectedId, selectedMeeting]);

  useEffect(() => {
    selectedMeetingRef.current = selectedMeeting;
  }, [selectedMeeting]);

  useEffect(() => {
    void invoke("set_active_meeting", { id: selectedId }).catch(
      () => undefined,
    );
  }, [selectedId]);

  useEffect(() => {
    editTitleRef.current = editTitle;
  }, [editTitle]);

  useEffect(() => {
    editTranscriptRef.current = editTranscript;
    console.debug("[MeetingsSettings] editTranscript state updated", {
      length: editTranscript.length,
      preview: editTranscript.slice(0, 160),
    });
  }, [editTranscript]);

  const handleCreate = async () => {
    const app = detectedApp ?? "";
    const res = await commands.createMeeting("", app);
    if (res.status === "ok") {
      setMeetings((prev) => [res.data, ...prev]);
      setSelectedId(res.data.id);
      setEditTitle("");
      setEditCategory("");
      setEditTranscript("");
    }
  };

  const handleCategoryChange = async (value: string) => {
    setEditCategory(value);
    if (selectedId === null) {
      return;
    }

    const normalized = value.trim();
    const res = await commands.setMeetingCategory(selectedId, normalized);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setMeetings((prev) =>
      prev.map((meeting) =>
        meeting.id === selectedId
          ? { ...meeting, category: normalized, updated_at: Date.now() }
          : meeting,
      ),
    );
  };

  const handleToggleMeetingCapture = async () => {
    try {
      if (selectedId === null && !meetingCaptureActive) {
        const app = detectedApp ?? "";
        const created = await commands.createMeeting("", app);
        if (created.status !== "ok") {
          toast.error(created.error);
          return;
        }
        setMeetings((prev) => [created.data, ...prev]);
        setSelectedId(created.data.id);
      }

      await invoke("trigger_transcription_binding", {
        bindingId: "meeting_key",
      });
    } catch {
      toast.error(
        t("meetings.captureError", {
          defaultValue: "Impossible de lancer l'enregistrement de reunion",
        }),
      );
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await commands.deleteMeeting(id);
    if (res.status === "ok") {
      setMeetings((prev) => prev.filter((meeting) => meeting.id !== id));
      if (selectedId === id) setSelectedId(null);
    } else {
      toast.error(res.error);
    }
  };

  const handleTogglePinned = async (
    meeting: MeetingEntry,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const nextPinned = !meeting.is_pinned;
    const res = await commands.setMeetingPinned(meeting.id, nextPinned);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setMeetings((prev) =>
      [
        ...prev.map((entry) =>
          entry.id === meeting.id
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

  const handleToggleArchived = async (
    meeting: MeetingEntry,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const nextArchived = !meeting.is_archived;
    const res = await commands.setMeetingArchived(meeting.id, nextArchived);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setMeetings((prev) =>
      [
        ...prev.map((entry) =>
          entry.id === meeting.id
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

  const handleDuplicate = async (
    meeting: MeetingEntry,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const res = await commands.duplicateMeeting(meeting.id);
    if (res.status !== "ok") {
      toast.error(res.error);
      return;
    }

    setMeetings((prev) => [res.data, ...prev]);
    setSelectedId(res.data.id);
    setEditTitle(res.data.title);
    setEditTranscript(res.data.transcript);
    editTranscriptRef.current = res.data.transcript;
  };

  const handleCloseMeeting = async () => {
    await commands.closeMeeting();
    setMeetingCaptureActive(false);
    toast.success(
      t("meetings.closed", {
        defaultValue:
          "Reunion terminee - le prochain enregistrement creera une nouvelle reunion",
      }),
    );
  };

  const handleExportMeeting = async () => {
    if (!selectedMeeting) {
      return;
    }

    try {
      const safeTitle =
        (editTitle.trim() || meetingTitle(selectedMeeting))
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "reunion";

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
      const result = await commands.exportMeeting(selectedMeeting.id, ext);
      if (result.status !== "ok") {
        toast.error(result.error);
        return;
      }

      await writeTextFile(filePath, result.data);
      toast.success(
        t("meetings.exportSuccess", {
          defaultValue: "Reunion exportee.",
        }),
      );
    } catch {
      toast.error(
        t("meetings.exportError", {
          defaultValue: "Impossible d'exporter la reunion",
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
        t("meetings.importingAudio", {
          defaultValue: "Transcription du fichier audio...",
        }),
        { id: "meetings-audio-import" },
      );

      const result = await commands.transcribeAudioFile(selected);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "meetings-audio-import" });
        return;
      }

      const importedText = result.data.trim();
      if (!importedText) {
        toast.error(
          t("meetings.importAudioEmpty", {
            defaultValue: "Aucun texte n'a ete extrait du fichier",
          }),
          { id: "meetings-audio-import" },
        );
        return;
      }

      if (selectedId === null) {
        const app = detectedApp ?? "";
        const created = await commands.createMeeting("", app);
        if (created.status !== "ok") {
          toast.error(created.error, { id: "meetings-audio-import" });
          return;
        }
        const nextTranscript = importedText;
        await commands.updateMeeting(
          created.data.id,
          created.data.title,
          nextTranscript,
        );
        const nextMeeting = {
          ...created.data,
          transcript: nextTranscript,
          updated_at: Date.now(),
        };
        setMeetings((prev) => [nextMeeting, ...prev]);
        setSelectedId(created.data.id);
        setEditTitle(created.data.title);
        setEditTranscript(nextTranscript);
        editTranscriptRef.current = nextTranscript;
      } else {
        const current = editTranscriptRef.current.trimEnd();
        const nextTranscript = current
          ? `${current}\n\n${importedText}`
          : importedText;
        setEditTranscript(nextTranscript);
        editTranscriptRef.current = nextTranscript;
        scheduleSave(selectedId, editTitleRef.current, nextTranscript);
        setMeetings((prev) =>
          prev.map((meeting) =>
            meeting.id === selectedId
              ? {
                  ...meeting,
                  transcript: nextTranscript,
                  updated_at: Date.now(),
                }
              : meeting,
          ),
        );
      }

      toast.success(
        t("meetings.importAudioSuccess", {
          defaultValue: "Audio ajoute a la reunion.",
        }),
        { id: "meetings-audio-import" },
      );
    } catch {
      toast.error(
        t("meetings.importAudioError", {
          defaultValue: "Impossible d'importer le fichier audio",
        }),
        { id: "meetings-audio-import" },
      );
    }
  };

  const handleCopyMeeting = async () => {
    const text = editTranscriptRef.current.trim();
    if (!text) {
      toast.error(
        t("meetings.copyEmpty", {
          defaultValue: "Aucune transcription a copier",
        }),
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        t("meetings.copySuccess", {
          defaultValue: "Reunion copiee.",
        }),
      );
    } catch {
      toast.error(
        t("meetings.copyError", {
          defaultValue: "Impossible de copier la reunion",
        }),
      );
    }
  };

  const handleSummarizeMeeting = async () => {
    if (!selectedMeeting) {
      return;
    }

    try {
      toast.loading(
        t("meetings.summarizing", {
          defaultValue: "Generation du resume...",
        }),
        { id: "meetings-summarize" },
      );
      const result = await commands.summarizeMeeting(selectedMeeting.id);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "meetings-summarize" });
        return;
      }

      const summary = result.data.trim();
      setMeetings((prev) =>
        prev.map((meeting) =>
          meeting.id === selectedMeeting.id
            ? { ...meeting, summary, updated_at: Date.now() }
            : meeting,
        ),
      );
      toast.success(
        t("meetings.summarizeSuccess", {
          defaultValue: "Resume mis a jour.",
        }),
        { id: "meetings-summarize" },
      );
    } catch {
      toast.error(
        t("meetings.summarizeError", {
          defaultValue: "Impossible de generer le resume",
        }),
        { id: "meetings-summarize" },
      );
    }
  };

  const handleExtractActions = async () => {
    if (!selectedMeeting) {
      return;
    }

    try {
      toast.loading(
        t("meetings.extractingActions", {
          defaultValue: "Extraction des actions...",
        }),
        { id: "meetings-actions" },
      );
      const result = await commands.extractMeetingActions(selectedMeeting.id);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "meetings-actions" });
        return;
      }

      const actions = result.data.trim();
      setMeetings((prev) =>
        prev.map((meeting) =>
          meeting.id === selectedMeeting.id
            ? { ...meeting, action_items: actions, updated_at: Date.now() }
            : meeting,
        ),
      );
      toast.success(
        t("meetings.extractActionsSuccess", {
          defaultValue: "Actions mises a jour.",
        }),
        { id: "meetings-actions" },
      );
    } catch {
      toast.error(
        t("meetings.extractActionsError", {
          defaultValue: "Impossible d'extraire les actions",
        }),
        { id: "meetings-actions" },
      );
    }
  };

  const handleGenerateTitle = async () => {
    if (!selectedMeeting) {
      return;
    }

    try {
      toast.loading(
        t("meetings.generatingTitle", {
          defaultValue: "Generation du titre...",
        }),
        { id: "meetings-title" },
      );
      const result = await commands.generateMeetingTitle(selectedMeeting.id);
      if (result.status !== "ok") {
        toast.error(result.error, { id: "meetings-title" });
        return;
      }

      const title = result.data.trim();
      setEditTitle(title);
      editTitleRef.current = title;
      setMeetings((prev) =>
        prev.map((meeting) =>
          meeting.id === selectedMeeting.id
            ? { ...meeting, title, updated_at: Date.now() }
            : meeting,
        ),
      );
      toast.success(
        t("meetings.generateTitleSuccess", {
          defaultValue: "Titre genere.",
        }),
        { id: "meetings-title" },
      );
    } catch {
      toast.error(
        t("meetings.generateTitleError", {
          defaultValue: "Impossible de generer le titre",
        }),
        { id: "meetings-title" },
      );
    }
  };

  const jumpToChapter = (chapter: MeetingChapter) => {
    const textarea = transcriptRef.current;
    if (!textarea) {
      return;
    }

    const chapterText = chapter.preview.trim();
    const transcript = editTranscriptRef.current;
    const index = chapterText ? transcript.indexOf(chapterText) : -1;
    const targetIndex = index >= 0 ? index : 0;

    textarea.focus();
    textarea.selectionStart = targetIndex;
    textarea.selectionEnd = targetIndex;
    textarea.scrollTop = Math.max(
      0,
      (textarea.scrollHeight / Math.max(transcript.length, 1)) * targetIndex -
        textarea.clientHeight / 3,
    );
  };

  const handleGenerateChapterTitles = async () => {
    if (!selectedMeeting) {
      return;
    }

    try {
      toast.loading("Generation des titres de chapitres...", {
        id: "meetings-chapters-ai",
      });
      const result = await commands.generateMeetingChapterTitles(
        selectedMeeting.id,
      );
      if (result.status !== "ok") {
        toast.error(result.error, { id: "meetings-chapters-ai" });
        return;
      }
      setAiChapterTitles(result.data);
      toast.success("Titres de chapitres generes.", {
        id: "meetings-chapters-ai",
      });
    } catch {
      toast.error("Impossible de generer les titres de chapitres", {
        id: "meetings-chapters-ai",
      });
    }
  };

  const scheduleSave = useCallback(
    (id: number, title: string, transcript: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        const res = await commands.updateMeeting(id, title, transcript);
        if (res.status === "ok") {
          setMeetings((prev) =>
            prev.map((meeting) =>
              meeting.id === id
                ? { ...meeting, title, transcript, updated_at: Date.now() }
                : meeting,
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
    if (selectedId !== null) scheduleSave(selectedId, value, editTranscript);
  };

  const handleTranscriptChange = (value: string) => {
    console.debug("[MeetingsSettings] handleTranscriptChange", {
      nextLength: value.length,
      nextPreview: value.slice(0, 160),
    });
    setEditTranscript(value);
    if (selectedId !== null) scheduleSave(selectedId, editTitle, value);
  };

  const handleTranscriptPaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    event.preventDefault();
    const pastedText = event.clipboardData.getData("text/plain");
    console.debug("[MeetingsSettings] handleTranscriptPaste:start", {
      pastedLength: pastedText.length,
      pastedPreview: pastedText.slice(0, 160),
      currentLength: editTranscript.length,
      currentPreview: editTranscript.slice(0, 160),
    });
    if (!pastedText) {
      console.debug("[MeetingsSettings] handleTranscriptPaste:skipped", {
        reason: "empty-clipboard-text",
      });
      return;
    }

    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? editTranscript.length;
    const end = textarea.selectionEnd ?? editTranscript.length;
    const nextValue =
      editTranscript.slice(0, start) + pastedText + editTranscript.slice(end);

    console.debug("[MeetingsSettings] handleTranscriptPaste:computed", {
      selectionStart: start,
      selectionEnd: end,
      nextLength: nextValue.length,
      nextPreview: nextValue.slice(0, 200),
    });

    setEditTranscript(nextValue);
    editTranscriptRef.current = nextValue;
    if (selectedId !== null) {
      scheduleSave(selectedId, editTitle, nextValue);
    }

    requestAnimationFrame(() => {
      const cursor = start + pastedText.length;
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
      console.debug("[MeetingsSettings] handleTranscriptPaste:applied", {
        cursor,
        domValueLength: textarea.value.length,
        domValuePreview: textarea.value.slice(0, 200),
      });
    });
  };

  useEffect(() => {
    let lifecycleDispose: (() => void) | null = null;
    let previewDispose: (() => void) | null = null;
    let cancelled = false;

    const appendToMeetingEditor = (text: string) => {
      const meeting = selectedMeetingRef.current;
      console.debug("[MeetingsSettings] appendToMeetingEditor:attempt", {
        meetingId: meeting?.id ?? null,
        text,
        currentTranscript: editTranscriptRef.current,
      });
      if (!meeting || !text.trim()) {
        console.debug("[MeetingsSettings] appendToMeetingEditor:skipped", {
          reason: !meeting ? "no-selected-meeting" : "empty-text",
        });
        return;
      }

      const trimmed = text.trim();
      const currentTranscript = editTranscriptRef.current;
      const nextTranscript =
        currentTranscript.trim().length > 0
          ? `${currentTranscript.trimEnd()}\n${trimmed}`
          : trimmed;

      editTranscriptRef.current = nextTranscript;
      setEditTranscript(nextTranscript);
      scheduleSave(meeting.id, editTitleRef.current, nextTranscript);
      console.debug("[MeetingsSettings] appendToMeetingEditor:applied", {
        meetingId: meeting.id,
        nextTranscript,
      });

      requestAnimationFrame(() => {
        const textarea = transcriptRef.current;
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
        console.debug(
          "[MeetingsSettings] transcription-lifecycle",
          event.payload,
        );
        latestBindingIdRef.current = event.payload.binding_id ?? null;
        latestLifecycleStateRef.current = event.payload.state ?? null;
        setMeetingCaptureActive(
          event.payload.binding_id === "meeting_key" &&
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
          const textarea = transcriptRef.current;
          if (textarea && document.activeElement === textarea) {
            transcriptWasFocusedRef.current = true;
            textarea.blur();
            console.debug(
              "[MeetingsSettings] transcription-lifecycle:blur-editor",
              {
                state: event.payload.state,
              },
            );
          }
        }
        if (
          event.payload.state === "completed" ||
          event.payload.state === "cancelled" ||
          event.payload.state === "error" ||
          event.payload.state === "idle"
        ) {
          latestBindingIdRef.current = null;
          if (transcriptWasFocusedRef.current) {
            requestAnimationFrame(() => {
              transcriptRef.current?.focus();
            });
            transcriptWasFocusedRef.current = false;
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
      console.debug("[MeetingsSettings] transcription-preview", {
        operationId,
        text,
        stable: event.payload.stable,
        lifecycleState: latestLifecycleStateRef.current,
        bindingId: latestBindingIdRef.current,
        lastMeetingSegment: lastMeetingSegmentRef.current,
        handledPreviewOp: handledPreviewOpRef.current,
      });

      if (!event.payload.stable || !operationId || !text.trim()) {
        console.debug("[MeetingsSettings] transcription-preview:skipped", {
          reason: !event.payload.stable
            ? "not-stable"
            : !operationId
              ? "no-operation-id"
              : "empty-text",
        });
        return;
      }

      if (handledPreviewOpRef.current === operationId) {
        console.debug("[MeetingsSettings] transcription-preview:skipped", {
          reason: "already-handled-operation",
          operationId,
        });
        return;
      }

      if (
        latestLifecycleStateRef.current === "preparing_microphone" ||
        latestLifecycleStateRef.current === "recording" ||
        latestLifecycleStateRef.current === "paused" ||
        latestLifecycleStateRef.current === "stopping"
      ) {
        console.debug("[MeetingsSettings] transcription-preview:skipped", {
          reason: "preview-during-recording-phase",
          operationId,
          lifecycleState: latestLifecycleStateRef.current,
        });
        return;
      }

      handledPreviewOpRef.current = operationId;

      if (latestBindingIdRef.current === "meeting_key") {
        console.debug("[MeetingsSettings] transcription-preview:skipped", {
          reason: "meeting-key-owned-by-backend",
          operationId,
        });
        return;
      }

      if (lastMeetingSegmentRef.current === text.trim()) {
        console.debug("[MeetingsSettings] transcription-preview:skipped", {
          reason: "duplicate-of-meeting-segment",
          operationId,
          text,
        });
        lastMeetingSegmentRef.current = null;
        return;
      }

      console.debug(
        "[MeetingsSettings] transcription-preview:append-fallback",
        {
          operationId,
          text,
        },
      );
      if (pendingFallbackTimeoutRef.current) {
        clearTimeout(pendingFallbackTimeoutRef.current);
      }
      pendingFallbackTimeoutRef.current = setTimeout(() => {
        const trimmed = text.trim();
        const currentTranscript = editTranscriptRef.current.trimEnd();
        console.debug("[MeetingsSettings] delayed-fallback:check", {
          operationId,
          trimmedLength: trimmed.length,
          trimmedPreview: trimmed.slice(0, 160),
          currentLength: currentTranscript.length,
          currentPreview: currentTranscript.slice(0, 160),
        });
        if (
          currentTranscript === trimmed ||
          currentTranscript.endsWith(`\n${trimmed}`) ||
          currentTranscript.endsWith(` ${trimmed}`)
        ) {
          console.debug(
            "[MeetingsSettings] transcription-preview:skip-delayed-fallback",
            {
              reason: "text-already-present-after-native-paste",
              operationId,
              text: trimmed,
            },
          );
          return;
        }

        appendToMeetingEditor(trimmed);
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
      void loadMeetings();
      return;
    }
    const res = await commands.searchMeetings(query);
    if (res.status === "ok") setMeetings(res.data);
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
        {detectedApp && (
          <div
            style={{ padding: "12px 16px" }}
            className="flex items-center gap-2 border-b border-white/8 bg-emerald-500/[0.05]"
          >
            <Video size={12} className="text-emerald-400/70" />
            <span className="truncate text-[11.5px] text-emerald-300/80">
              {detectedApp}
            </span>
          </div>
        )}

        <div
          style={{ padding: "16px 18px" }}
          className="flex items-center gap-3 border-b border-white/8"
        >
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-white/28"
            />
            <input
              type="text"
              placeholder={t("meetings.search", {
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
            title={t("meetings.new", { defaultValue: "Nouvelle reunion" })}
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
              className={`inline-flex min-h-9 items-center justify-center rounded-[12px] border px-[14px] py-[9px] text-[11px] leading-none font-medium transition-all ${
                listFilter === filter.id
                  ? "border-logo-primary/24 bg-logo-primary/10 text-logo-primary/92"
                  : "border-white/8 bg-white/[0.025] text-white/42 hover:bg-white/[0.05] hover:text-white/72"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {meetingCategories.length > 0 && (
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
            {meetingCategories.map((category) => (
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
          {visibleMeetings.length === 0 && (
            <div
              style={{ padding: "72px 28px" }}
              className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[16px] border border-dashed border-white/8 bg-black/10 text-center text-[12.5px] text-white/30"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
                <Mic size={20} className="opacity-50" />
              </div>
              <p className="max-w-[240px] whitespace-pre-line leading-7">
                {t("meetings.empty", {
                  defaultValue:
                    "Aucune reunion pour l'instant.\nAppuyez sur votre touche reunion pour commencer.",
                })}
              </p>
              <Button
                type="button"
                onClick={() => void handleToggleMeetingCapture()}
                variant="primary-soft"
                size="sm"
              >
                <Mic size={14} />
                {t("meetings.startCapture", {
                  defaultValue: "Demarrer une reunion",
                })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleImportAudio()}
                variant="secondary"
                size="sm"
              >
                <FileAudio size={14} />
                {t("meetings.importAudio", {
                  defaultValue: "Importer un audio",
                })}
              </Button>
            </div>
          )}

          {visibleMeetings.map((meeting) => (
            <div
              key={meeting.id}
              onClick={() => setSelectedId(meeting.id)}
              style={{
                padding: "14px 16px",
                opacity: meeting.is_archived ? 0.68 : 1,
              }}
              className={`group mb-1 flex cursor-pointer items-start justify-between gap-3 rounded-[14px] border transition-colors ${
                selectedId === meeting.id
                  ? "border-logo-primary/30 bg-logo-primary/[0.08] text-white/92"
                  : "border-transparent text-white/55 hover:border-white/6 hover:bg-white/[0.045] hover:text-white/78"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {meetingTitle(meeting)}
                  </p>
                  {meeting.category.trim() && (
                    <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[9px] font-medium tracking-[0.04em] text-white/46 uppercase">
                      {meeting.category}
                    </span>
                  )}
                  {meetingCaptureActive && selectedId === meeting.id && (
                    <span className="shrink-0 rounded-full border border-logo-primary/24 bg-logo-primary/10 px-2 py-1 text-[9px] font-medium tracking-[0.06em] text-logo-primary/90 uppercase">
                      Actif
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-5 text-white/28">
                  {meetingPreview(meeting)}
                </p>
                <div className="flex items-center gap-2">
                  {meeting.app_name && (
                    <span className="truncate text-[10px] text-white/24">
                      {meeting.app_name}
                    </span>
                  )}
                  <span className="truncate text-[10px] text-white/20">
                    {formatDate(meeting.updated_at)} ·{" "}
                    {countWords(meeting.transcript)} mots
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={(e) => void handleToggleArchived(meeting, e)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-all ${
                    meeting.is_archived
                      ? "border-white/10 bg-white/[0.06] text-white/64"
                      : "border-transparent text-white/0 hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  }`}
                  title={meeting.is_archived ? "Desarchiver" : "Archiver"}
                >
                  <Archive size={13} />
                </button>
                <button
                  onClick={(e) => void handleDuplicate(meeting, e)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-transparent text-white/0 transition-all hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  title="Dupliquer"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={(e) => void handleTogglePinned(meeting, e)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-all ${
                    meeting.is_pinned
                      ? "border-logo-primary/24 bg-logo-primary/10 text-logo-primary/88"
                      : "border-transparent text-white/0 hover:border-white/8 hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/26"
                  }`}
                  title={meeting.is_pinned ? "Retirer l'epingle" : "Epingler"}
                >
                  <Pin size={13} />
                </button>
                <button
                  onClick={(e) => void handleDelete(meeting.id, e)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-all ${
                    selectedId === meeting.id
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
        {selectedMeeting === null ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <div className="flex min-h-[440px] w-full flex-col items-center justify-center gap-6 rounded-[18px] bg-white/[0.015] px-12 text-center text-white/20">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <Mic size={30} className="opacity-45" />
              </div>
              <p className="max-w-[440px] text-[15px] leading-8 text-white/30">
                {t("meetings.selectOrCreate", {
                  defaultValue:
                    "Selectionnez une reunion ou demarrez un enregistrement pour en creer une",
                })}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{ padding: "18px 22px 16px" }}
              className="flex items-start justify-between gap-4 border-b border-white/8 bg-white/[0.02]"
            >
              <div className="flex-1">
                <input
                  type="text"
                  placeholder={t("meetings.titlePlaceholder", {
                    defaultValue: "Titre de la reunion",
                  })}
                  value={editTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full bg-transparent text-[17px] font-semibold text-white/88 placeholder-white/20 outline-none"
                />
                <p className="mt-1 text-[10.5px] text-white/25">
                  {saving
                    ? t("meetings.saving", {
                        defaultValue: "Enregistrement...",
                      })
                    : `${formatDate(selectedMeeting.updated_at)} · ${countWords(editTranscript)} mots`}
                </p>
                <div className="mt-3 max-w-[220px]">
                  <input
                    type="text"
                    list="meeting-categories"
                    placeholder="Categorie / dossier"
                    value={editCategory}
                    onChange={(e) => void handleCategoryChange(e.target.value)}
                    className="w-full rounded-[12px] border border-white/8 bg-white/[0.04] px-3 py-2 text-[12px] text-white/72 placeholder-white/22 outline-none transition-all focus:border-white/14 focus:bg-white/[0.06]"
                  />
                  <datalist id="meeting-categories">
                    {meetingCategories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => void handleGenerateTitle()}
                variant="secondary"
                size="sm"
                className="mt-1 shrink-0"
              >
                <Tag size={13} />
                {t("meetings.titleAi", { defaultValue: "Titre IA" })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleGenerateChapterTitles()}
                variant="secondary"
                size="sm"
                className="mt-1 shrink-0"
              >
                <Sparkles size={13} />
                Chapitres IA
              </Button>
              <Button
                type="button"
                onClick={() => void handleExtractActions()}
                variant="secondary"
                size="sm"
                className="mt-1 shrink-0"
              >
                <CheckSquare size={13} />
                {t("meetings.actions", { defaultValue: "Actions" })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSummarizeMeeting()}
                variant="secondary"
                size="sm"
                className="mt-1 shrink-0"
              >
                <Sparkles size={13} />
                {t("meetings.summarize", { defaultValue: "Resumer" })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleCopyMeeting()}
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
                {t("meetings.importAudio", { defaultValue: "Importer" })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleExportMeeting()}
                variant="secondary"
                size="sm"
                className="mt-1 shrink-0"
              >
                <Download size={13} />
                {t("meetings.export", { defaultValue: "Exporter" })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleToggleMeetingCapture()}
                variant={meetingCaptureActive ? "secondary" : "primary-soft"}
                size="sm"
                className="mt-1 shrink-0"
              >
                {meetingCaptureActive ? (
                  <Square size={13} />
                ) : (
                  <Mic size={13} />
                )}
                {meetingCaptureActive
                  ? t("meetings.stopCapture", { defaultValue: "Arreter" })
                  : t("meetings.startCapture", { defaultValue: "Enregistrer" })}
              </Button>
              <Button
                type="button"
                onClick={() => void handleCloseMeeting()}
                variant="secondary"
                size="sm"
                className="mt-1 shrink-0"
                title={t("meetings.closeTitle", {
                  defaultValue:
                    "Terminer la reunion - le prochain enregistrement creera une nouvelle reunion",
                })}
              >
                {t("meetings.close", { defaultValue: "Terminer" })}
              </Button>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <InfoPanel
                  icon={<Sparkles size={14} />}
                  label={t("meetings.summarize", { defaultValue: "Resumer" })}
                  value={selectedMeeting.summary}
                />
                <InfoPanel
                  icon={<CheckSquare size={14} />}
                  label={t("meetings.actions", { defaultValue: "Actions" })}
                  value={selectedMeeting.action_items}
                />
              </div>

              <ChapterPanel
                chapters={meetingChapters}
                aiTitles={aiChapterTitles}
                onJump={jumpToChapter}
              />

              <textarea
                ref={transcriptRef}
                placeholder={t("meetings.transcriptPlaceholder", {
                  defaultValue:
                    "La transcription apparaitra ici pendant que vous parlez...",
                })}
                value={editTranscript}
                onChange={(e) => handleTranscriptChange(e.target.value)}
                onPaste={handleTranscriptPaste}
                onFocus={() => {
                  transcriptWasFocusedRef.current = true;
                }}
                onBlur={() => {
                  if (document.activeElement !== transcriptRef.current) {
                    transcriptWasFocusedRef.current = false;
                  }
                }}
                onSelect={(e) => {
                  const target = e.currentTarget;
                  console.debug("[MeetingsSettings] textarea:onSelect", {
                    start: target.selectionStart,
                    end: target.selectionEnd,
                    valueLength: target.value.length,
                  });
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

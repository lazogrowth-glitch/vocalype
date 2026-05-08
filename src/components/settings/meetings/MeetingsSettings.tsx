/* eslint-disable no-console, i18next/no-literal-string */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pin, Video } from "lucide-react";
import {
  commands,
  type MeetingEntry,
  type MeetingSegmentEntry,
} from "@/bindings";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";

// ── Design tokens (exact from mockup) ─────────────────────────────────────
const T = {
  gold: "#c9a84c",
  goldSoft: "rgba(201,168,76,0.12)",
  goldLine: "rgba(201,168,76,0.32)",
  bg0: "#0a0a0e",
  bg1: "#101015",
  bg2: "#15151c",
  line: "rgba(255,255,255,0.06)",
  line2: "rgba(255,255,255,0.10)",
  txt1: "rgba(255,255,255,0.92)",
  txt2: "rgba(255,255,255,0.62)",
  txt3: "rgba(255,255,255,0.36)",
  txt4: "rgba(255,255,255,0.20)",
  rec: "#ef4444",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(ms: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function fmtClock(ms: number) {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function dayLabel(ms: number) {
  const d = new Date(ms),
    now = new Date(),
    yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yest.toDateString()) return "Hier";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
  }).format(d);
}

function meetingTitle(m: MeetingEntry) {
  return m.title?.trim() || m.category?.trim() || "Réunion";
}

function meetingPreview(m: MeetingEntry) {
  return m.transcript.replace(/\s+/g, " ").trim() || "Aucune transcription";
}

function durationLabel(m: MeetingEntry) {
  if (m.segments.length < 2) return "";
  const min = Math.floor(
    (m.segments[m.segments.length - 1].timestamp_ms -
      m.segments[0].timestamp_ms) /
      60000,
  );
  return min > 0 ? `${min} min` : "";
}

function itemTag(category: string) {
  const c = category.trim();
  if (!c) return "Réunion";
  return c;
}

// ── Chapter helpers ────────────────────────────────────────────────────────

type Chapter = { id: string; startMs: number; label: string; preview: string };

function buildChapters(segs: MeetingSegmentEntry[]): Chapter[] {
  if (!segs.length) return [];
  const out: Chapter[] = [];
  let cur: MeetingSegmentEntry[] = [];
  const flush = () => {
    if (!cur.length) return;
    const combined = cur
      .map((s) => s.content.trim())
      .filter(Boolean)
      .join(" ");
    const words = combined.split(/\s+/).filter(Boolean);
    out.push({
      id: `${cur[0].id}-${cur[cur.length - 1].id}`,
      startMs: cur[0].timestamp_ms,
      label: words.slice(0, 6).join(" ") || "Chapitre",
      preview: combined,
    });
    cur = [];
  };
  for (const s of segs) {
    if (!cur.length) {
      cur.push(s);
      continue;
    }
    const gap = s.timestamp_ms - cur[cur.length - 1].timestamp_ms;
    if (
      gap > 90_000 ||
      cur.length >= 4 ||
      cur.map((x) => x.content).join("").length > 260
    )
      flush();
    cur.push(s);
  }
  flush();
  return out;
}

// ── SVG icons (inline, exact from mockup) ────────────────────────────────

function IcoPhone({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}
function IcoMic({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
function IcoUsers({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IcoFolder({
  size = 11,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IcoEdit({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
function IcoCal({
  size = 13,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IcoClock({
  size = 13,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IcoShare({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function IcoDots({
  size = 15,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
    >
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
    </svg>
  );
}
function IcoSearch({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IcoPlus({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IcoPinFill({
  size = 12,
  color = T.gold,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M16 12V4a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v8l-2 3v2h12v-2zM12 17v5" />
    </svg>
  );
}
function IcoChevron({
  size = 14,
  color = T.txt4,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function IcoSparkle({
  size = 11,
  color = T.gold,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}
function IcoRefresh({
  size = 11,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
function IcoTrash({
  size = 12,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function ItemIcon({ category }: { category: string }) {
  const c = category.toLowerCase();
  if (c === "appel" || c === "call")
    return <IcoPhone size={14} color={T.txt2} />;
  if (c === "note" || c === "note vocale")
    return <IcoMic size={14} color={T.txt2} />;
  return <IcoUsers size={14} color={T.txt2} />;
}

// ── Main component ─────────────────────────────────────────────────────────

type Tab = "summary" | "transcript" | "chapters" | "actions";

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
  const [aiChapterTitles, setAiChapterTitles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [detectedApp, setDetectedApp] = useState<string | null>(null);
  const [captureActive, setCaptureActive] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [titleEditing, setTitleEditing] = useState(false);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLTextAreaElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptWasFocusedRef = useRef(false);
  const latestBindingIdRef = useRef<string | null>(null);
  const latestLifecycleStateRef = useRef<string | null>(null);
  const handledPreviewOpRef = useRef<number | null>(null);
  const lastSegRef = useRef<string | null>(null);
  const pendingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedMeetingRef = useRef<MeetingEntry | null>(null);
  const editTitleRef = useRef("");
  const editTranscriptRef = useRef("");

  const loadMeetings = useCallback(async () => {
    const res = await commands.getMeetings();
    if (res.status === "ok") setMeetings(res.data);
  }, []);

  useEffect(() => {
    void loadMeetings();
    commands.detectActiveMeetingApp().then((r) => setDetectedApp(r));
  }, [loadMeetings]);

  useEffect(() => {
    const unlisten: Array<() => void> = [];
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{
        id: number;
        text: string;
        timestamp_ms?: number;
        segment_id?: number;
      }>("meeting-segment-added", (e) => {
        const { id, text, timestamp_ms, segment_id } = e.payload;
        console.debug("[Meetings] segment-added", { id, text });
        lastSegRef.current = text.trim();
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  transcript: m.transcript + text,
                  segments:
                    timestamp_ms && segment_id
                      ? [
                          ...m.segments,
                          {
                            id: segment_id,
                            meeting_id: id,
                            timestamp_ms,
                            content: text,
                          },
                        ]
                      : m.segments,
                  updated_at: Date.now(),
                }
              : m,
          ),
        );
        if (selectedId === id) setEditTranscript((prev) => prev + text);
        void loadMeetings();
      }).then((d) => unlisten.push(d));
      listen<MeetingEntry>("meeting-created", () => {
        void loadMeetings();
      }).then((d) => unlisten.push(d));
    });
    return () => {
      unlisten.forEach((d) => d());
    };
  }, [selectedId, loadMeetings]);

  const selectedMeeting = meetings.find((m) => m.id === selectedId) ?? null;
  const chapters = selectedMeeting
    ? buildChapters(selectedMeeting.segments)
    : [];
  const recentThreshold = Date.now() - 7 * 24 * 3600 * 1000;

  const visibleMeetings = meetings
    .filter((m) => {
      if (listFilter === "pinned") return m.is_pinned;
      if (listFilter === "recent") return m.updated_at >= recentThreshold;
      if (listFilter === "archived") return m.is_archived;
      return !m.is_archived;
    })
    .filter((m) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        meetingTitle(m).toLowerCase().includes(q) ||
        m.transcript.toLowerCase().includes(q)
      );
    });

  const groups: { label: string; items: MeetingEntry[] }[] = [];
  for (const m of visibleMeetings) {
    const lbl = dayLabel(m.updated_at);
    const g = groups.find((x) => x.label === lbl);
    if (g) g.items.push(m);
    else groups.push({ label: lbl, items: [m] });
  }

  useEffect(() => {
    if (selectedMeeting) {
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
    void invoke("set_active_meeting", { id: selectedId }).catch(() => {});
  }, [selectedId]);
  useEffect(() => {
    editTitleRef.current = editTitle;
  }, [editTitle]);
  useEffect(() => {
    editTranscriptRef.current = editTranscript;
  }, [editTranscript]);

  const scheduleSave = useCallback(
    (id: number, title: string, transcript: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        const r = await commands.updateMeeting(id, title, transcript);
        if (r.status === "ok") {
          setMeetings((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, title, transcript, updated_at: Date.now() }
                : m,
            ),
          );
        }
        setSaving(false);
      }, 800);
    },
    [],
  );

  // Live transcription events
  useEffect(() => {
    let ld: (() => void) | null = null,
      pd: (() => void) | null = null,
      cancelled = false;

    const append = (text: string) => {
      const m = selectedMeetingRef.current;
      if (!m || !text.trim()) return;
      const trimmed = text.trim();
      const cur = editTranscriptRef.current;
      const next = cur.trim() ? `${cur.trimEnd()}\n${trimmed}` : trimmed;
      editTranscriptRef.current = next;
      setEditTranscript(next);
      scheduleSave(m.id, editTitleRef.current, next);
      requestAnimationFrame(() => {
        const ta = transcriptRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = ta.value.length;
        }
      });
    };

    void listen<{ binding_id?: string | null; state?: string | null }>(
      "transcription-lifecycle",
      (e) => {
        console.debug("[Meetings] lifecycle", e.payload);
        latestBindingIdRef.current = e.payload.binding_id ?? null;
        latestLifecycleStateRef.current = e.payload.state ?? null;
        setCaptureActive(
          e.payload.binding_id === "meeting_key" &&
            [
              "preparing_microphone",
              "recording",
              "paused",
              "stopping",
              "transcribing",
              "pasting",
            ].includes(e.payload.state ?? ""),
        );
        if (
          [
            "preparing_microphone",
            "recording",
            "stopping",
            "transcribing",
            "pasting",
          ].includes(e.payload.state ?? "")
        ) {
          const ta = transcriptRef.current;
          if (ta && document.activeElement === ta) {
            transcriptWasFocusedRef.current = true;
            ta.blur();
          }
        }
        if (
          ["completed", "cancelled", "error", "idle"].includes(
            e.payload.state ?? "",
          )
        ) {
          latestBindingIdRef.current = null;
          if (transcriptWasFocusedRef.current) {
            requestAnimationFrame(() => transcriptRef.current?.focus());
            transcriptWasFocusedRef.current = false;
          }
        }
      },
    ).then((d) => {
      if (cancelled) d();
      else ld = d;
    });

    void listen<{
      operation_id?: number | null;
      text?: string | null;
      stable?: boolean;
    }>("transcription-preview", (e) => {
      const opId = e.payload.operation_id ?? null;
      const text = e.payload.text ?? "";
      if (!e.payload.stable || !opId || !text.trim()) return;
      if (
        handledPreviewOpRef.current === opId ||
        latestBindingIdRef.current === "meeting_key"
      )
        return;
      if (
        ["preparing_microphone", "recording", "paused", "stopping"].includes(
          latestLifecycleStateRef.current ?? "",
        )
      )
        return;
      handledPreviewOpRef.current = opId;
      if (pendingFallbackRef.current) clearTimeout(pendingFallbackRef.current);
      pendingFallbackRef.current = setTimeout(() => {
        const trimmed = text.trim();
        const cur = editTranscriptRef.current.trimEnd();
        if (
          cur === trimmed ||
          cur.endsWith(`\n${trimmed}`) ||
          cur.endsWith(` ${trimmed}`)
        )
          return;
        if (lastSegRef.current === trimmed) {
          lastSegRef.current = null;
          return;
        }
        append(trimmed);
      }, 900);
    }).then((d) => {
      if (cancelled) d();
      else pd = d;
    });

    return () => {
      cancelled = true;
      if (pendingFallbackRef.current) clearTimeout(pendingFallbackRef.current);
      ld?.();
      pd?.();
    };
  }, [scheduleSave]);

  // Handlers
  const handleCreate = async (category = "Réunion") => {
    const r = await commands.createMeeting("", detectedApp ?? "");
    if (r.status === "ok") {
      if (category !== "Réunion")
        await commands.setMeetingCategory(r.data.id, category);
      setMeetings((prev) => [{ ...r.data, category }, ...prev]);
      setSelectedId(r.data.id);
      setEditTitle("");
      setEditCategory(category);
      setEditTranscript("");
      setActiveTab("transcript");
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  };

  const handleToggleCapture = async () => {
    try {
      if (selectedId === null && !captureActive) {
        const created = await commands.createMeeting("", detectedApp ?? "");
        if (created.status !== "ok") {
          toast.error(getUserFacingErrorMessage(created.error, { t }));
          return;
        }
        setMeetings((prev) => [created.data, ...prev]);
        setSelectedId(created.data.id);
        invoke("set_active_meeting", { id: created.data.id }).catch(() => {});
      }
      await invoke("trigger_transcription_binding", {
        bindingId: "meeting_key",
      });
    } catch {
      toast.error(
        t("meetings.captureError", {
          defaultValue: "Impossible de lancer l'enregistrement",
        }),
      );
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const r = await commands.deleteMeeting(id);
    if (r.status === "ok") {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
    } else toast.error(getUserFacingErrorMessage(r.error, { t }));
  };

  const handleTogglePin = async (m: MeetingEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !m.is_pinned;
    const r = await commands.setMeetingPinned(m.id, next);
    if (r.status !== "ok") {
      toast.error(getUserFacingErrorMessage(r.error, { t }));
      return;
    }
    setMeetings((prev) =>
      [
        ...prev.map((x) =>
          x.id === m.id ? { ...x, is_pinned: next, updated_at: Date.now() } : x,
        ),
      ].sort(
        (a, b) =>
          Number(b.is_pinned) - Number(a.is_pinned) ||
          b.updated_at - a.updated_at,
      ),
    );
  };

  const handleToggleArchive = async (m: MeetingEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !m.is_archived;
    const r = await commands.setMeetingArchived(m.id, next);
    if (r.status !== "ok") {
      toast.error(getUserFacingErrorMessage(r.error, { t }));
      return;
    }
    setMeetings((prev) =>
      [
        ...prev.map((x) =>
          x.id === m.id
            ? { ...x, is_archived: next, updated_at: Date.now() }
            : x,
        ),
      ].sort(
        (a, b) =>
          Number(a.is_archived) - Number(b.is_archived) ||
          Number(b.is_pinned) - Number(a.is_pinned) ||
          b.updated_at - a.updated_at,
      ),
    );
  };

  const handleDuplicate = async (m: MeetingEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const r = await commands.duplicateMeeting(m.id);
    if (r.status !== "ok") {
      toast.error(getUserFacingErrorMessage(r.error, { t }));
      return;
    }
    setMeetings((prev) => [r.data, ...prev]);
    setSelectedId(r.data.id);
    setEditTitle(r.data.title);
    setEditTranscript(r.data.transcript);
    editTranscriptRef.current = r.data.transcript;
  };

  const handleExport = async () => {
    if (!selectedMeeting) return;
    try {
      const safe =
        (editTitle.trim() || meetingTitle(selectedMeeting))
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "reunion";
      const fp = await save({
        defaultPath: `${safe}.md`,
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "Texte", extensions: ["txt"] },
        ],
      });
      if (!fp) return;
      const ext = fp.split(".").pop()?.toLowerCase() === "txt" ? "txt" : "md";
      const r = await commands.exportMeeting(selectedMeeting.id, ext);
      if (r.status !== "ok") {
        toast.error(getUserFacingErrorMessage(r.error, { t }));
        return;
      }
      await writeTextFile(fp, r.data);
      toast.success("Réunion exportée.");
    } catch {
      toast.error("Impossible d'exporter.");
    }
  };

  const handleImportAudio = async () => {
    try {
      const sel = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "flac"] }],
      });
      if (!sel || typeof sel !== "string") return;
      toast.loading("Transcription du fichier audio...", { id: "m-import" });
      const r = await commands.transcribeAudioFile(sel);
      if (r.status !== "ok") {
        toast.error(getUserFacingErrorMessage(r.error, { t }), {
          id: "m-import",
        });
        return;
      }
      const imported = r.data.trim();
      if (!imported) {
        toast.error("Aucun texte extrait.", { id: "m-import" });
        return;
      }
      if (selectedId === null) {
        const c = await commands.createMeeting("", detectedApp ?? "");
        if (c.status !== "ok") {
          toast.error(getUserFacingErrorMessage(c.error, { t }), {
            id: "m-import",
          });
          return;
        }
        await commands.updateMeeting(c.data.id, c.data.title, imported);
        setMeetings((prev) => [
          { ...c.data, transcript: imported, updated_at: Date.now() },
          ...prev,
        ]);
        setSelectedId(c.data.id);
        setEditTitle(c.data.title);
        setEditTranscript(imported);
        editTranscriptRef.current = imported;
      } else {
        const cur = editTranscriptRef.current.trimEnd();
        const next = cur ? `${cur}\n\n${imported}` : imported;
        setEditTranscript(next);
        editTranscriptRef.current = next;
        scheduleSave(selectedId, editTitleRef.current, next);
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === selectedId
              ? { ...m, transcript: next, updated_at: Date.now() }
              : m,
          ),
        );
      }
      toast.success("Audio ajouté.", { id: "m-import" });
    } catch {
      toast.error("Impossible d'importer.", { id: "m-import" });
    }
  };

  const handleCopyTranscript = async () => {
    const text = editTranscriptRef.current.trim();
    if (!text) {
      toast.error("Aucune transcription à copier.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Transcription copiée.");
    } catch {
      toast.error("Impossible de copier.");
    }
  };

  const handleCopySummary = async () => {
    const text = selectedMeeting?.summary?.trim();
    if (!text) {
      toast.error("Aucun résumé disponible.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Résumé copié.");
    } catch {
      toast.error("Impossible de copier.");
    }
  };

  const handleSummarize = async () => {
    if (!selectedMeeting) return;
    toast.loading("Génération du résumé...", { id: "m-sum" });
    try {
      const r = await commands.summarizeMeeting(selectedMeeting.id);
      if (r.status !== "ok") {
        toast.error(getUserFacingErrorMessage(r.error, { t }), { id: "m-sum" });
        return;
      }
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === selectedMeeting.id
            ? { ...m, summary: r.data.trim(), updated_at: Date.now() }
            : m,
        ),
      );
      toast.success("Résumé mis à jour.", { id: "m-sum" });
    } catch {
      toast.error("Impossible de générer.", { id: "m-sum" });
    }
  };

  const handleExtractActions = async () => {
    if (!selectedMeeting) return;
    toast.loading("Extraction des actions...", { id: "m-act" });
    try {
      const r = await commands.extractMeetingActions(selectedMeeting.id);
      if (r.status !== "ok") {
        toast.error(getUserFacingErrorMessage(r.error, { t }), { id: "m-act" });
        return;
      }
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === selectedMeeting.id
            ? { ...m, action_items: r.data.trim(), updated_at: Date.now() }
            : m,
        ),
      );
      toast.success("Actions mises à jour.", { id: "m-act" });
    } catch {
      toast.error("Impossible d'extraire.", { id: "m-act" });
    }
  };

  const handleGenTitle = async () => {
    if (!selectedMeeting) return;
    // Flush any pending save so the backend has the latest transcript before generating
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await commands.updateMeeting(
        selectedMeeting.id,
        editTitleRef.current,
        editTranscriptRef.current,
      );
    }
    toast.loading("Génération du titre...", { id: "m-title" });
    try {
      const r = await commands.generateMeetingTitle(selectedMeeting.id);
      if (r.status !== "ok") {
        toast.error(getUserFacingErrorMessage(r.error, { t }), {
          id: "m-title",
        });
        return;
      }
      const title = r.data.trim();
      setEditTitle(title);
      editTitleRef.current = title;
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === selectedMeeting.id
            ? { ...m, title, updated_at: Date.now() }
            : m,
        ),
      );
      toast.success("Titre généré.", { id: "m-title" });
    } catch {
      toast.error("Impossible.", { id: "m-title" });
    }
  };

  const handleGenChapterTitles = async () => {
    if (!selectedMeeting) return;
    toast.loading(t("meetings.generatingChapterTitles"), { id: "m-ch" });
    try {
      const r = await commands.generateMeetingChapterTitles(selectedMeeting.id);
      if (r.status !== "ok") {
        toast.error(getUserFacingErrorMessage(r.error, { t }), { id: "m-ch" });
        return;
      }
      setAiChapterTitles(r.data);
      toast.success(t("meetings.generateChapterTitlesSuccess"), { id: "m-ch" });
    } catch {
      toast.error(t("meetings.generateChapterTitlesError"), { id: "m-ch" });
    }
  };

  const jumpToChapter = (ch: Chapter) => {
    setActiveTab("transcript");
    const ta = transcriptRef.current;
    if (!ta) return;
    const idx = ch.preview
      ? editTranscriptRef.current.indexOf(ch.preview.trim())
      : -1;
    const target = idx >= 0 ? idx : 0;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = target;
    ta.scrollTop = Math.max(
      0,
      (ta.scrollHeight / Math.max(editTranscriptRef.current.length, 1)) *
        target -
        ta.clientHeight / 3,
    );
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      void loadMeetings();
      return;
    }
    const r = await commands.searchMeetings(q);
    if (r.status === "ok") setMeetings(r.data);
  };

  const handleTitleChange = (v: string) => {
    setEditTitle(v);
    if (selectedId !== null) scheduleSave(selectedId, v, editTranscript);
  };

  const handleTranscriptChange = (v: string) => {
    setEditTranscript(v);
    if (selectedId !== null) scheduleSave(selectedId, editTitle, v);
  };

  const handleTranscriptPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text/plain");
    if (!pasted) return;
    const ta = e.currentTarget;
    const start = ta.selectionStart ?? editTranscript.length;
    const end = ta.selectionEnd ?? editTranscript.length;
    const next =
      editTranscript.slice(0, start) + pasted + editTranscript.slice(end);
    setEditTranscript(next);
    editTranscriptRef.current = next;
    if (selectedId !== null) scheduleSave(selectedId, editTitle, next);
    requestAnimationFrame(() => {
      const cursor = start + pasted.length;
      ta.selectionStart = ta.selectionEnd = cursor;
    });
  };

  const handleCloseMeeting = async () => {
    await commands.closeMeeting();
    setCaptureActive(false);
    toast.success("Réunion terminée.");
  };

  // ── Styles (exact from mockup CSS) ───────────────────────────────────────
  const s = {
    // Root grid
    root: {
      display: "grid",
      gridTemplateColumns: "360px 1fr",
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
    } as React.CSSProperties,

    // LIST PANE
    list: {
      borderRight: `1px solid ${T.line}`,
      display: "flex",
      flexDirection: "column" as const,
      background: "rgba(255,255,255,0.012)",
      minHeight: 0,
      overflow: "hidden",
    },
    listHead: {
      padding: "22px 22px 14px",
      borderBottom: `1px solid ${T.line}`,
    },
    listTitleRow: {
      display: "flex",
      alignItems: "baseline",
      gap: 10,
      marginBottom: 4,
    },
    listTitle: {
      fontSize: 22,
      fontWeight: 700,
      color: T.txt1,
      letterSpacing: "-0.02em",
    },
    listCount: {
      fontSize: 13,
      color: T.txt3,
      fontWeight: 500,
    },
    listSub: {
      fontSize: 12.5,
      color: T.txt3,
      lineHeight: 1.5,
      marginBottom: 14,
    },
    searchRow: { display: "flex", gap: 8 },
    search: {
      flex: 1,
      height: 34,
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${T.line2}`,
      borderRadius: 8,
      padding: "0 12px 0 34px",
      fontSize: 13,
      color: T.txt2,
      position: "relative" as const,
      display: "flex",
      alignItems: "center",
    },
    searchIcon: {
      position: "absolute" as const,
      left: 12,
      top: "50%",
      transform: "translateY(-50%)",
    },
    searchInput: {
      flex: 1,
      background: "transparent",
      border: "none",
      outline: "none",
      fontSize: 13,
      color: T.txt2,
      fontFamily: "inherit",
    },
    searchKbd: {
      fontSize: 10.5,
      color: T.txt4,
      border: `1px solid ${T.line2}`,
      borderRadius: 4,
      padding: "1px 5px",
      background: "rgba(255,255,255,0.03)",
    },
    btnNew: {
      width: 34,
      height: 34,
      borderRadius: 8,
      background: T.gold,
      color: "#1a1407",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(201,168,76,0.25)",
      flexShrink: 0,
    },
    filters: {
      display: "flex",
      gap: 6,
      padding: "14px 22px 8px",
    },
    listBody: {
      flex: 1,
      overflowY: "auto" as const,
      padding: "8px 12px 16px",
      display: "flex",
      flexDirection: "column" as const,
      gap: 4,
    },
    dayLabel: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.10em",
      textTransform: "uppercase" as const,
      color: T.txt4,
      padding: "14px 10px 8px",
    },

    // DETAIL PANE
    detail: {
      display: "flex",
      flexDirection: "column" as const,
      minWidth: 0,
      minHeight: 0,
      overflow: "hidden",
    },
    detailHead: {
      padding: "18px 28px 16px",
      borderBottom: `1px solid ${T.line}`,
      display: "flex",
      alignItems: "flex-start",
      gap: 18,
    },
    dhFolder: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 9px",
      borderRadius: 5,
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${T.line}`,
      color: T.txt2,
      fontSize: 11.5,
      fontWeight: 500,
    },
    dhTitle: {
      fontSize: 26,
      fontWeight: 700,
      color: T.txt1,
      letterSpacing: "-0.025em",
      lineHeight: 1.2,
      display: "flex",
      alignItems: "center",
      gap: 10,
    },
    dhMeta: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      marginTop: 8,
      fontSize: 12,
      color: T.txt3,
    },
    dhActions: {
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    btnGhost: {
      height: 38,
      minWidth: 38,
      padding: "0 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${T.line2}`,
      borderRadius: 9,
      fontSize: 12.5,
      fontWeight: 500,
      color: T.txt2,
      cursor: "pointer",
    },
    btnRec: {
      height: 38,
      padding: "0 16px 0 14px",
      display: "flex",
      alignItems: "center",
      gap: 9,
      background: T.gold,
      color: "#1a1407",
      border: "none",
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      boxShadow:
        "0 4px 14px rgba(201,168,76,0.25), inset 0 1px 0 rgba(255,255,255,0.18)",
    },
    btnRecLive: {
      background: "rgba(239,68,68,0.12)",
      color: "#f87171",
      boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.4)",
    },
    tabs: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "10px 28px 0",
      borderBottom: `1px solid ${T.line}`,
    },
    body: {
      flex: 1,
      padding: "24px 28px 32px",
      overflowY: "auto" as const,
      overflowX: "hidden" as const,
    },
    summary: {
      border: `1px solid ${T.line}`,
      background:
        "linear-gradient(180deg, rgba(201,168,76,0.04), rgba(201,168,76,0.01))",
      borderRadius: 12,
      padding: "18px 20px",
    },
    summaryBadge: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 9px",
      borderRadius: 999,
      background: T.goldSoft,
      border: `1px solid ${T.goldLine}`,
      fontSize: 11,
      fontWeight: 600,
      color: T.gold,
    },
    summaryText: {
      fontSize: 14,
      lineHeight: 1.65,
      color: T.txt2,
    },
    chapter: {
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      alignItems: "center",
      gap: 14,
      padding: "12px 14px",
      borderRadius: 10,
      border: `1px solid ${T.line}`,
      background: "rgba(255,255,255,0.018)",
      cursor: "pointer",
    },
    ts: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      whiteSpace: "nowrap" as const,
      fontFamily: `"JetBrains Mono", "SF Mono", ui-monospace, monospace`,
      fontSize: 11,
      fontWeight: 600,
      padding: "4px 8px",
      borderRadius: 5,
      background: "rgba(201,168,76,0.10)",
      color: T.gold,
    },
    transcript: {
      border: `1px solid ${T.line}`,
      borderRadius: 12,
      background: "rgba(255,255,255,0.012)",
      padding: 6,
    },
    empty: {
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      flex: 1,
      padding: 48,
      textAlign: "center" as const,
    },
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: "5px 11px",
    borderRadius: 999,
    background: active ? T.goldSoft : "transparent",
    border: `1px solid ${active ? T.goldLine : T.line2}`,
    fontSize: 12,
    color: active ? T.gold : T.txt2,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontFamily: "inherit",
  });

  const itemStyle = (active: boolean): React.CSSProperties => ({
    padding: "12px 12px",
    borderRadius: 9,
    border: `1px solid ${active ? "rgba(201,168,76,0.22)" : "transparent"}`,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    cursor: "pointer",
    background: active ? "rgba(201,168,76,0.06)" : undefined,
    transition: "background .15s, border-color .15s",
  });

  const itemIcoStyle = (active: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: 8,
    background: active ? T.goldSoft : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? T.goldLine : T.line}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: active ? T.gold : T.txt2,
  });

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "0 14px",
    height: 38,
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? T.txt1 : T.txt3,
    cursor: "pointer",
    position: "relative",
    top: 1,
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? T.gold : "transparent"}`,
    fontFamily: "inherit",
    transition: "color .15s, border-color .15s",
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabDef: { id: Tab; label: string; badge?: number; ai?: boolean }[] = [
    { id: "summary", label: "Résumé", ai: true },
    { id: "transcript", label: "Transcription" },
    {
      id: "chapters",
      label: "Chapitres",
      badge: chapters.length,
      ai: chapters.length > 0,
    },
    {
      id: "actions",
      label: "Actions",
      badge: selectedMeeting?.action_items.trim() ? 1 : 0,
      ai: !!selectedMeeting?.action_items.trim(),
    },
  ];

  return (
    <div style={s.root}>
      <style>{`
        .mts-btn-ghost:hover { background: rgba(255,255,255,0.07) !important; border-color: rgba(255,255,255,0.18) !important; }
        .mts-btn-rec:hover { filter: brightness(1.12); box-shadow: 0 6px 18px rgba(201,168,76,0.35), inset 0 1px 0 rgba(255,255,255,0.22) !important; }
        .mts-btn-new:hover { background: #b8962e !important; }
        .mts-btn-icon:hover { background: rgba(255,255,255,0.07) !important; border-color: rgba(255,255,255,0.18) !important; }
        .mts-chip:hover { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; color: rgba(255,255,255,0.72) !important; }
        .mts-chip-active:hover { filter: brightness(1.1); }
        .mts-tab:hover { color: rgba(255,255,255,0.72) !important; }
        .mts-chapter:hover { background: rgba(255,255,255,0.035) !important; border-color: rgba(255,255,255,0.1) !important; }
.mts-menu-item:hover { background: rgba(255,255,255,0.06) !important; }
        .dh-title-edit:hover { opacity: 1 !important; background: rgba(255,255,255,0.06) !important; }
        .mts-pin-btn:hover { background: rgba(255,255,255,0.07) !important; }
        .mts-del-btn:hover { background: rgba(239,68,68,0.12) !important; border-color: rgba(239,68,68,0.3) !important; }
        .mts-regen-btn:hover { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
        button { transition: background .14s, filter .14s, border-color .14s, color .14s, transform .12s, box-shadow .14s; }
      `}</style>

      {/* ═══════════════════════════════════════════════════════ LIST PANE */}
      <section style={s.list}>
        {detectedApp && (
          <div
            style={{
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderBottom: `1px solid ${T.line}`,
              background: "rgba(62,207,110,0.05)",
            }}
          >
            <Video
              size={11}
              style={{ color: "rgba(62,207,110,0.7)", flexShrink: 0 }}
            />
            <span
              style={{
                fontSize: 11,
                color: "rgba(62,207,110,0.8)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {detectedApp}
            </span>
          </div>
        )}

        <div style={s.listHead}>
          <div style={s.listTitleRow}>
            <span style={s.listTitle}>Appels &amp; notes</span>
            <span style={s.listCount}>{visibleMeetings.length}</span>
          </div>
          <p style={s.listSub}>
            Vos appels, réunions et notes vocales — au même endroit pour écrire
            plus vite.
          </p>
          <div style={s.searchRow}>
            <div style={{ ...s.search, position: "relative" }}>
              <span style={s.searchIcon}>
                <IcoSearch size={14} color={T.txt3} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => void handleSearch(e.target.value)}
                placeholder={`Rechercher dans ${meetings.length} enregistrements…`}
                style={s.searchInput}
              />
            </div>
            <div
              style={{ position: "relative", flexShrink: 0 }}
              ref={createMenuRef}
            >
              <button
                className="mts-btn-new"
                style={s.btnNew}
                onClick={() => setShowCreateMenu((v) => !v)}
                title="Nouveau"
              >
                <IcoPlus size={16} color="#1a1407" />
              </button>
              {showCreateMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    zIndex: 99,
                    background: "#18181f",
                    border: `1px solid ${T.line2}`,
                    borderRadius: 10,
                    padding: "4px 0",
                    minWidth: 160,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  }}
                  onMouseLeave={() => setShowCreateMenu(false)}
                >
                  {(
                    [
                      {
                        label: "Réunion",
                        icon: <IcoUsers size={13} color={T.txt2} />,
                      },
                      {
                        label: "Appel",
                        icon: <IcoPhone size={13} color={T.txt2} />,
                      },
                      {
                        label: "Note vocale",
                        icon: <IcoMic size={13} color={T.txt2} />,
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.label}
                      className="mts-menu-item"
                      onClick={() => {
                        setShowCreateMenu(false);
                        void handleCreate(opt.label);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                        padding: "8px 14px",
                        background: "none",
                        border: "none",
                        color: T.txt1,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={s.filters}>
          {(
            [
              {
                id: "all" as const,
                label: "Tout",
                count: meetings.filter((m) => !m.is_archived).length,
              },
              {
                id: "pinned" as const,
                label: "Épinglés",
                count: meetings.filter((m) => m.is_pinned).length,
              },
              { id: "recent" as const, label: "Récents" },
              { id: "archived" as const, label: "Archivés" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              className={listFilter === f.id ? "mts-chip-active" : "mts-chip"}
              style={chipStyle(listFilter === f.id)}
              onClick={() => setListFilter(f.id)}
            >
              {f.label}
              {"count" in f && f.count > 0 && (
                <span style={{ opacity: 0.6, fontWeight: 400 }}>{f.count}</span>
              )}
            </button>
          ))}
        </div>

        <div style={s.listBody}>
          {visibleMeetings.length === 0 && (
            <div
              style={{
                ...s.empty,
                minHeight: 280,
                border: `1px dashed ${T.line}`,
                borderRadius: 12,
                background: "rgba(0,0,0,0.1)",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: `1px solid ${T.line}`,
                  background: "rgba(255,255,255,0.03)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IcoMic size={20} color={T.txt4} />
              </div>
              <p
                style={{
                  fontSize: 12.5,
                  color: T.txt3,
                  maxWidth: 200,
                  lineHeight: 1.7,
                }}
              >
                {searchQuery
                  ? "Aucun résultat pour cette recherche."
                  : "Aucune réunion.\nAppuyez sur + pour commencer."}
              </p>
            </div>
          )}

          {groups.map((g) => (
            <React.Fragment key={g.label}>
              <div style={s.dayLabel}>{g.label}</div>
              {g.items.map((m) => {
                const isOn = selectedId === m.id;
                const isHov = hoveredId === m.id && !isOn;
                const dur = durationLabel(m);
                const tag = itemTag(m.category);
                return (
                  <div
                    key={m.id}
                    style={{
                      ...itemStyle(isOn),
                      background: isOn
                        ? "rgba(201,168,76,0.06)"
                        : isHov
                          ? "rgba(255,255,255,0.025)"
                          : undefined,
                      opacity: m.is_archived ? 0.65 : 1,
                    }}
                    onClick={() => setSelectedId(m.id)}
                    onMouseEnter={() => setHoveredId(m.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <div style={itemIcoStyle(isOn)}>
                      {isOn ? (
                        <ItemIcon category={m.category} />
                      ) : (
                        <span style={{ color: T.txt2 }}>
                          <ItemIcon category={m.category} />
                        </span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: T.txt1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                        >
                          {meetingTitle(m)}
                        </span>
                        {m.is_pinned && <IcoPinFill size={12} color={T.gold} />}
                        {captureActive && isOn && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              padding: "1px 6px",
                              borderRadius: 4,
                              background: "rgba(239,68,68,0.12)",
                              color: "#f87171",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            ● Live
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: T.txt2,
                          lineHeight: 1.45,
                          marginBottom: 6,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 1,
                          WebkitBoxOrient: "vertical" as const,
                        }}
                      >
                        {meetingPreview(m)}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 11,
                          color: T.txt3,
                        }}
                      >
                        <span>{fmt(m.updated_at)}</span>
                        {dur && (
                          <>
                            <span
                              style={{
                                width: 2,
                                height: 2,
                                borderRadius: "50%",
                                background: T.txt4,
                              }}
                            />
                            <span>{dur}</span>
                          </>
                        )}
                        <span
                          style={{
                            width: 2,
                            height: 2,
                            borderRadius: "50%",
                            background: T.txt4,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(255,255,255,0.05)",
                            color: T.txt2,
                          }}
                        >
                          {tag}
                        </span>
                      </div>
                    </div>
                    {/* row actions on hover */}
                    {(isOn || isHov) && (
                      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                        <button
                          className="mts-pin-btn"
                          onClick={(e) => void handleTogglePin(m, e)}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            border: `1px solid ${m.is_pinned ? T.goldLine : T.line2}`,
                            background: m.is_pinned
                              ? T.goldSoft
                              : "rgba(255,255,255,0.03)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          <Pin
                            size={11}
                            color={m.is_pinned ? T.gold : T.txt3}
                          />
                        </button>
                        <button
                          className="mts-del-btn"
                          onClick={(e) => void handleDelete(m.id, e)}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 6,
                            border: `1px solid ${T.line2}`,
                            background: "rgba(255,255,255,0.03)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          <IcoTrash size={11} color={T.txt3} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════ DETAIL PANE */}
      <section style={s.detail}>
        {selectedMeeting === null ? (
          <div style={{ ...s.empty, flex: 1 }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                border: `1px solid ${T.line}`,
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <IcoMic size={30} color={T.txt4} />
            </div>
            <p
              style={{
                maxWidth: 440,
                fontSize: 15,
                lineHeight: 2,
                color: T.txt3,
              }}
            >
              Sélectionnez une réunion ou démarrez un enregistrement pour en
              créer une
            </p>
            <button
              className="mts-btn-rec"
              onClick={() => void handleToggleCapture()}
              style={{ ...s.btnRec, height: 36, fontSize: 12.5 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#1a1407",
                }}
              />
              Démarrer une réunion
            </button>
          </div>
        ) : (
          <>
            {/* ── Detail header ── */}
            <div style={s.detailHead}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11,
                    color: T.txt3,
                    marginBottom: 6,
                  }}
                >
                  <span style={s.dhFolder}>
                    <IcoFolder size={11} color={T.txt2} />
                    {editCategory.trim() || "Réunions"}
                  </span>
                </div>
                <h2 style={s.dhTitle}>
                  {titleEditing ? (
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={editTitle}
                      placeholder="Titre de la réunion"
                      onChange={(e) => handleTitleChange(e.target.value)}
                      onBlur={() => setTitleEditing(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape")
                          setTitleEditing(false);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        fontSize: 26,
                        fontWeight: 700,
                        color: T.txt1,
                        letterSpacing: "-0.025em",
                        fontFamily: "inherit",
                        width: "100%",
                      }}
                    />
                  ) : (
                    <>
                      {editTitle || meetingTitle(selectedMeeting)}
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: T.txt3,
                          cursor: "pointer",
                          opacity: 0,
                          transition: "opacity .15s",
                        }}
                        className="dh-title-edit"
                        onClick={() => {
                          setTitleEditing(true);
                          setTimeout(() => titleInputRef.current?.focus(), 50);
                        }}
                      >
                        <IcoEdit size={14} color={T.txt3} />
                      </span>
                    </>
                  )}
                </h2>
                <div style={s.dhMeta}>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <IcoCal size={13} color={T.txt3} />
                    {fmt(selectedMeeting.updated_at)}
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <IcoClock size={13} color={T.txt3} />
                    {durationLabel(selectedMeeting) || "—"}
                    {selectedMeeting.segments.length > 0 &&
                      ` · ${selectedMeeting.segments.length} segments`}
                  </span>
                  {saving && (
                    <span style={{ color: T.gold, fontSize: 11 }}>
                      Enregistrement…
                    </span>
                  )}
                </div>
              </div>
              <div style={s.dhActions}>
                <div style={{ position: "relative" }}>
                  <button
                    className="mts-btn-ghost"
                    style={s.btnGhost}
                    onClick={() => {
                      setShowMoreMenu(false);
                      setShowShareMenu((v) => !v);
                    }}
                  >
                    <IcoShare size={14} color={T.txt2} />
                    Partager
                  </button>
                  {showShareMenu && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 99,
                        background: "#18181f",
                        border: `1px solid ${T.line2}`,
                        borderRadius: 10,
                        padding: "4px 0",
                        minWidth: 200,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      }}
                      onMouseLeave={() => setShowShareMenu(false)}
                    >
                      {[
                        {
                          label: "Copier la transcription",
                          fn: () => {
                            setShowShareMenu(false);
                            void handleCopyTranscript();
                          },
                        },
                        {
                          label: "Copier le résumé",
                          fn: () => {
                            setShowShareMenu(false);
                            void handleCopySummary();
                          },
                        },
                        {
                          label: "Exporter en fichier…",
                          fn: () => {
                            setShowShareMenu(false);
                            void handleExport();
                          },
                        },
                      ].map((item) => (
                        <button
                          key={item.label}
                          className="mts-menu-item"
                          onClick={item.fn}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            textAlign: "left",
                            padding: "8px 14px",
                            background: "none",
                            border: "none",
                            color: T.txt1,
                            fontSize: 13,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ position: "relative" }} ref={moreMenuRef}>
                  <button
                    className="mts-btn-ghost"
                    style={{ ...s.btnGhost, padding: 0, width: 38 }}
                    title="Plus d'options"
                    onClick={() => {
                      setShowShareMenu(false);
                      setShowMoreMenu((v) => !v);
                    }}
                  >
                    <IcoDots size={15} color={T.txt2} />
                  </button>
                  {showMoreMenu && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        right: 0,
                        zIndex: 99,
                        background: "#18181f",
                        border: `1px solid ${T.line2}`,
                        borderRadius: 10,
                        padding: "4px 0",
                        minWidth: 180,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      }}
                      onMouseLeave={() => setShowMoreMenu(false)}
                    >
                      {[
                        {
                          label: "Générer le titre",
                          fn: () => {
                            setShowMoreMenu(false);
                            void handleGenTitle();
                          },
                        },
                        {
                          label: "Importer audio",
                          fn: () => {
                            setShowMoreMenu(false);
                            void handleImportAudio();
                          },
                        },
                        {
                          label: "Exporter",
                          fn: () => {
                            setShowMoreMenu(false);
                            void handleExport();
                          },
                        },
                        {
                          label: "Dupliquer",
                          fn: () => {
                            setShowMoreMenu(false);
                            if (selectedMeeting)
                              void handleDuplicate(
                                selectedMeeting,
                                new MouseEvent(
                                  "click",
                                ) as unknown as React.MouseEvent,
                              );
                          },
                        },
                        {
                          label: selectedMeeting?.is_archived
                            ? "Désarchiver"
                            : "Archiver",
                          fn: () => {
                            setShowMoreMenu(false);
                            if (selectedMeeting)
                              void handleToggleArchive(
                                selectedMeeting,
                                new MouseEvent(
                                  "click",
                                ) as unknown as React.MouseEvent,
                              );
                          },
                        },
                        ...(captureActive
                          ? [
                              {
                                label: "Terminer la réunion",
                                fn: () => {
                                  setShowMoreMenu(false);
                                  void handleCloseMeeting();
                                },
                              },
                            ]
                          : []),
                      ].map((item) => (
                        <button
                          key={item.label}
                          className="mts-menu-item"
                          onClick={item.fn}
                          style={{
                            width: "100%",
                            display: "block",
                            textAlign: "left",
                            padding: "8px 14px",
                            background: "none",
                            border: "none",
                            color: T.txt1,
                            fontSize: 13,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="mts-btn-rec"
                  style={
                    captureActive ? { ...s.btnRec, ...s.btnRecLive } : s.btnRec
                  }
                  onClick={() => void handleToggleCapture()}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: captureActive ? T.rec : "#1a1407",
                      animation: captureActive
                        ? "pulse 1.4s ease-in-out infinite"
                        : "none",
                    }}
                  />
                  {captureActive ? "Arrêter" : "Démarrer une réunion"}
                </button>
              </div>
            </div>

            {/* ── Tabs ── */}
            <div style={s.tabs}>
              {tabDef.map((tab) => (
                <button
                  key={tab.id}
                  className="mts-tab"
                  style={tabStyle(activeTab === tab.id)}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.ai && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: T.gold,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {tab.label}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background:
                          activeTab === tab.id
                            ? T.goldSoft
                            : "rgba(255,255,255,0.06)",
                        color: activeTab === tab.id ? T.gold : T.txt2,
                        minWidth: 18,
                        textAlign: "center",
                      }}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Body ── */}
            <div style={s.body}>
              {/* ── Résumé tab ── */}
              {activeTab === "summary" && (
                <>
                  <div style={s.summary}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <span style={s.summaryBadge}>
                        <IcoSparkle size={11} color={T.gold} />
                        {selectedMeeting.summary.trim()
                          ? "Résumé IA"
                          : "Aucun résumé"}
                      </span>
                      <span style={{ marginLeft: "auto" }}>
                        <button
                          onClick={() => void handleSummarize()}
                          className="mts-regen-btn"
                          style={{
                            height: 26,
                            padding: "0 9px",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "transparent",
                            border: `1px solid ${T.line2}`,
                            borderRadius: 7,
                            fontSize: 11.5,
                            color: T.txt2,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <IcoRefresh size={11} color={T.txt2} />
                          {selectedMeeting.summary.trim()
                            ? "Régénérer"
                            : "Générer"}
                        </button>
                      </span>
                    </div>
                    {selectedMeeting.summary.trim() ? (
                      <p style={s.summaryText}>{selectedMeeting.summary}</p>
                    ) : (
                      <p
                        style={{
                          ...s.summaryText,
                          color: T.txt4,
                          fontStyle: "italic",
                        }}
                      >
                        Cliquez sur "Générer" pour créer un résumé IA de cette
                        réunion.
                      </p>
                    )}
                  </div>

                  {/* Key moments / chapters */}
                  {chapters.length > 0 && (
                    <div style={{ marginTop: 26 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 10,
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.10em",
                            textTransform: "uppercase",
                            color: T.txt3,
                          }}
                        >
                          Moments clés
                        </span>
                        <span style={{ fontSize: 12, color: T.txt4 }}>
                          {chapters.length} repères · cliquer pour écouter
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {chapters.map((ch, i) => (
                          <div
                            key={ch.id}
                            className="mts-chapter"
                            style={s.chapter}
                            onClick={() => jumpToChapter(ch)}
                          >
                            <span style={s.ts}>{fmtClock(ch.startMs)}</span>
                            <div>
                              <div
                                style={{
                                  fontSize: 13.5,
                                  fontWeight: 600,
                                  color: T.txt1,
                                }}
                              >
                                {aiChapterTitles[i] || ch.label}
                              </div>
                            </div>
                            <IcoChevron size={14} color={T.txt4} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Transcription tab ── */}
              {activeTab === "transcript" && (
                <div style={s.transcript}>
                  <textarea
                    ref={transcriptRef}
                    placeholder="La transcription apparaîtra ici pendant que vous parlez…"
                    value={editTranscript}
                    onChange={(e) => handleTranscriptChange(e.target.value)}
                    onPaste={handleTranscriptPaste}
                    onFocus={() => {
                      transcriptWasFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      if (document.activeElement !== transcriptRef.current)
                        transcriptWasFocusedRef.current = false;
                    }}
                    style={{
                      width: "100%",
                      minHeight: 400,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      padding: "12px 14px",
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: T.txt1,
                      fontFamily: "inherit",
                      resize: "none",
                    }}
                  />
                </div>
              )}

              {/* ── Chapitres tab ── */}
              {activeTab === "chapters" && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.10em",
                        textTransform: "uppercase",
                        color: T.txt3,
                      }}
                    >
                      {chapters.length} repère{chapters.length !== 1 ? "s" : ""}{" "}
                      temporel{chapters.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => void handleGenChapterTitles()}
                      style={{
                        height: 26,
                        padding: "0 9px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: T.goldSoft,
                        border: `1px solid ${T.goldLine}`,
                        borderRadius: 7,
                        fontSize: 11.5,
                        color: T.gold,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <IcoSparkle size={11} color={T.gold} />
                      Titres IA
                    </button>
                  </div>
                  {chapters.length === 0 ? (
                    <p
                      style={{
                        fontSize: 12.5,
                        color: T.txt4,
                        padding: "32px 0",
                        textAlign: "center",
                      }}
                    >
                      Aucun chapitre — ajoutez de la transcription d'abord.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {chapters.map((ch, i) => (
                        <div
                          key={ch.id}
                          style={s.chapter}
                          onClick={() => jumpToChapter(ch)}
                        >
                          <span style={s.ts}>{fmtClock(ch.startMs)}</span>
                          <div>
                            <div
                              style={{
                                fontSize: 13.5,
                                fontWeight: 600,
                                color: T.txt1,
                              }}
                            >
                              {aiChapterTitles[i] || ch.label}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: T.txt3,
                                marginTop: 2,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {ch.preview}
                            </div>
                          </div>
                          <IcoChevron size={14} color={T.txt4} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Actions tab ── */}
              {activeTab === "actions" && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.10em",
                        textTransform: "uppercase",
                        color: T.txt3,
                      }}
                    >
                      Actions
                    </span>
                    <button
                      onClick={() => void handleExtractActions()}
                      style={{
                        height: 26,
                        padding: "0 9px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: T.goldSoft,
                        border: `1px solid ${T.goldLine}`,
                        borderRadius: 7,
                        fontSize: 11.5,
                        color: T.gold,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <IcoSparkle size={11} color={T.gold} />
                      {selectedMeeting.action_items.trim()
                        ? "Ré-extraire"
                        : "Extraire les actions"}
                    </button>
                  </div>
                  {selectedMeeting.action_items.trim() ? (
                    <div
                      style={{
                        border: `1px solid ${T.line}`,
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.012)",
                        padding: "16px 18px",
                      }}
                    >
                      <p
                        style={{
                          fontSize: 14,
                          lineHeight: 1.65,
                          color: T.txt2,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {selectedMeeting.action_items}
                      </p>
                    </div>
                  ) : (
                    <p
                      style={{
                        fontSize: 12.5,
                        color: T.txt4,
                        padding: "32px 0",
                        textAlign: "center",
                      }}
                    >
                      Aucune action extraite. Cliquez sur "Extraire les
                      actions".
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* CSS for animations */}
      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .dh-title-edit { opacity: 0 !important; }
        h2:hover .dh-title-edit { opacity: 1 !important; }
      `}</style>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Mic, Plus, Search, Trash2, Video } from "lucide-react";
import { commands, type MeetingEntry } from "@/bindings";

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

function meetingTitle(m: MeetingEntry): string {
  if (m.title && m.title.trim()) return m.title;
  return "Meeting";
}

export const MeetingsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<MeetingEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editTranscript, setEditTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const [detectedApp, setDetectedApp] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMeetings = useCallback(async () => {
    const res = await commands.getMeetings();
    if (res.status === "ok") setMeetings(res.data);
  }, []);

  useEffect(() => {
    loadMeetings();
    commands.detectActiveMeetingApp().then((res) => {
      setDetectedApp(res);
    });
  }, [loadMeetings]);

  // Real-time segment append via event
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unlisten: any[] = [];
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ id: number; text: string }>("meeting-segment-added", (event) => {
        const { id, text } = event.payload;
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  transcript: m.transcript + text,
                  updated_at: Date.now(),
                }
              : m,
          ),
        );
        if (selectedId === id) {
          setEditTranscript((prev) => prev + text);
        }
        loadMeetings();
      }).then((u) => unlisten.push(u));

      listen<MeetingEntry>("meeting-created", () => {
        loadMeetings();
      }).then((u) => unlisten.push(u));
    });
    return () => {
      unlisten.forEach((u) => u());
    };
  }, [selectedId, loadMeetings]);

  const selectedMeeting = meetings.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedMeeting) {
      setEditTitle(selectedMeeting.title);
      setEditTranscript(selectedMeeting.transcript);
    }
  }, [selectedId]); // only re-run when selectedId changes

  const handleCreate = async () => {
    const app = detectedApp ?? "";
    const res = await commands.createMeeting("", app);
    if (res.status === "ok") {
      setMeetings((prev) => [res.data, ...prev]);
      setSelectedId(res.data.id);
      setEditTitle("");
      setEditTranscript("");
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await commands.deleteMeeting(id);
    if (res.status === "ok") {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
    } else {
      toast.error(res.error);
    }
  };

  const handleCloseMeeting = async () => {
    await commands.closeMeeting();
    toast.success(
      t("meetings.closed", {
        defaultValue: "Meeting closed — next recording starts a new one",
      }),
    );
  };

  const scheduleSave = useCallback(
    (id: number, title: string, transcript: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        const res = await commands.updateMeeting(id, title, transcript);
        if (res.status === "ok") {
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

  const handleTitleChange = (v: string) => {
    setEditTitle(v);
    if (selectedId !== null) scheduleSave(selectedId, v, editTranscript);
  };

  const handleTranscriptChange = (v: string) => {
    setEditTranscript(v);
    if (selectedId !== null) scheduleSave(selectedId, editTitle, v);
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      loadMeetings();
      return;
    }
    const res = await commands.searchMeetings(q);
    if (res.status === "ok") setMeetings(res.data);
  };

  return (
    <div className="flex h-full overflow-hidden" style={{ minHeight: 0 }}>
      {/* Sidebar */}
      <div
        className="flex w-56 flex-shrink-0 flex-col border-r border-white/8"
        style={{ minHeight: 0 }}
      >
        {/* Detected app badge */}
        {detectedApp && (
          <div className="flex items-center gap-1.5 border-b border-white/8 px-3 py-1.5">
            <Video size={11} className="text-green-400/70" />
            <span className="text-[11px] text-green-400/80">{detectedApp}</span>
          </div>
        )}

        {/* Search + New */}
        <div className="flex items-center gap-1.5 border-b border-white/8 p-2">
          <div className="relative flex-1">
            <Search
              size={12}
              className="absolute top-1/2 left-2 -translate-y-1/2 text-white/30"
            />
            <input
              type="text"
              placeholder={t("meetings.search", { defaultValue: "Search…" })}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full rounded bg-white/5 py-1 pr-2 pl-7 text-[12px] text-white/70 placeholder-white/25 outline-none focus:ring-1 focus:ring-white/15"
            />
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center justify-center rounded p-1 text-white/40 transition-colors hover:bg-white/8 hover:text-white/70"
            title={t("meetings.new", { defaultValue: "New meeting" })}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Meeting list */}
        <div className="flex-1 overflow-y-auto">
          {meetings.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 pt-8 text-center text-[12px] text-white/25">
              <Mic size={24} className="opacity-40" />
              <p>
                {t("meetings.empty", {
                  defaultValue:
                    "No meetings yet.\nPress your meeting key to start.",
                })}
              </p>
            </div>
          )}
          {meetings.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className={`group flex cursor-pointer items-start justify-between gap-1 px-3 py-2 transition-colors ${
                selectedId === m.id
                  ? "bg-white/8 text-white/90"
                  : "text-white/55 hover:bg-white/5 hover:text-white/75"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">
                  {meetingTitle(m)}
                </p>
                <div className="flex items-center gap-1.5">
                  {m.app_name && (
                    <span className="truncate text-[10px] text-white/25">
                      {m.app_name}
                    </span>
                  )}
                  <span className="truncate text-[10px] text-white/20">
                    {formatDate(m.updated_at)}
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(m.id, e)}
                className="mt-0.5 flex-shrink-0 rounded p-0.5 text-white/0 transition-colors hover:text-white/50 group-hover:text-white/20"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ minHeight: 0 }}
      >
        {selectedMeeting === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/20">
            <Mic size={32} className="opacity-40" />
            <p className="text-[13px]">
              {t("meetings.selectOrCreate", {
                defaultValue:
                  "Select a meeting or press your meeting key to start recording",
              })}
            </p>
          </div>
        ) : (
          <>
            {/* Title + close button */}
            <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder={t("meetings.titlePlaceholder", {
                    defaultValue: "Meeting title",
                  })}
                  value={editTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full bg-transparent text-[15px] font-semibold text-white/85 placeholder-white/20 outline-none"
                />
                <p className="mt-0.5 text-[10px] text-white/25">
                  {saving
                    ? t("meetings.saving", { defaultValue: "Saving…" })
                    : formatDate(selectedMeeting.updated_at)}
                </p>
              </div>
              <button
                onClick={handleCloseMeeting}
                className="rounded px-2 py-1 text-[11px] text-white/35 transition-colors hover:bg-white/8 hover:text-white/60"
                title={t("meetings.closeTitle", {
                  defaultValue: "End meeting — next recording starts a new one",
                })}
              >
                {t("meetings.close", { defaultValue: "End" })}
              </button>
            </div>
            {/* Transcript */}
            <textarea
              placeholder={t("meetings.transcriptPlaceholder", {
                defaultValue: "Transcript will appear here as you speak…",
              })}
              value={editTranscript}
              onChange={(e) => handleTranscriptChange(e.target.value)}
              className="flex-1 resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-white/75 placeholder-white/20 outline-none"
              style={{ fontFamily: "inherit" }}
            />
          </>
        )}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Mic, Plus, Search, Trash2, Video } from "lucide-react";
import { commands, type MeetingEntry } from "@/bindings";
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

function meetingTitle(meeting: MeetingEntry): string {
  if (meeting.title && meeting.title.trim()) return meeting.title;
  return "Reunion";
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
    void loadMeetings();
    commands.detectActiveMeetingApp().then((res) => {
      setDetectedApp(res);
    });
  }, [loadMeetings]);

  useEffect(() => {
    const unlisten: Array<() => void> = [];

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ id: number; text: string }>("meeting-segment-added", (event) => {
        const { id, text } = event.payload;
        setMeetings((prev) =>
          prev.map((meeting) =>
            meeting.id === id
              ? {
                  ...meeting,
                  transcript: meeting.transcript + text,
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

  useEffect(() => {
    if (selectedMeeting) {
      setEditTitle(selectedMeeting.title);
      setEditTranscript(selectedMeeting.transcript);
    }
  }, [selectedId, selectedMeeting]);

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
      setMeetings((prev) => prev.filter((meeting) => meeting.id !== id));
      if (selectedId === id) setSelectedId(null);
    } else {
      toast.error(res.error);
    }
  };

  const handleCloseMeeting = async () => {
    await commands.closeMeeting();
    toast.success(
      t("meetings.closed", {
        defaultValue:
          "Reunion terminee - le prochain enregistrement creera une nouvelle reunion",
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
    setEditTranscript(value);
    if (selectedId !== null) scheduleSave(selectedId, editTitle, value);
  };

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

        <div className="flex-1 overflow-y-auto p-3">
          {meetings.length === 0 && (
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
            </div>
          )}

          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              onClick={() => setSelectedId(meeting.id)}
              style={{ padding: "14px 16px" }}
              className={`group mb-1 flex cursor-pointer items-start justify-between gap-3 rounded-[14px] border transition-colors ${
                selectedId === meeting.id
                  ? "border-logo-primary/30 bg-logo-primary/[0.08] text-white/92"
                  : "border-transparent text-white/55 hover:border-white/6 hover:bg-white/[0.045] hover:text-white/78"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">
                  {meetingTitle(meeting)}
                </p>
                <div className="flex items-center gap-2">
                  {meeting.app_name && (
                    <span className="truncate text-[10px] text-white/28">
                      {meeting.app_name}
                    </span>
                  )}
                  <span className="truncate text-[10px] text-white/20">
                    {formatDate(meeting.updated_at)}
                  </span>
                </div>
              </div>
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
                    : formatDate(selectedMeeting.updated_at)}
                </p>
              </div>
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

            <textarea
              placeholder={t("meetings.transcriptPlaceholder", {
                defaultValue:
                  "La transcription apparaitra ici pendant que vous parlez...",
              })}
              value={editTranscript}
              onChange={(e) => handleTranscriptChange(e.target.value)}
              style={{ padding: "18px 20px", fontFamily: "inherit" }}
              className="flex-1 resize-none bg-transparent text-[13px] leading-7 text-white/78 placeholder-white/20 outline-none"
            />
          </>
        )}
      </div>
    </div>
  );
};

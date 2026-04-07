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
  return "Réunion";
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

  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedId) ?? null;

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
        defaultValue: "Réunion terminée — le prochain enregistrement créera une nouvelle réunion",
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
    <div className="flex h-full overflow-hidden" style={{ minHeight: 0 }}>
      <div
        className="flex w-60 flex-shrink-0 flex-col border-r border-white/8 bg-white/[0.015]"
        style={{ minHeight: 0 }}
      >
        {detectedApp && (
          <div
            style={{ padding: "10px 14px" }}
            className="flex items-center gap-2 border-b border-white/8 bg-emerald-500/[0.05]"
          >
            <Video size={12} className="text-emerald-400/70" />
            <span className="truncate text-[11px] text-emerald-300/80">
              {detectedApp}
            </span>
          </div>
        )}

        <div
          style={{ padding: "12px 14px" }}
          className="flex items-center gap-2 border-b border-white/8"
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
              style={{ padding: "10px 10px 10px 34px" }}
              className="w-full rounded-[10px] border border-white/8 bg-white/[0.04] text-[12px] text-white/76 placeholder-white/25 outline-none transition-all focus:border-white/14 focus:bg-white/[0.06]"
            />
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            variant="secondary"
            size="sm"
            className="shrink-0 px-3"
            title={t("meetings.new", { defaultValue: "Nouvelle réunion" })}
          >
            <Plus size={14} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {meetings.length === 0 && (
            <div
              style={{ padding: "32px 16px 16px" }}
              className="flex flex-col items-center gap-2 text-center text-[12px] text-white/25"
            >
              <Mic size={24} className="opacity-40" />
              <p>
                {t("meetings.empty", {
                  defaultValue:
                    "Aucune réunion pour l'instant.\nAppuyez sur votre touche réunion pour commencer.",
                })}
              </p>
            </div>
          )}

          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              onClick={() => setSelectedId(meeting.id)}
              style={{ padding: "12px 16px" }}
              className={`group flex cursor-pointer items-start justify-between gap-1 transition-colors ${
                selectedId === meeting.id
                  ? "bg-white/[0.08] text-white/92"
                  : "text-white/55 hover:bg-white/[0.045] hover:text-white/78"
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
                className="mt-0.5 flex-shrink-0 rounded-md p-1 text-white/0 transition-colors hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/24"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0 }}>
        {selectedMeeting === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/20">
            <Mic size={32} className="opacity-40" />
            <p className="text-[13px]">
              {t("meetings.selectOrCreate", {
                defaultValue:
                  "Sélectionnez une réunion ou démarrez un enregistrement pour en créer une",
              })}
            </p>
          </div>
        ) : (
          <>
            <div
              style={{ padding: "14px 18px 12px" }}
              className="flex items-center gap-3 border-b border-white/8 bg-white/[0.015]"
            >
              <div className="flex-1">
                <input
                  type="text"
                  placeholder={t("meetings.titlePlaceholder", {
                    defaultValue: "Titre de la réunion",
                  })}
                  value={editTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full bg-transparent text-[16px] font-semibold text-white/88 placeholder-white/20 outline-none"
                />
                <p className="mt-0.5 text-[10px] text-white/25">
                  {saving
                    ? t("meetings.saving", { defaultValue: "Enregistrement..." })
                    : formatDate(selectedMeeting.updated_at)}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void handleCloseMeeting()}
                variant="secondary"
                size="sm"
                title={t("meetings.closeTitle", {
                  defaultValue:
                    "Terminer la réunion — le prochain enregistrement créera une nouvelle réunion",
                })}
              >
                {t("meetings.close", { defaultValue: "Terminer" })}
              </Button>
            </div>

            <textarea
              placeholder={t("meetings.transcriptPlaceholder", {
                defaultValue: "La transcription apparaîtra ici pendant que vous parlez...",
              })}
              value={editTranscript}
              onChange={(e) => handleTranscriptChange(e.target.value)}
              style={{ padding: "16px 18px", fontFamily: "inherit" }}
              className="flex-1 resize-none bg-transparent text-[13px] leading-7 text-white/78 placeholder-white/20 outline-none"
            />
          </>
        )}
      </div>
    </div>
  );
};

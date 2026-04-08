import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileText, Plus, Search, Trash2 } from "lucide-react";
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

export const NotesSettings: React.FC = () => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNotes = useCallback(async () => {
    const res = await commands.getNotes();
    if (res.status === "ok") setNotes(res.data);
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedNote) {
      setEditTitle(selectedNote.title);
      setEditContent(selectedNote.content);
    }
  }, [selectedId, selectedNote]);

  const handleCreate = async () => {
    const res = await commands.createNote("", "");
    if (res.status === "ok") {
      setNotes((prev) => [res.data, ...prev]);
      setSelectedId(res.data.id);
      setEditTitle("");
      setEditContent("");
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

        <div className="flex-1 overflow-y-auto p-3">
          {notes.length === 0 && (
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
            </div>
          )}

          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setSelectedId(note.id)}
              style={{ padding: "14px 16px" }}
              className={`group mb-1 flex cursor-pointer items-start justify-between gap-3 rounded-[14px] border transition-colors ${
                selectedId === note.id
                  ? "border-logo-primary/30 bg-logo-primary/[0.08] text-white/92"
                  : "border-transparent text-white/55 hover:border-white/6 hover:bg-white/[0.045] hover:text-white/78"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">
                  {noteTitle(note)}
                </p>
                <p className="truncate text-[10px] text-white/30">
                  {formatNoteDate(note.updated_at)}
                </p>
              </div>
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
                  : formatNoteDate(selectedNote.updated_at)}
              </p>
            </div>

            <textarea
              placeholder={t("notes.contentPlaceholder", {
                defaultValue: "Commencez a ecrire...",
              })}
              value={editContent}
              onChange={(e) => handleContentChange(e.target.value)}
              style={{ padding: "18px 20px", fontFamily: "inherit" }}
              className="flex-1 resize-none bg-transparent text-[13px] leading-7 text-white/78 placeholder-white/20 outline-none"
            />
          </>
        )}
      </div>
    </div>
  );
};

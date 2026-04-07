import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, Search, FileText } from "lucide-react";
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

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

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
      setNotes((prev) => prev.filter((n) => n.id !== id));
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
            prev.map((n) =>
              n.id === id
                ? { ...n, title, content, updated_at: Date.now() }
                : n,
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
    <div className="flex h-full overflow-hidden" style={{ minHeight: 0 }}>
      <div
        className="flex w-60 flex-shrink-0 flex-col border-r border-white/8 bg-white/[0.015]"
        style={{ minHeight: 0 }}
      >
        <div
          className="flex items-center gap-2 border-b border-white/8"
          style={{ padding: "12px 14px" }}
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
            title={t("notes.new", { defaultValue: "Nouvelle note" })}
          >
            <Plus size={14} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes.length === 0 && (
            <div
              className="flex flex-col items-center gap-2 text-center text-[12px] text-white/25"
              style={{ padding: "32px 16px 16px" }}
            >
              <FileText size={24} className="opacity-40" />
              <p>
                {t("notes.empty", {
                  defaultValue:
                    "Aucune note pour l'instant.\nCliquez sur + pour en créer une.",
                })}
              </p>
            </div>
          )}

          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setSelectedId(note.id)}
              style={{ padding: "12px 16px" }}
              className={`group flex cursor-pointer items-start justify-between gap-1 transition-colors ${
                selectedId === note.id
                  ? "bg-white/[0.08] text-white/92"
                  : "text-white/55 hover:bg-white/[0.045] hover:text-white/78"
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
                className="mt-0.5 flex-shrink-0 rounded-md p-1 text-white/0 transition-colors hover:bg-white/[0.06] hover:text-white/60 group-hover:text-white/24"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0 }}>
        {selectedNote === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/20">
            <FileText size={32} className="opacity-40" />
            <p className="text-[13px]">
              {t("notes.selectOrCreate", {
                defaultValue: "Sélectionnez une note ou créez-en une nouvelle",
              })}
            </p>
          </div>
        ) : (
          <>
            <div
              className="border-b border-white/8 bg-white/[0.015]"
              style={{ padding: "14px 18px 12px" }}
            >
              <input
                type="text"
                placeholder={t("notes.titlePlaceholder", {
                  defaultValue: "Titre",
                })}
                value={editTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full bg-transparent text-[16px] font-semibold text-white/88 placeholder-white/20 outline-none"
              />
              <p className="mt-0.5 text-[10px] text-white/25">
                {saving
                  ? t("notes.saving", { defaultValue: "Enregistrement..." })
                  : formatNoteDate(selectedNote.updated_at)}
              </p>
            </div>

            <textarea
              placeholder={t("notes.contentPlaceholder", {
                defaultValue: "Commencez à écrire...",
              })}
              value={editContent}
              onChange={(e) => handleContentChange(e.target.value)}
              style={{ padding: "16px 18px", fontFamily: "inherit" }}
              className="flex-1 resize-none bg-transparent text-[13px] leading-7 text-white/78 placeholder-white/20 outline-none"
            />
          </>
        )}
      </div>
    </div>
  );
};

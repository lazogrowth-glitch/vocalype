import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, Search, FileText } from "lucide-react";
import { commands, type NoteEntry } from "@/bindings";

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

const UNTITLED = "Untitled";

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
    loadNotes();
  }, [loadNotes]);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  // When selection changes, populate editor
  useEffect(() => {
    if (selectedNote) {
      setEditTitle(selectedNote.title);
      setEditContent(selectedNote.content);
    }
  }, [selectedId]); // only re-run when selectedId changes

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

  const handleTitleChange = (v: string) => {
    setEditTitle(v);
    if (selectedId !== null) scheduleSave(selectedId, v, editContent);
  };

  const handleContentChange = (v: string) => {
    setEditContent(v);
    if (selectedId !== null) scheduleSave(selectedId, editTitle, v);
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      loadNotes();
      return;
    }
    const res = await commands.searchNotes(q);
    if (res.status === "ok") setNotes(res.data);
  };

  const visibleNotes = notes;

  return (
    <div className="flex h-full overflow-hidden" style={{ minHeight: 0 }}>
      {/* Sidebar */}
      <div
        className="flex w-56 flex-shrink-0 flex-col border-r border-white/8"
        style={{ minHeight: 0 }}
      >
        {/* Search + New */}
        <div
          className="flex items-center gap-1.5 border-b border-white/8"
          style={{ padding: "8px 12px" }}
        >
          <div className="relative flex-1">
            <Search
              size={12}
              className="absolute top-1/2 left-2 -translate-y-1/2 text-white/30"
            />
            <input
              type="text"
              placeholder={t("notes.search", { defaultValue: "Search…" })}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              style={{ padding: "8px 8px 8px 28px" }}
              className="w-full rounded bg-white/5 text-[12px] text-white/70 placeholder-white/25 outline-none focus:ring-1 focus:ring-white/15"
            />
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center justify-center rounded p-1 text-white/40 transition-colors hover:bg-white/8 hover:text-white/70"
            title={t("notes.new", { defaultValue: "New note" })}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {visibleNotes.length === 0 && (
            <div
              className="flex flex-col items-center gap-2 text-center text-[12px] text-white/25"
              style={{ padding: "32px 16px 16px" }}
            >
              <FileText size={24} className="opacity-40" />
              <p>
                {t("notes.empty", {
                  defaultValue: "No notes yet.\nClick + to create one.",
                })}
              </p>
            </div>
          )}
          {visibleNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => setSelectedId(note.id)}
              style={{ padding: "10px 16px" }}
              className={`group flex cursor-pointer items-start justify-between gap-1 transition-colors ${
                selectedId === note.id
                  ? "bg-white/8 text-white/90"
                  : "text-white/55 hover:bg-white/5 hover:text-white/75"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">
                  {noteTitle(note)}
                </p>
                <p className="truncate text-[10px] text-white/30">
                  {formatNoteDate(note.updated_at)}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(note.id, e)}
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
        {selectedNote === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/20">
            <FileText size={32} className="opacity-40" />
            <p className="text-[13px]">
              {t("notes.selectOrCreate", {
                defaultValue: "Select a note or create a new one",
              })}
            </p>
          </div>
        ) : (
          <>
            {/* Title */}
            <div
              className="border-b border-white/8"
              style={{ padding: "8px 16px" }}
            >
              <input
                type="text"
                placeholder={t("notes.titlePlaceholder", {
                  defaultValue: "Title",
                })}
                value={editTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full bg-transparent text-[15px] font-semibold text-white/85 placeholder-white/20 outline-none"
              />
              <p className="mt-0.5 text-[10px] text-white/25">
                {saving
                  ? t("notes.saving", { defaultValue: "Saving…" })
                  : formatNoteDate(selectedNote.updated_at)}
              </p>
            </div>
            {/* Content */}
            <textarea
              placeholder={t("notes.contentPlaceholder", {
                defaultValue: "Start writing…",
              })}
              value={editContent}
              onChange={(e) => handleContentChange(e.target.value)}
              style={{ padding: "10px 16px", fontFamily: "inherit" }}
              className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-white/75 placeholder-white/20 outline-none"
            />
          </>
        )}
      </div>
    </div>
  );
};

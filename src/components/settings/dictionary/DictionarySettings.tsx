import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X, Download, Upload } from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { commands, DictionaryEntry } from "@/bindings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

export const DictionarySettings: React.FC = () => {
  const { t } = useTranslation();

  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [adding, setAdding] = useState(false);

  // Inline edit state
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [editTo, setEditTo] = useState("");

  const load = async () => {
    try {
      const result = await commands.getDictionary();
      if (result.status === "ok") {
        setEntries(result.data);
      } else {
        setEntries([]);
      }
    } catch {
      // dictionary file absent — silently use empty list
      setEntries([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ── Add ──────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    const from = newFrom.trim();
    const to = newTo.trim();
    if (!from || !to) return;

    setAdding(true);
    try {
      await commands.addDictionaryEntry(from, to);
      setNewFrom("");
      setNewTo("");
      await load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  // ── Remove ────────────────────────────────────────────────────────────────

  const handleRemove = async (from: string) => {
    try {
      await commands.removeDictionaryEntry(from);
      await load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  // ── Inline edit ───────────────────────────────────────────────────────────

  const startEdit = (entry: DictionaryEntry) => {
    setEditingFrom(entry.from);
    setEditTo(entry.to);
  };

  const cancelEdit = () => {
    setEditingFrom(null);
    setEditTo("");
  };

  const confirmEdit = async (from: string) => {
    const to = editTo.trim();
    if (!to) return;
    try {
      await commands.updateDictionaryEntry(from, to);
      setEditingFrom(null);
      await load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, from: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmEdit(from);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    try {
      const filePath = await save({
        defaultPath: "vocaltype-dictionary.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const result = await commands.exportDictionary();
      if (result.status === "ok") {
        await writeTextFile(filePath, result.data);
        toast.success(t("dictionary.exportSuccess", { defaultValue: "Dictionnaire exporté." }));
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────

  const handleImport = async (replace: boolean) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected || typeof selected !== "string") return;
      const content = await readTextFile(selected);
      const result = await commands.importDictionary(content, replace);
      if (result.status === "ok") {
        await load();
        toast.success(
          replace
            ? t("dictionary.importReplaceSuccess", { defaultValue: "Dictionnaire importé (remplacé)." })
            : t("dictionary.importMergeSuccess", { defaultValue: "Dictionnaire importé (fusionné)." }),
        );
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 pt-5">
      {/* Export/Import toolbar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1 rounded-[6px] border border-white/8 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-white/45 transition-colors hover:text-white/70"
          title={t("dictionary.export", { defaultValue: "Exporter" })}
        >
          <Download size={12} />
          {t("dictionary.export", { defaultValue: "Exporter" })}
        </button>
        <button
          type="button"
          onClick={() => handleImport(false)}
          className="flex items-center gap-1 rounded-[6px] border border-white/8 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-white/45 transition-colors hover:text-white/70"
          title={t("dictionary.importMerge", { defaultValue: "Importer (fusionner)" })}
        >
          <Upload size={12} />
          {t("dictionary.importMerge", { defaultValue: "Importer" })}
        </button>
      </div>

      {/* Add row */}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={newFrom}
          onChange={(e) => setNewFrom(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder={t("dictionary.fromPlaceholder")}
          variant="compact"
          className="min-w-0 flex-1"
          disabled={adding}
        />
        <span className="shrink-0 text-white/30 text-[13px]">
          {t("dictionary.arrow")}
        </span>
        <Input
          type="text"
          value={newTo}
          onChange={(e) => setNewTo(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder={t("dictionary.toPlaceholder")}
          variant="compact"
          className="min-w-0 flex-1"
          disabled={adding}
        />
        <Button
          onClick={handleAdd}
          disabled={!newFrom.trim() || !newTo.trim() || adding}
          variant="primary"
          size="md"
          className="shrink-0"
        >
          {t("dictionary.add")}
        </Button>
      </div>

      {/* Entry list */}
      {entries.length === 0 ? (
        <p className="px-1 text-[13px] text-white/35 italic">
          {t("dictionary.empty")}
        </p>
      ) : (
        <div className="divide-y divide-white/6 rounded-lg border border-white/8">
          {entries.map((entry) => {
            const isEditing = editingFrom === entry.from;
            return (
              <div
                key={entry.from}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                {/* From (read-only) */}
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/60 font-mono">
                  {entry.from}
                </span>

                <span className="shrink-0 text-white/25 text-[12px]">
                  {t("dictionary.arrow")}
                </span>

                {/* To — editable inline */}
                {isEditing ? (
                  <Input
                    type="text"
                    value={editTo}
                    onChange={(e) => setEditTo(e.target.value)}
                    onKeyDown={(e) => handleEditKeyDown(e, entry.from)}
                    variant="compact"
                    className="min-w-0 flex-1 text-[13px]"
                    autoFocus
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white/90">
                    {entry.to}
                  </span>
                )}

                {/* Actions */}
                {isEditing ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => confirmEdit(entry.from)}
                      className="rounded p-1 text-green-400 hover:bg-white/8 transition-colors"
                      title={t("dictionary.save")}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded p-1 text-white/40 hover:bg-white/8 transition-colors"
                      title={t("dictionary.cancel")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(entry)}
                      className="rounded p-1 text-white/35 hover:text-white/70 hover:bg-white/8 transition-colors"
                      title={t("dictionary.save")}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(entry.from)}
                      className="rounded p-1 text-white/35 hover:text-red-400 hover:bg-white/8 transition-colors"
                      title={t("dictionary.remove")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

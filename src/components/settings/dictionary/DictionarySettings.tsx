import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { commands, DictionaryEntry } from "@/bindings";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "@/hooks/useSettings";

export const DictionarySettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const autoLearn = getSetting("auto_learn_dictionary") ?? false;

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
      toast.error(getUserFacingErrorMessage(e, { t, context: "settings" }));
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
      toast.error(getUserFacingErrorMessage(e, { t, context: "settings" }));
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
      toast.error(getUserFacingErrorMessage(e, { t, context: "settings" }));
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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 32,
      }}
    >
      {/* Auto-learn toggle */}
      <div
        className="flex items-center justify-between voca-surface"
        style={{ padding: "24px", gap: 24 }}
      >
        <div>
          <p className="text-[15.5px] font-bold text-white/92">
            {t("dictionary.autoLearn", {
              defaultValue: "Corrections automatiques",
            })}
          </p>
          <p className="mt-2 text-[14px] leading-6 text-white/58">
            {t("dictionary.autoLearnDesc", {
              defaultValue:
                "Vocalype peut retenir les corrections que tu valides.",
            })}
          </p>
          <p className="mt-1 text-[11px] text-white/30">
            {t("dictionary.storedLocally", {
              defaultValue: "Stocké localement sur ton appareil.",
            })}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(autoLearn)}
          onClick={() => updateSetting("auto_learn_dictionary", !autoLearn)}
          className={`relative h-[26px] w-[46px] flex-shrink-0 rounded-full border transition-colors ${
            autoLearn
              ? "border-logo-primary/35 bg-logo-primary/85"
              : "border-logo-stroke/12 bg-white/[0.065]"
          }`}
        >
          <span
            className={`absolute left-0 top-[4px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.32)] transition-transform ${
              autoLearn ? "translate-x-[24px]" : "translate-x-[4px]"
            }`}
          />
        </button>
      </div>

      {/* Add row */}
      <div
        className="voca-surface"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 32,
          padding: "20px",
        }}
      >
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
      <div>
        {entries.length === 0 ? (
          <p
            className="voca-surface p-6 text-[13px] italic"
            style={{ color: "var(--color-text-faint)" }}
          >
            {t("dictionary.empty")}
          </p>
        ) : (
          <div className="voca-surface" style={{ padding: "8px 24px" }}>
            {entries.map((entry) => {
              const isEditing = editingFrom === entry.from;
              return (
                <div
                  key={entry.from}
                  className="border-b border-logo-stroke/[0.08] last:border-b-0"
                  style={{
                    padding: "20px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
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
                        aria-label={t("dictionary.save")}
                        title={t("dictionary.save")}
                      >
                        <Check size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded p-1 text-white/40 hover:bg-white/8 transition-colors"
                        aria-label={t("dictionary.cancel")}
                        title={t("dictionary.cancel")}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        className="rounded p-1 text-white/35 hover:text-white/70 hover:bg-white/8 transition-colors"
                        aria-label={t("dictionary.edit", {
                          defaultValue: "Edit",
                        })}
                        title={t("dictionary.edit", { defaultValue: "Edit" })}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(entry.from)}
                        className="rounded p-1 text-white/35 hover:text-red-400 hover:bg-white/8 transition-colors"
                        aria-label={t("dictionary.remove")}
                        title={t("dictionary.remove")}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

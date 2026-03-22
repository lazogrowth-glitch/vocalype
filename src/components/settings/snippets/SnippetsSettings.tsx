import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { commands, type VoiceSnippet } from "@/bindings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

// ── Inline edit state ────────────────────────────────────────────────────────

interface EditState {
  id: string;
  trigger: string;
  expansion: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export const SnippetsSettings: React.FC = () => {
  const { t } = useTranslation();

  const [snippets, setSnippets] = useState<VoiceSnippet[]>([]);
  const [newTrigger, setNewTrigger] = useState("");
  const [newExpansion, setNewExpansion] = useState("");
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);

  const load = async () => {
    try {
      const data = await commands.getVoiceSnippets();
      setSnippets(data);
    } catch {
      setSnippets([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ── Add ─────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    const trigger = newTrigger.trim();
    const expansion = newExpansion.trim();
    if (!trigger || !expansion) return;

    setAdding(true);
    try {
      const result = await commands.addVoiceSnippet(trigger, expansion);
      if (result.status === "ok") {
        setNewTrigger("");
        setNewExpansion("");
        await load();
      } else {
        toast.error(result.error);
      }
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

  // ── Remove ───────────────────────────────────────────────────────────────

  const handleRemove = async (id: string) => {
    try {
      const result = await commands.removeVoiceSnippet(id);
      if (result.status === "ok") {
        await load();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  // ── Inline edit ──────────────────────────────────────────────────────────

  const startEdit = (s: VoiceSnippet) => {
    setEdit({ id: s.id, trigger: s.trigger, expansion: s.expansion });
  };

  const cancelEdit = () => setEdit(null);

  const confirmEdit = async () => {
    if (!edit) return;
    const trigger = edit.trigger.trim();
    const expansion = edit.expansion.trim();
    if (!trigger || !expansion) return;

    try {
      const result = await commands.updateVoiceSnippet(
        edit.id,
        trigger,
        expansion,
      );
      if (result.status === "ok") {
        setEdit(null);
        await load();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pt-5">
      {/* Info banner */}
      <div className="rounded-[8px] border border-white/6 bg-white/[0.02] px-4 py-3">
        <p className="mb-1 text-[11.5px] font-medium text-white/50">
          {t("snippets.howItWorks", { defaultValue: "Comment ça marche" })}
        </p>
        <p className="text-[11px] text-white/30 leading-relaxed">
          {t("snippets.description", {
            defaultValue:
              "Dis le déclencheur exact → le texte d'expansion est collé automatiquement. Ex : « mon email » → « jean@exemple.com ».",
          })}
        </p>
      </div>

      {/* Add row */}
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Input
            type="text"
            value={newTrigger}
            onChange={(e) => setNewTrigger(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder={t("snippets.triggerPlaceholder", {
              defaultValue: "Déclencheur vocal (ex : mon email)",
            })}
            variant="compact"
            disabled={adding}
          />
          <Input
            type="text"
            value={newExpansion}
            onChange={(e) => setNewExpansion(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder={t("snippets.expansionPlaceholder", {
              defaultValue: "Texte à coller (ex : jean@exemple.com)",
            })}
            variant="compact"
            disabled={adding}
          />
        </div>
        <Button
          onClick={handleAdd}
          disabled={!newTrigger.trim() || !newExpansion.trim() || adding}
          variant="primary"
          size="md"
          className="shrink-0 mt-0.5"
          aria-label={t("snippets.add", { defaultValue: "Add" })}
          title={t("snippets.add", { defaultValue: "Add" })}
        >
          <Plus size={15} aria-hidden="true" />
        </Button>
      </div>

      {/* List */}
      {snippets.length === 0 ? (
        <p className="px-1 text-[13px] italic text-white/35">
          {t("snippets.empty", {
            defaultValue: "Aucun snippet. Ajoutes-en un ci-dessus.",
          })}
        </p>
      ) : (
        <div className="divide-y divide-white/6 rounded-lg border border-white/8">
          {snippets.map((s) => {
            const isEditing = edit?.id === s.id;
            return (
              <div key={s.id} className="flex flex-col gap-1.5 px-4 py-3">
                {isEditing ? (
                  <>
                    <Input
                      type="text"
                      value={edit.trigger}
                      onChange={(e) =>
                        setEdit(
                          (prev) =>
                            prev && { ...prev, trigger: e.target.value },
                        )
                      }
                      onKeyDown={handleEditKeyDown}
                      variant="compact"
                      autoFocus
                    />
                    <Input
                      type="text"
                      value={edit.expansion}
                      onChange={(e) =>
                        setEdit(
                          (prev) =>
                            prev && { ...prev, expansion: e.target.value },
                        )
                      }
                      onKeyDown={handleEditKeyDown}
                      variant="compact"
                    />
                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={confirmEdit}
                        className="rounded px-2 py-0.5 text-[11.5px] text-green-400 hover:bg-white/8 transition-colors"
                      >
                        <Check
                          size={13}
                          className="inline mr-1"
                          aria-hidden="true"
                        />
                        {t("snippets.save", { defaultValue: "Enregistrer" })}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded px-2 py-0.5 text-[11.5px] text-white/40 hover:bg-white/8 transition-colors"
                      >
                        <X
                          size={13}
                          className="inline mr-1"
                          aria-hidden="true"
                        />
                        {t("snippets.cancel", { defaultValue: "Annuler" })}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-logo-primary/10 px-2 py-0.5 text-[11px] font-mono font-medium text-logo-primary">
                          {s.trigger}
                        </span>
                        <span className="text-[11px] text-white/30">→</span>
                        <span className="text-[12.5px] text-white/75 truncate max-w-[240px]">
                          {s.expansion}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="rounded p-1 text-white/35 hover:text-white/70 hover:bg-white/8 transition-colors"
                        aria-label={t("snippets.edit", {
                          defaultValue: "Edit",
                        })}
                        title={t("snippets.edit", { defaultValue: "Edit" })}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(s.id)}
                        className="rounded p-1 text-white/35 hover:text-red-400 hover:bg-white/8 transition-colors"
                        aria-label={t("snippets.remove", {
                          defaultValue: "Remove",
                        })}
                        title={t("snippets.remove", {
                          defaultValue: "Remove",
                        })}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
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

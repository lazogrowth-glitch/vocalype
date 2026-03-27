import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { commands, type VoiceSnippet } from "@/bindings";

// ── Modal ─────────────────────────────────────────────────────────────────────

interface SnippetModalProps {
  title: string;
  initialTrigger?: string;
  initialExpansion?: string;
  submitLabel: string;
  onSubmit: (trigger: string, expansion: string) => Promise<void>;
  onClose: () => void;
}

const SnippetModal: React.FC<SnippetModalProps> = ({
  title,
  initialTrigger = "",
  initialExpansion = "",
  submitLabel,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation();
  const [trigger, setTrigger] = useState(initialTrigger);
  const [expansion, setExpansion] = useState(initialExpansion);
  const [submitting, setSubmitting] = useState(false);
  const triggerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    triggerRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async () => {
    const t2 = trigger.trim();
    const e2 = expansion.trim();
    if (!t2 || !e2 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(t2, e2);
      onClose();
    } catch {
      // error already toasted in parent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[620px] rounded-[14px] border border-white/10 shadow-2xl"
        style={{ background: "#1b1b1b" }}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 18px" }}>
          <h2 className="text-[17px] font-semibold text-white/90">{title}</h2>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "0 28px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            ref={triggerRef}
            type="text"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder={t("snippets.triggerPlaceholder", {
              defaultValue: "Déclencheur (ex : mon email)",
            })}
            style={{ padding: "12px 16px" }}
            className="w-full rounded-[8px] border border-white/10 bg-white/[0.06] text-[14px] text-white/85 placeholder-white/30 outline-none focus:border-logo-primary/50 focus:bg-white/[0.08] transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <textarea
            value={expansion}
            onChange={(e) => setExpansion(e.target.value)}
            placeholder={t("snippets.expansionPlaceholder", {
              defaultValue: "Texte à coller (ex : jean@exemple.com)",
            })}
            rows={7}
            style={{ padding: "12px 16px" }}
            className="w-full resize-none rounded-[8px] border border-white/10 bg-white/[0.06] text-[14px] text-white/85 placeholder-white/30 outline-none focus:border-logo-primary/50 focus:bg-white/[0.08] transition-colors"
          />
        </div>

        {/* Footer */}
        <div
          style={{ padding: "18px 28px" }}
          className="flex items-center justify-end gap-2"
        >
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "10px 18px" }}
            className="rounded-[8px] border border-white/10 text-[13px] font-medium text-white/55 transition-colors hover:border-white/20 hover:text-white/75"
          >
            {t("snippets.cancel", { defaultValue: "Annuler" })}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!trigger.trim() || !expansion.trim() || submitting}
            style={{ padding: "10px 18px" }}
            className="rounded-[8px] bg-logo-primary text-[13px] font-medium text-black transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export const SnippetsSettings: React.FC = () => {
  const { t } = useTranslation();

  const [snippets, setSnippets] = useState<VoiceSnippet[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editSnippet, setEditSnippet] = useState<VoiceSnippet | null>(null);
  const [preFill, setPreFill] = useState<{
    trigger: string;
    expansion: string;
  } | null>(null);
  const [dismissedExamples, setDismissedExamples] = useState<Set<number>>(
    new Set(),
  );

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

  // ── Add ───────────────────────────────────────────────────────────────────

  const handleAdd = async (trigger: string, expansion: string) => {
    const result = await commands.addVoiceSnippet(trigger, expansion);
    if (result.status === "ok") {
      await load();
    } else {
      toast.error(result.error);
      throw new Error(result.error);
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────

  const handleEdit = async (trigger: string, expansion: string) => {
    if (!editSnippet) return;
    const result = await commands.updateVoiceSnippet(
      editSnippet.id,
      trigger,
      expansion,
    );
    if (result.status === "ok") {
      await load();
    } else {
      toast.error(result.error);
      throw new Error(result.error);
    }
  };

  // ── Remove ────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Add modal */}
      {showAddModal && (
        <SnippetModal
          title={t("snippets.addTitle", { defaultValue: "Ajouter un snippet" })}
          initialTrigger={preFill?.trigger ?? ""}
          initialExpansion={preFill?.expansion ?? ""}
          submitLabel={t("snippets.addSubmit", { defaultValue: "Ajouter" })}
          onSubmit={handleAdd}
          onClose={() => {
            setShowAddModal(false);
            setPreFill(null);
          }}
        />
      )}

      {/* Edit modal */}
      {editSnippet && (
        <SnippetModal
          title={t("snippets.editTitle", {
            defaultValue: "Modifier le snippet",
          })}
          initialTrigger={editSnippet.trigger}
          initialExpansion={editSnippet.expansion}
          submitLabel={t("snippets.save", { defaultValue: "Enregistrer" })}
          onSubmit={handleEdit}
          onClose={() => setEditSnippet(null)}
        />
      )}

      {/* Header row */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 32 }}
      >
        <p className="text-[12px] text-white/35 leading-relaxed max-w-sm">
          {t("snippets.description", {
            defaultValue:
              "Dis le déclencheur → le texte s'insère automatiquement.",
          })}
        </p>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          style={{ padding: "10px 18px" }}
          className="flex items-center gap-2 rounded-[9px] bg-logo-primary text-[13.5px] font-semibold text-black transition-opacity hover:opacity-85 cursor-pointer"
        >
          <Plus size={15} aria-hidden="true" />
          {t("snippets.addNew", { defaultValue: "Ajouter" })}
        </button>
      </div>

      {/* List */}
      {snippets.length === 0 ? (
        <div className="rounded-[12px] border border-white/6 bg-white/[0.02] overflow-hidden">
          {/* Example rows (clickable, pre-fill modal) */}
          {[
            {
              trigger: "mon LinkedIn",
              expansion: "https://linkedin.com/in/votre-profil",
            },
            { trigger: "mon email", expansion: "votre@email.com" },
            {
              trigger: "intro réunion",
              expansion:
                "Bonjour à tous, merci de vous joindre à cette réunion…",
            },
          ]
            .filter((_, i) => !dismissedExamples.has(i))
            .map((ex, _i, arr) => {
              const originalIndex = [
                "mon LinkedIn",
                "mon email",
                "intro réunion",
              ].indexOf(ex.trigger);
              return (
                <div
                  key={originalIndex}
                  style={{
                    padding: "10px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                  className="group border-b border-white/[0.04] last:border-0 hover:bg-logo-primary/[0.06] hover:border-logo-primary/20 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPreFill({
                        trigger: ex.trigger,
                        expansion: ex.expansion,
                      });
                      setShowAddModal(true);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flex: 1,
                      minWidth: 0,
                    }}
                    className="text-left cursor-pointer"
                  >
                    <span
                      style={{ padding: "2px 8px" }}
                      className="shrink-0 rounded-[6px] bg-white/[0.05] group-hover:bg-logo-primary/[0.12] font-mono text-[12px] text-white/25 group-hover:text-logo-primary/70 transition-colors"
                    >
                      {ex.trigger}
                    </span>
                    <span className="shrink-0 text-[12px] text-white/15 group-hover:text-logo-primary/40 transition-colors">
                      →
                    </span>
                    <span
                      style={{ padding: "2px 10px" }}
                      className="min-w-0 truncate rounded-[6px] border border-white/[0.07] group-hover:border-logo-primary/20 bg-white/[0.03] group-hover:bg-logo-primary/[0.06] text-[12px] text-white/25 group-hover:text-logo-primary/60 italic transition-colors"
                    >
                      {ex.expansion}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDismissedExamples(
                        (prev) => new Set([...prev, originalIndex]),
                      );
                    }}
                    className="shrink-0 text-white/20 hover:text-white/50 transition-colors cursor-pointer"
                    aria-label="Ignorer cette suggestion"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          {/* CTA */}
          <div
            className="flex flex-col items-center text-center"
            style={{ gap: 16, padding: "32px 24px" }}
          >
            <p className="text-[13px] text-white/35">
              {t("snippets.empty", {
                defaultValue: "Aucun snippet pour l'instant.",
              })}
            </p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              style={{ padding: "10px 18px" }}
              className="flex items-center gap-2 rounded-[8px] border border-white/12 bg-white/[0.05] text-[13px] font-medium text-white/50 transition-colors hover:bg-white/[0.09] hover:text-white/80 cursor-pointer"
            >
              <Plus size={14} aria-hidden="true" />
              {t("snippets.addFirst", {
                defaultValue: "Créer mon premier snippet",
              })}
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.05] rounded-[10px] border border-white/8 overflow-hidden">
          {snippets.map((s) => (
            <div
              key={s.id}
              style={{ padding: "10px 16px" }}
              className="group flex items-center gap-3 transition-colors hover:bg-white/[0.03]"
            >
              {/* Trigger pill */}
              <span
                style={{ padding: "2px 8px" }}
                className="shrink-0 rounded-[6px] bg-white/[0.07] font-mono text-[12px] text-white/75"
              >
                {s.trigger}
              </span>

              {/* Arrow */}
              <span className="shrink-0 text-[13px] text-white/20">→</span>

              {/* Expansion */}
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/50">
                {s.expansion}
              </span>

              {/* Actions — visible on hover */}
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setEditSnippet(s)}
                  className="rounded p-1.5 text-white/35 transition-colors hover:bg-white/8 hover:text-white/70"
                  aria-label={t("snippets.edit", { defaultValue: "Modifier" })}
                  title={t("snippets.edit", { defaultValue: "Modifier" })}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(s.id)}
                  className="rounded p-1.5 text-white/35 transition-colors hover:bg-white/8 hover:text-red-400"
                  aria-label={t("snippets.remove", {
                    defaultValue: "Supprimer",
                  })}
                  title={t("snippets.remove", { defaultValue: "Supprimer" })}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { commands, type VoiceSnippet } from "@/bindings";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { Button } from "../../ui/Button";

const snippetPillClassName =
  "inline-flex items-center rounded-[12px] border border-white/8 bg-white/[0.035] text-[13px] font-medium tracking-[0.01em] text-white/78";

const snippetPillStyle = {
  minHeight: 36,
  padding: "9px 14px",
};

const snippetPillTextClassName = "block w-full leading-[18px]";

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async () => {
    const nextTrigger = trigger.trim();
    const nextExpansion = expansion.trim();
    if (!nextTrigger || !nextExpansion || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(nextTrigger, nextExpansion);
      onClose();
    } catch {
      // Parent already handles the toast.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.68)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[640px] rounded-[18px] border border-white/10 shadow-2xl"
        style={{
          background:
            "linear-gradient(180deg, rgba(28,28,28,0.98), rgba(20,20,20,0.98))",
        }}
      >
        <div style={{ padding: "24px 28px 18px" }}>
          <h2 className="text-[17px] font-semibold text-white/92">{title}</h2>
        </div>

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
            className="w-full rounded-[10px] border border-white/10 bg-white/[0.06] text-[14px] text-white/85 placeholder-white/30 outline-none transition-colors focus:border-logo-primary/50 focus:bg-white/[0.08]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
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
            className="w-full resize-none rounded-[10px] border border-white/10 bg-white/[0.06] text-[14px] text-white/85 placeholder-white/30 outline-none transition-colors focus:border-logo-primary/50 focus:bg-white/[0.08]"
          />
        </div>

        <div
          style={{ padding: "18px 28px 24px" }}
          className="flex items-center justify-end gap-2"
        >
          <Button type="button" onClick={onClose} variant="secondary" size="sm">
            {t("snippets.cancel", { defaultValue: "Annuler" })}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!trigger.trim() || !expansion.trim() || submitting}
            variant="primary"
            size="sm"
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

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
    void load();
  }, []);

  const handleAdd = async (trigger: string, expansion: string) => {
    const result = await commands.addVoiceSnippet(trigger, expansion);
    if (result.status === "ok") {
      await load();
      return;
    }
    const message = getUserFacingErrorMessage(result.error, { t });
    toast.error(message);
    throw new Error(message);
  };

  const handleEdit = async (trigger: string, expansion: string) => {
    if (!editSnippet) return;
    const result = await commands.updateVoiceSnippet(
      editSnippet.id,
      trigger,
      expansion,
    );
    if (result.status === "ok") {
      await load();
      return;
    }
    const message = getUserFacingErrorMessage(result.error, { t });
    toast.error(message);
    throw new Error(message);
  };

  const handleRemove = async (id: string) => {
    try {
      const result = await commands.removeVoiceSnippet(id);
      if (result.status === "ok") {
        await load();
      } else {
        toast.error(getUserFacingErrorMessage(result.error, { t }));
      }
    } catch (e) {
      toast.error(getUserFacingErrorMessage(e, { t }));
    }
  };

  const suggestions = [
    {
      trigger: "mon LinkedIn",
      expansion: "https://linkedin.com/in/votre-profil",
    },
    { trigger: "mon email", expansion: "votre@email.com" },
    {
      trigger: "intro réunion",
      expansion: "Bonjour à tous, merci de vous joindre à cette réunion...",
    },
  ];

  return (
    <>
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

      <div
        className="flex items-end justify-between gap-4"
        style={{ marginBottom: 28 }}
      >
        <p className="max-w-md text-[12px] leading-relaxed text-white/38">
          {t("snippets.description", {
            defaultValue:
              "Dites un déclencheur, puis le texte associé s'insère automatiquement.",
          })}
        </p>
        <Button
          type="button"
          onClick={() => setShowAddModal(true)}
          variant="primary"
          size="sm"
        >
          <Plus size={15} aria-hidden="true" />
          {t("snippets.addNew", { defaultValue: "Ajouter" })}
        </Button>
      </div>

      {snippets.length === 0 ? (
        <div className="overflow-hidden rounded-[14px] border border-white/8 bg-white/[0.02]">
          {suggestions
            .filter((_, i) => !dismissedExamples.has(i))
            .map((example, index) => (
              <div
                key={example.trigger}
                style={{ padding: "12px 16px" }}
                className="group flex items-center gap-3 border-b border-white/[0.05] last:border-b-0 hover:bg-logo-primary/[0.05] transition-colors"
              >
                <button
                  type="button"
                  onClick={() => {
                    setPreFill(example);
                    setShowAddModal(true);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-10 text-left"
                >
                  <span
                    className={`${snippetPillClassName} shrink-0 justify-center transition-colors group-hover:border-logo-primary/18 group-hover:bg-logo-primary/[0.06] group-hover:text-logo-primary`}
                    style={snippetPillStyle}
                  >
                    <span className={snippetPillTextClassName}>
                      {example.trigger}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-white/18 transition-colors group-hover:text-logo-primary/50">
                    →
                  </span>
                  <span
                    className={`${snippetPillClassName} min-w-0 transition-colors group-hover:border-logo-primary/18 group-hover:bg-logo-primary/[0.06] group-hover:text-logo-primary/82`}
                    style={snippetPillStyle}
                  >
                    <span
                      className={`${snippetPillTextClassName} truncate text-white/60`}
                    >
                      {example.expansion}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDismissedExamples((prev) => new Set([...prev, index]))
                  }
                  className="shrink-0 rounded-md p-1 text-white/20 transition-colors hover:bg-white/[0.06] hover:text-white/50"
                  aria-label="Ignorer cette suggestion"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            ))}

          <div
            className="flex flex-col items-center text-center"
            style={{ gap: 16, padding: "32px 24px" }}
          >
            <p className="text-[13px] text-white/35">
              {t("snippets.empty", {
                defaultValue: "Aucun snippet pour l'instant.",
              })}
            </p>
            <Button
              type="button"
              onClick={() => setShowAddModal(true)}
              variant="secondary"
              size="sm"
            >
              <Plus size={14} aria-hidden="true" />
              {t("snippets.addFirst", {
                defaultValue: "Créer mon premier snippet",
              })}
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-white/8 bg-white/[0.02]">
          {snippets.map((snippet, index) => (
            <div
              key={snippet.id}
              style={{ padding: "12px 16px" }}
              className={`group flex items-center gap-3 transition-colors hover:bg-white/[0.03] ${
                index < snippets.length - 1
                  ? "border-b border-white/[0.05]"
                  : ""
              }`}
            >
              <span
                className={`${snippetPillClassName} shrink-0 justify-center text-white/84`}
                style={snippetPillStyle}
              >
                <span className={snippetPillTextClassName}>
                  {snippet.trigger}
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-white/20">→</span>
              <span
                className={`${snippetPillClassName} min-w-0 flex-1 text-white/64`}
                style={snippetPillStyle}
              >
                <span className={`${snippetPillTextClassName} truncate`}>
                  {snippet.expansion}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  onClick={() => setEditSnippet(snippet)}
                  variant="ghost"
                  size="sm"
                  className="p-2 text-white/38 hover:text-white/72"
                  aria-label={t("snippets.edit", { defaultValue: "Modifier" })}
                  title={t("snippets.edit", { defaultValue: "Modifier" })}
                >
                  <Pencil size={13} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleRemove(snippet.id)}
                  variant="ghost"
                  size="sm"
                  className="p-2 text-white/38 hover:text-red-400"
                  aria-label={t("snippets.remove", {
                    defaultValue: "Supprimer",
                  })}
                  title={t("snippets.remove", { defaultValue: "Supprimer" })}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

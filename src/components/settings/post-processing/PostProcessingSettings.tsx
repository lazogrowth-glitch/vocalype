import React, { useState } from "react";
import {
  CheckCircle,
  ClipboardList,
  Cog,
  FileText,
  ChevronRight,
  Linkedin,
  Mail,
  Plus,
  Zap,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";

type EditingAction = {
  key: number;
  originalKey?: number;
  name: string;
  prompt: string;
  isNew: boolean;
};

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings, settings } = useSettings();
  const [editingAction, setEditingAction] = useState<EditingAction | null>(
    null,
  );

  const templates = [
    {
      id: "candidate_note",
      icon: <ClipboardList size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.candidateNote.name"),
      description: t(
        "settings.postProcessing.actions.templates.candidateNote.description",
      ),
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      prompt:
        "Transform the dictated text into a clean recruiter ATS note.\n\nKeep the same language as the source.\n\nStructure the output with:\n- Candidate summary\n- Experience / background\n- Key skills\n- Motivation\n- Salary / availability if mentioned\n- Concerns / risks if mentioned\n- Next step\n\nDo not invent information. If something is not mentioned, omit it. Return only the final ATS note.\n\nText:\n${output}",
    },
    {
      id: "email_candidate",
      icon: <Mail size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.emailCandidate.name"),
      description: t(
        "settings.postProcessing.actions.templates.emailCandidate.description",
      ),
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      prompt:
        "Transform the dictated text into a clear, professional email to a candidate.\n\nKeep the same language as the source.\nMake it concise, polite, and natural.\nDo not add fake details.\nReturn only the email body, no subject line.\n\nText:\n${output}",
    },
    {
      id: "linkedin_message",
      icon: <Linkedin size={18} aria-hidden="true" />,
      label: t(
        "settings.postProcessing.actions.templates.linkedinMessage.name",
      ),
      description: t(
        "settings.postProcessing.actions.templates.linkedinMessage.description",
      ),
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      prompt:
        "Transform the dictated text into a short, natural LinkedIn message for recruiting.\n\nKeep it concise.\nMake it human, direct, and not too salesy.\nKeep the same language as the source.\nDo not exaggerate or invent details.\nReturn only the message.\n\nText:\n${output}",
    },
    {
      id: "client_summary",
      icon: <FileText size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.clientSummary.name"),
      description: t(
        "settings.postProcessing.actions.templates.clientSummary.description",
      ),
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      prompt:
        "Transform the dictated text into a professional candidate summary for a client.\n\nKeep the same language as the source.\nMake it clear, concise, and business-oriented.\nStructure it with:\n- Candidate profile\n- Relevant experience\n- Why they may fit the role\n- Key strengths\n- Possible concerns if mentioned\n- Recommended next step\n\nDo not invent information. Return only the client-ready summary.\n\nText:\n${output}",
    },
  ];

  const actions = getSetting("post_process_actions") || [];
  const isCloudActive =
    settings?.post_process_enabled === true &&
    settings?.post_process_provider_id === "vocalype-cloud";

  const openCloudSettings = () => {
    window.dispatchEvent(
      new CustomEvent("vocalype:navigate-settings", {
        detail: {
          section: "advanced",
          scrollToId: "cloud-post-process-toggle",
        },
      }),
    );
  };

  const formatPromptPreview = (prompt: string) =>
    prompt
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\$\{output\}/g, "texte dicte");

  const usedKeys = new Set(actions.map((a) => a.key));
  const nextAvailableKey = Array.from({ length: 9 }, (_, i) => i + 1).find(
    (k) => !usedKeys.has(k),
  );
  const availableKeysForEditing = Array.from({ length: 9 }, (_, i) => i + 1)
    .filter(
      (k) =>
        !usedKeys.has(k) ||
        k === editingAction?.key ||
        k === editingAction?.originalKey,
    )
    .map((k) => ({ value: String(k), label: String(k) }));

  const handleStartCreate = () => {
    if (!nextAvailableKey) return;
    setEditingAction({
      key: nextAvailableKey,
      name: "",
      prompt: "",
      isNew: true,
    });
  };

  const handleStartFromTemplate = (tpl: { label: string; prompt: string }) => {
    if (!nextAvailableKey) return;
    setEditingAction({
      key: nextAvailableKey,
      name: tpl.label,
      prompt: tpl.prompt,
      isNew: true,
    });
  };

  const handleStartEdit = (action: {
    key: number;
    name: string;
    prompt: string;
  }) => {
    setEditingAction({
      key: action.key,
      originalKey: action.key,
      name: action.name,
      prompt: action.prompt,
      isNew: false,
    });
  };

  const handleSave = async () => {
    if (
      !editingAction ||
      !editingAction.name.trim() ||
      !editingAction.prompt.trim()
    )
      return;
    try {
      if (editingAction.isNew) {
        await commands.addPostProcessAction(
          editingAction.key,
          editingAction.name.trim(),
          editingAction.prompt.trim(),
          null,
          null,
        );
      } else if (
        editingAction.originalKey !== undefined &&
        editingAction.originalKey !== editingAction.key
      ) {
        await commands.deletePostProcessAction(editingAction.originalKey);
        await commands.addPostProcessAction(
          editingAction.key,
          editingAction.name.trim(),
          editingAction.prompt.trim(),
          null,
          null,
        );
      } else {
        await commands.updatePostProcessAction(
          editingAction.key,
          editingAction.name.trim(),
          editingAction.prompt.trim(),
          null,
          null,
        );
      }
      await refreshSettings();
      setEditingAction(null);
    } catch (err) {
      console.error("Failed to save action:", err);
    }
  };

  const handleDelete = async (key: number) => {
    try {
      await commands.deletePostProcessAction(key);
      await refreshSettings();
      if (editingAction?.key === key) setEditingAction(null);
    } catch (err) {
      console.error("Failed to delete action:", err);
    }
  };

  return (
    <div className="flex flex-col gap-8 py-6 px-2">
      <div
        className="settings-group-card"
        style={{
          borderColor: isCloudActive ? "rgba(250,180,60,0.22)" : undefined,
          background: isCloudActive ? "rgba(250,180,60,0.045)" : undefined,
        }}
      >
        <div
          className="flex items-center justify-between gap-4"
          style={{ padding: "18px 20px" }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isCloudActive ? (
                <CheckCircle
                  size={14}
                  style={{ color: "rgba(250,180,60,0.92)", flexShrink: 0 }}
                />
              ) : (
                <Zap
                  size={14}
                  style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}
                />
              )}
              <p className="text-[12px] font-medium text-white/82">
                {t("settings.cloudLlm.label", {
                  defaultValue: "Vocalype Cloud (faster)",
                })}
              </p>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-white/42">
              {isCloudActive
                ? t("settings.cloudLlm.activeDescription", {
                    defaultValue:
                      "Actif — les actions utilisent Vocalype Cloud.",
                  })
                : t("settings.postProcessing.modelPicker.enableCloud", {
                    defaultValue:
                      "Active Vocalype Cloud depuis Paramètres pour exécuter tes actions plus vite.",
                  })}
            </p>
          </div>
          <Button
            onClick={openCloudSettings}
            variant="secondary"
            size="sm"
            className="shrink-0"
          >
            <Cog size={14} aria-hidden="true" />
            {t("settings.advanced.title", {
              defaultValue: "Paramètres",
            })}
          </Button>
        </div>
      </div>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <p className="voca-section-desc">
          {t("settings.postProcessing.actions.description")}
        </p>
        {!editingAction && actions.length < 9 && (
          <Button
            onClick={handleStartCreate}
            variant="primary-soft"
            size="sm"
            className="shrink-0"
          >
            <Plus size={14} aria-hidden="true" />
            {t("settings.postProcessing.actions.addAction")}
          </Button>
        )}
      </div>

      {/* ── Template cards ── */}
      {!editingAction && actions.length < 9 && (
        <div>
          <p className="voca-label-caps mb-3">
            {t("settings.postProcessing.quickTemplates", {
              defaultValue: "Actions rapides",
            })}
          </p>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => handleStartFromTemplate(tpl)}
                className="voca-tpl-card group outline-none"
              >
                <div className={`voca-tpl-icon ${tpl.bg} ${tpl.color}`}>
                  {tpl.icon}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="voca-tpl-name">{tpl.label}</p>
                  <p className="voca-tpl-desc">{tpl.description}</p>
                </div>
                <ChevronRight
                  size={14}
                  className="shrink-0 opacity-0 group-hover:opacity-30 transition-opacity"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Action list ── */}
      {actions.length > 0 && !editingAction && (
        <div>
          <p className="voca-label-caps mb-3">
            {t("settings.postProcessing.actions.configuredLabel", {
              defaultValue: "Actions configurées",
            })}{" "}
            <span className="opacity-40 font-medium">({actions.length}/9)</span>
          </p>
          <div className="flex flex-col gap-3">
            {[...actions]
              .sort((a, b) => a.key - b.key)
              .map((action) => (
                <div
                  key={action.key}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleStartEdit(action);
                    }
                  }}
                  onClick={() => handleStartEdit(action)}
                  className="voca-action-row group outline-none"
                >
                  <div className="voca-action-key">
                    <span className="voca-key-num">{action.key}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="voca-item-name">{action.name}</span>
                    </div>
                    <p className="voca-item-preview">
                      {action.description ?? formatPromptPreview(action.prompt)}
                    </p>
                  </div>
                  <button
                    className="voca-row-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(action.key);
                    }}
                  >
                    {t("settings.postProcessing.actions.delete")}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Edit panel ── */}
      {editingAction && (
        <div className="voca-panel">
          <div className="space-y-5">
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {t("settings.postProcessing.actions.key")}
                </label>
                <select
                  value={editingAction.key}
                  onChange={(e) =>
                    setEditingAction({
                      ...editingAction,
                      key: Number(e.target.value),
                    })
                  }
                  className="h-10 w-12 cursor-pointer appearance-none rounded-xl border border-accent/25 bg-accent-soft text-center font-mono text-[13px] font-bold text-accent outline-none hover:border-accent/40 focus:ring-2 focus:ring-accent/30"
                >
                  {availableKeysForEditing.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {t("settings.postProcessing.actions.name")}
                </label>
                <Input
                  type="text"
                  value={editingAction.name}
                  onChange={(e) =>
                    setEditingAction({ ...editingAction, name: e.target.value })
                  }
                  placeholder={t(
                    "settings.postProcessing.actions.namePlaceholder",
                  )}
                  variant="compact"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                {t("settings.postProcessing.actions.prompt")}
              </label>
              <Textarea
                value={editingAction.prompt}
                onChange={(e) =>
                  setEditingAction({ ...editingAction, prompt: e.target.value })
                }
                placeholder={t(
                  "settings.postProcessing.actions.promptPlaceholder",
                )}
              />
              <p className="text-[11px] text-zinc-600">
                <Trans
                  i18nKey="settings.postProcessing.actions.promptTip"
                  components={{ code: <code /> }}
                />
              </p>
            </div>

            {isCloudActive ? (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <CheckCircle size={13} className="text-amber-400" />
                <span className="text-[12px] font-medium text-white/70">
                  {t("settings.postProcessing.modelPicker.cloudActive", {
                    defaultValue: "Vocalype Cloud actif",
                  })}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/3 px-3 py-2.5">
                <Zap size={13} className="text-white/30" />
                <span className="text-[12px] text-white/40">
                  {t("settings.postProcessing.modelPicker.enableCloud", {
                    defaultValue:
                      "Active Vocalype Cloud en haut pour exécuter cette action.",
                  })}
                </span>
              </div>
            )}

            <div className="voca-hint-box">
              {t("settings.postProcessing.actions.llmExecutionHint", {
                defaultValue:
                  "Cette action ne modifie pas la capture vocale. Elle transforme seulement le texte final.",
              })}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleSave}
                variant="primary"
                size="sm"
                disabled={
                  !editingAction.name.trim() || !editingAction.prompt.trim()
                }
              >
                {t("settings.postProcessing.actions.save")}
              </Button>
              <Button
                onClick={() => setEditingAction(null)}
                variant="secondary"
                size="sm"
              >
                {t("settings.postProcessing.actions.cancel")}
              </Button>
              {!editingAction.isNew && (
                <Button
                  onClick={() =>
                    handleDelete(editingAction.originalKey ?? editingAction.key)
                  }
                  variant="danger-ghost"
                  size="sm"
                  className="ml-auto"
                >
                  {t("settings.postProcessing.actions.delete")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {actions.length >= 9 && !editingAction && (
        <p className="text-[12px] text-muted">
          {t("settings.postProcessing.actions.maxActionsReached")}
        </p>
      )}
    </div>
  );
};

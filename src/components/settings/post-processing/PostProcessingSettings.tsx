import React, { useState } from "react";
import { Wand2, ListChecks, Mail, Languages, Plus } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Dropdown, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";

type EditingAction = {
  key: number;
  originalKey?: number;
  name: string;
  prompt: string;
  savedModelId: string;
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
      id: "cleanup",
      icon: <Wand2 size={22} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.cleanup.name", {
        defaultValue: "Corriger",
      }),
      description: t(
        "settings.postProcessing.actions.templates.cleanup.description",
        { defaultValue: "Nettoie la dictee sans changer le sens." },
      ),
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      prompt:
        "Corrige la grammaire, la ponctuation et la clarte du texte suivant sans changer son sens. Garde la langue d'origine. Texte : ${output}",
    },
    {
      id: "summary",
      icon: <ListChecks size={22} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.summary.name", {
        defaultValue: "Resume + actions",
      }),
      description: t(
        "settings.postProcessing.actions.templates.summary.description",
        { defaultValue: "Transforme une dictee longue en points utiles." },
      ),
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      prompt:
        "Resume le texte suivant en quelques points clairs, puis ajoute une section Actions si des taches sont mentionnees. Texte : ${output}",
    },
    {
      id: "email",
      icon: <Mail size={22} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.email.name", {
        defaultValue: "Email pro",
      }),
      description: t(
        "settings.postProcessing.actions.templates.email.description",
        { defaultValue: "Reformate la dictee en email pret a envoyer." },
      ),
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      prompt:
        "Transforme le texte suivant en email professionnel, clair et naturel. Ajoute une salutation si necessaire, structure les paragraphes et garde le message concis. Texte : ${output}",
    },
    {
      id: "translate",
      icon: <Languages size={22} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.translate.name", {
        defaultValue: "Traduire en anglais",
      }),
      description: t(
        "settings.postProcessing.actions.templates.translate.description",
        { defaultValue: "Traduit proprement en anglais naturel." },
      ),
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      prompt:
        "Traduis le texte suivant en anglais naturel et professionnel. Ne rajoute aucun commentaire. Texte : ${output}",
    },
  ];

  const actions = getSetting("post_process_actions") || [];
  const savedModels = getSetting("saved_processing_models") || [];
  const activeProviderId = settings?.post_process_provider_id ?? "";
  const activeModel = settings?.post_process_models?.[activeProviderId] ?? "";
  const activeApiKey =
    settings?.post_process_api_keys?.[activeProviderId] ?? "";

  const hasProcessingModel =
    savedModels.length > 0 ||
    activeProviderId === "apple_intelligence" ||
    (!!activeProviderId && !!activeModel.trim() && !!activeApiKey.trim());

  const formatPromptPreview = (prompt: string) =>
    prompt
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\$\{output\}/g, "texte dicte");

  const modelDropdownOptions = [
    {
      value: "__default__",
      label: t("settings.postProcessing.actions.defaultModel"),
    },
    ...savedModels.map((m) => ({ value: m.id, label: m.label })),
  ];

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
      savedModelId: "",
      isNew: true,
    });
  };

  const handleStartFromTemplate = (tpl: { label: string; prompt: string }) => {
    if (!nextAvailableKey) return;
    setEditingAction({
      key: nextAvailableKey,
      name: tpl.label,
      prompt: tpl.prompt,
      savedModelId: "",
      isNew: true,
    });
  };

  const handleStartEdit = (action: {
    key: number;
    name: string;
    prompt: string;
    model?: string | null;
    provider_id?: string | null;
  }) => {
    let savedModelId = "";
    if (action.provider_id && action.model) {
      const id = `${action.provider_id}:${action.model}`;
      if (savedModels.some((m) => m.id === id)) savedModelId = id;
    }
    setEditingAction({
      key: action.key,
      originalKey: action.key,
      name: action.name,
      prompt: action.prompt,
      savedModelId,
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
      let model: string | null = null;
      let providerId: string | null = null;
      if (editingAction.savedModelId) {
        const saved = savedModels.find(
          (m) => m.id === editingAction.savedModelId,
        );
        if (saved) {
          model = saved.model_id;
          providerId = saved.provider_id;
        }
      }
      if (editingAction.isNew) {
        await commands.addPostProcessAction(
          editingAction.key,
          editingAction.name.trim(),
          editingAction.prompt.trim(),
          model,
          providerId,
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
          model,
          providerId,
        );
      } else {
        await commands.updatePostProcessAction(
          editingAction.key,
          editingAction.name.trim(),
          editingAction.prompt.trim(),
          model,
          providerId,
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
    <div className="mx-auto max-w-5xl space-y-10 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="voca-section-title">
              {t("settings.postProcessing.actions.title")}
            </h2>
            <span className="voca-badge voca-badge-neutral">LLM</span>
            <span
              className={`voca-badge ${hasProcessingModel ? "voca-badge-success" : "voca-badge-accent"}`}
            >
              {hasProcessingModel ? "Modele pret" : "A configurer"}
            </span>
          </div>
          <p className="voca-section-desc">
            {t("settings.postProcessing.actions.description")}
          </p>
        </div>
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

      {!editingAction && actions.length < 9 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleStartFromTemplate(tpl)}
              className={`voca-card group outline-none`}
            >
              <div className={`voca-icon ${tpl.bg} ${tpl.color}`}>
                {tpl.icon}
              </div>
              <div>
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: "rgba(255,255,255,0.88)" }}
                >
                  {tpl.label}
                </p>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: "var(--color-text-faint)" }}
                >
                  {tpl.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {actions.length > 0 && !editingAction && (
        <div className="space-y-2">
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
                className="voca-row group outline-none"
              >
                <span className="voca-key">{action.key}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-[13px] font-semibold"
                      style={{ color: "rgba(255,255,255,0.85)" }}
                    >
                      {action.name}
                    </span>
                    {action.provider_id && action.model && (
                      <span className="voca-badge voca-badge-neutral">
                        {savedModels.find(
                          (m) =>
                            m.id === `${action.provider_id}:${action.model}`,
                        )?.label || action.model}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-0.5 line-clamp-1 text-[11px]"
                    style={{ color: "var(--color-text-ghost)" }}
                  >
                    {formatPromptPreview(action.prompt)}
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-md px-2.5 py-1 text-[11px] opacity-0 transition-all hover:bg-red-400/[0.08] hover:text-red-400 group-hover:opacity-100"
                  style={{ color: "rgba(255,255,255,0.20)" }}
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
      )}

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
                  className="h-10 w-12 cursor-pointer appearance-none rounded-xl border border-[#F5C300]/25 bg-[#F5C300]/10 text-center font-mono text-[13px] font-bold text-[#F5C300] outline-none hover:border-[#F5C300]/40 focus:ring-2 focus:ring-[#F5C300]/30"
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

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                {t("settings.postProcessing.actions.model")}
              </label>
              <Dropdown
                selectedValue={editingAction.savedModelId || null}
                options={modelDropdownOptions}
                onSelect={(value) =>
                  setEditingAction({
                    ...editingAction,
                    savedModelId: value === "__default__" ? "" : value,
                  })
                }
                placeholder={t(
                  "settings.postProcessing.actions.modelPlaceholder",
                )}
              />
              <p className="text-[11px] text-zinc-600">
                {t("settings.postProcessing.actions.modelTip")}
              </p>
            </div>

            <div
              className="rounded-xl border px-4 py-3 text-[12px] leading-5"
              style={{
                background: "var(--color-background)",
                borderColor: "var(--color-border-row)",
                color: "var(--color-text-ghost)",
              }}
            >
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

      {!editingAction && actions.length > 0 && actions.length < 9 && (
        <div>
          <Button onClick={handleStartCreate} variant="secondary" size="sm">
            <Plus size={14} aria-hidden="true" />
            {t("settings.postProcessing.actions.addAction")}
          </Button>
        </div>
      )}

      {actions.length >= 9 && !editingAction && (
        <p className="text-[12px] text-zinc-600">
          {t("settings.postProcessing.actions.maxActionsReached")}
        </p>
      )}
    </div>
  );
};

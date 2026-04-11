import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Languages, ListChecks, Mail, Sparkles, Wand2 } from "lucide-react";

import {
  Dropdown,
  InfoTooltip,
  SettingContainer,
  SettingsGroup,
  Textarea,
} from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";

const PostProcessingActionsComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings, settings } = useSettings();
  const [editingAction, setEditingAction] = useState<{
    key: number;
    originalKey?: number;
    name: string;
    prompt: string;
    savedModelId: string;
    isNew: boolean;
  } | null>(null);

  const actions = getSetting("post_process_actions") || [];
  const savedModels = getSetting("saved_processing_models") || [];
  const activeProviderId = settings?.post_process_provider_id ?? "";
  const activeProvider = settings?.post_process_providers?.find(
    (provider) => provider.id === activeProviderId,
  );
  const activeModel = settings?.post_process_models?.[activeProviderId] ?? "";
  const activeApiKey =
    settings?.post_process_api_keys?.[activeProviderId] ?? "";
  const hasProcessingModel =
    savedModels.length > 0 ||
    activeProviderId === "apple_intelligence" ||
    (!!activeProviderId && !!activeModel.trim() && !!activeApiKey.trim());
  const modelStatusLabel = hasProcessingModel
    ? t("settings.postProcessing.actions.templates.readyBadge", {
        defaultValue: "Modèle prêt",
      })
    : t("settings.postProcessing.actions.templates.setupBadge", {
        defaultValue: "À configurer",
      });
  const modelStatusDetail = hasProcessingModel
    ? t("settings.postProcessing.actions.templates.readyHint", {
        defaultValue:
          "Les actions utiliseront votre configuration de post-traitement actuelle.",
      })
    : t("settings.postProcessing.actions.templates.setupHint", {
        defaultValue:
          "Ajoutez un modèle IA dans Modèles > Post-traitement pour exécuter ces actions.",
      });

  const formatPromptPreview = (prompt: string) =>
    prompt
      .replace(/\s+/g, " ")
      .trim()
      .replace(
        /\$\{output\}/g,
        t("settings.postProcessing.actions.outputPlaceholder", {
          defaultValue: "dictated text",
        }),
      );
  const templates = [
    {
      id: "cleanup",
      icon: <Wand2 size={14} aria-hidden="true" />,
      name: t("settings.postProcessing.actions.templates.cleanup.name", {
        defaultValue: "Corriger",
      }),
      description: t(
        "settings.postProcessing.actions.templates.cleanup.description",
        {
          defaultValue: "Nettoie la dictée sans changer le sens.",
        },
      ),
      prompt: t("settings.postProcessing.actions.templates.cleanup.prompt", {
        defaultValue:
          "Corrige la grammaire, la ponctuation et la clarté du texte suivant sans changer son sens. Garde la langue d'origine. Texte : ${output}",
      }),
    },
    {
      id: "summary",
      icon: <ListChecks size={14} aria-hidden="true" />,
      name: t("settings.postProcessing.actions.templates.summary.name", {
        defaultValue: "Résumé + actions",
      }),
      description: t(
        "settings.postProcessing.actions.templates.summary.description",
        {
          defaultValue: "Transforme une dictée longue en points utiles.",
        },
      ),
      prompt: t("settings.postProcessing.actions.templates.summary.prompt", {
        defaultValue:
          "Résume le texte suivant en quelques points clairs, puis ajoute une section Actions si des tâches sont mentionnées. Texte : ${output}",
      }),
    },
    {
      id: "email",
      icon: <Mail size={14} aria-hidden="true" />,
      name: t("settings.postProcessing.actions.templates.email.name", {
        defaultValue: "Email pro",
      }),
      description: t(
        "settings.postProcessing.actions.templates.email.description",
        {
          defaultValue: "Reformate la dictée en email prêt à envoyer.",
        },
      ),
      prompt: t("settings.postProcessing.actions.templates.email.prompt", {
        defaultValue:
          "Transforme le texte suivant en email professionnel, clair et naturel. Ajoute une salutation si nécessaire, structure les paragraphes et garde le message concis. Texte : ${output}",
      }),
    },
    {
      id: "translate",
      icon: <Languages size={14} aria-hidden="true" />,
      name: t("settings.postProcessing.actions.templates.translate.name", {
        defaultValue: "Traduire en anglais",
      }),
      description: t(
        "settings.postProcessing.actions.templates.translate.description",
        {
          defaultValue: "Traduit proprement en anglais naturel.",
        },
      ),
      prompt: t("settings.postProcessing.actions.templates.translate.prompt", {
        defaultValue:
          "Traduis le texte suivant en anglais naturel et professionnel. Ne rajoute aucun commentaire. Texte : ${output}",
      }),
    },
  ];

  const modelDropdownOptions = [
    {
      value: "__default__",
      label: t("settings.postProcessing.actions.defaultModel"),
    },
    ...savedModels.map((m) => ({
      value: m.id,
      label: m.label,
    })),
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

  const handleStartFromTemplate = (template: {
    name: string;
    prompt: string;
  }) => {
    if (!nextAvailableKey) return;
    setEditingAction({
      key: nextAvailableKey,
      name: template.name,
      prompt: template.prompt,
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
      if (savedModels.some((m) => m.id === id)) {
        savedModelId = id;
      }
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
    } catch (error) {
      console.error("Failed to save action:", error);
    }
  };

  const handleDelete = async (key: number) => {
    try {
      await commands.deletePostProcessAction(key);
      await refreshSettings();
      if (editingAction?.key === key) {
        setEditingAction(null);
      }
    } catch (error) {
      console.error("Failed to delete action:", error);
    }
  };

  return (
    <SettingContainer
      title={
        <span className="flex items-center">
          {t("settings.postProcessing.actions.title")}
          <InfoTooltip content={t("tooltips.postProcessing")} />
        </span>
      }
      description={t("settings.postProcessing.actions.description")}
      descriptionMode="inline"
      layout="stacked"
      grouped={true}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!editingAction && actions.length < 9 && (
          <div
            className="rounded-2xl border border-white/8 bg-white/[0.025]"
            style={{
              padding: "18px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-semibold text-text">
                    {t("settings.postProcessing.actions.templates.title", {
                      defaultValue: "Actions prêtes à l'emploi",
                    })}
                  </p>
                  <span className="inline-flex items-center rounded-[8px] border border-sky-400/18 bg-sky-400/10 px-2 py-1 text-[10px] font-semibold leading-none text-sky-200">
                    {t("settings.postProcessing.actions.templates.llmBadge", {
                      defaultValue: "LLM requis",
                    })}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-[8px] border px-2 py-1 text-[10px] font-semibold leading-none ${
                      hasProcessingModel
                        ? "border-emerald-400/18 bg-emerald-400/10 text-emerald-200"
                        : "border-amber-400/18 bg-amber-400/10 text-amber-200"
                    }`}
                  >
                    {modelStatusLabel}
                  </span>
                </div>
                <p className="max-w-[640px] text-[12px] leading-5 text-text/52">
                  {t("settings.postProcessing.actions.templates.description", {
                    defaultValue:
                      "Installez rapidement les actions les plus utiles : correction, résumé, email pro ou traduction.",
                  })}
                </p>
                <p className="max-w-[680px] text-[11.5px] leading-5 text-sky-200/55">
                  {t("settings.postProcessing.actions.templates.llmHint", {
                    defaultValue:
                      "Ces actions s'appliquent après la dictée et utilisent le modèle configuré dans Post-traitement. La dictée normale reste inchangée.",
                  })}
                </p>
                <p
                  className={`max-w-[680px] text-[11.5px] leading-5 ${
                    hasProcessingModel
                      ? "text-emerald-200/55"
                      : "text-amber-200/62"
                  }`}
                >
                  {modelStatusDetail}
                  {hasProcessingModel && activeProvider?.label
                    ? ` ${activeProvider.label}${activeModel ? ` · ${activeModel}` : ""}`
                    : ""}
                </p>
              </div>
              <Button onClick={handleStartCreate} variant="secondary" size="sm">
                {t("settings.postProcessing.actions.addAction")}
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleStartFromTemplate(template)}
                  className="group min-h-[98px] rounded-[14px] border border-white/8 bg-black/10 text-left transition-all hover:border-logo-primary/26 hover:bg-logo-primary/[0.06]"
                  style={{ padding: "14px" }}
                >
                  <div className="flex h-full flex-col justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/8 bg-white/[0.04] text-white/42 transition-colors group-hover:border-logo-primary/22 group-hover:bg-logo-primary/10 group-hover:text-logo-primary">
                        {template.icon}
                      </span>
                      <span className="text-[12.5px] font-semibold text-text/84 group-hover:text-text">
                        {template.name}
                      </span>
                    </div>
                    <p className="text-[11.5px] leading-5 text-text/42 group-hover:text-text/58">
                      {template.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {actions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                  className="group flex cursor-pointer items-start rounded-xl border border-white/6 bg-white/[0.02] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary"
                  style={{ padding: "12px 16px", gap: 12 }}
                  onClick={() => handleStartEdit(action)}
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[9px] bg-blue-500/15 font-mono text-xs font-bold text-blue-300">
                    {action.key}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-text/88">
                        {action.name}
                      </span>
                      {action.provider_id && action.model && (
                        <span className="shrink-0 rounded-[8px] border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] font-medium leading-none text-white/42">
                          {savedModels.find(
                            (m) =>
                              m.id === `${action.provider_id}:${action.model}`,
                          )?.label || action.model}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-white/34">
                      {formatPromptPreview(action.prompt)}
                    </p>
                  </div>
                  <button
                    style={{ padding: "4px 8px" }}
                    className="shrink-0 text-xs text-mid-gray/60 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
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

        {actions.length === 0 && !editingAction && (
          <div
            className="rounded-2xl border border-white/10 bg-white/[0.03]"
            style={{ padding: "24px" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-logo-primary/20 bg-logo-primary/10 text-logo-primary">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <p className="text-sm font-semibold text-text">
                  {t("settings.postProcessing.actions.noActions")}
                </p>
                <p className="text-sm leading-6 text-text/60">
                  {t("settings.postProcessing.actions.createFirst")}
                </p>
              </div>
              <Button
                onClick={handleStartCreate}
                variant="primary-soft"
                size="md"
              >
                {t("settings.postProcessing.actions.addAction")}
              </Button>
            </div>
          </div>
        )}

        {editingAction && (
          <div
            className="rounded-2xl border border-white/10 bg-white/[0.03]"
            style={{
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label className="text-sm font-semibold">
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
                  className="w-10 h-8 rounded bg-blue-500/15 text-blue-400 text-sm font-bold font-mono text-center appearance-none cursor-pointer border border-transparent hover:border-blue-400/40 transition-colors"
                >
                  {availableKeysForEditing.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  flex: 1,
                }}
              >
                <label className="text-sm font-semibold">
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

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="text-sm font-semibold">
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
              <p className="text-xs text-mid-gray/70">
                <Trans
                  i18nKey="settings.postProcessing.actions.promptTip"
                  components={{ code: <code /> }}
                />
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="text-sm font-semibold">
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
              <p className="text-xs text-mid-gray/70">
                {t("settings.postProcessing.actions.modelTip")}
              </p>
            </div>

            <div
              className="rounded-[14px] border border-sky-400/12 bg-sky-400/[0.06] text-[12px] leading-6 text-sky-100/62"
              style={{ padding: "12px 14px" }}
            >
              {t("settings.postProcessing.actions.llmExecutionHint", {
                defaultValue:
                  "Cette action ne modifie pas la capture vocale. Elle transforme seulement le texte final avec le modèle IA configuré.",
              })}
            </div>

            <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
              <Button
                onClick={handleSave}
                variant="primary"
                size="md"
                disabled={
                  !editingAction.name.trim() || !editingAction.prompt.trim()
                }
              >
                {t("settings.postProcessing.actions.save")}
              </Button>
              <Button
                onClick={() => setEditingAction(null)}
                variant="secondary"
                size="md"
              >
                {t("settings.postProcessing.actions.cancel")}
              </Button>
              {!editingAction.isNew && (
                <Button
                  onClick={() =>
                    handleDelete(editingAction.originalKey ?? editingAction.key)
                  }
                  variant="secondary"
                  size="md"
                >
                  {t("settings.postProcessing.actions.delete")}
                </Button>
              )}
            </div>
          </div>
        )}

        {!editingAction && actions.length > 0 && actions.length < 9 && (
          <Button onClick={handleStartCreate} variant="primary" size="md">
            {t("settings.postProcessing.actions.addAction")}
          </Button>
        )}

        {actions.length >= 9 && !editingAction && (
          <p className="text-xs text-mid-gray/60">
            {t("settings.postProcessing.actions.maxActionsReached")}
          </p>
        )}
      </div>
    </SettingContainer>
  );
};

const PostProcessingActions = React.memo(PostProcessingActionsComponent);
PostProcessingActions.displayName = "PostProcessingActions";

export const PostProcessingSettings: React.FC = () => {
  return (
    <div className="w-full">
      <SettingsGroup>
        <PostProcessingActions />
      </SettingsGroup>
    </div>
  );
};

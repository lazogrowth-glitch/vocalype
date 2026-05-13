import React, { useCallback, useMemo, useState } from "react";
import type { PostProcessAction } from "@/bindings";
import { commands } from "@/bindings";
import { Textarea } from "@/components/ui";
import {
  Check,
  CheckCircle,
  ClipboardList,
  Copy,
  FileText,
  Linkedin,
  Mail,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";
import { usePlan } from "@/lib/subscription/context";
import { authClient } from "@/lib/auth/client";
import { mapSharedTemplates } from "@/lib/subscription/workspace";

type EditingAction = {
  key: number;
  originalKey?: number;
  name: string;
  prompt: string;
  isNew: boolean;
};

type ActionPreset = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  badge?: string;
  icon: React.ReactNode;
  toneClass: string;
  sampleInput: string;
  sampleOutputTitle: string;
  sampleOutputBody: string[];
};

const getPromptPreview = (prompt: string, outputPlaceholder: string) =>
  prompt
    .replace(/\$\{output\}/g, outputPlaceholder)
    .replace(/\s+/g, " ")
    .trim();

const getPromptExcerpt = (prompt: string) =>
  prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

const getActionPresetId = (
  action: Pick<PostProcessAction, "name" | "prompt">,
): string => {
  const haystack = `${action.name} ${action.prompt}`.toLowerCase();
  if (
    haystack.includes("linkedin") ||
    haystack.includes("sourcing") ||
    haystack.includes("outreach")
  ) {
    return "linkedin_message";
  }
  if (haystack.includes("email") || haystack.includes("mail")) {
    return "email_candidate";
  }
  if (
    haystack.includes("summary") ||
    haystack.includes("resume client") ||
    haystack.includes("client-ready")
  ) {
    return "client_summary";
  }
  if (
    haystack.includes("correct") ||
    haystack.includes("clean") ||
    haystack.includes("gramma") ||
    haystack.includes("punctuation")
  ) {
    return "cleanup";
  }
  return "candidate_note";
};

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings, settings } = useSettings();
  const { capabilities, openUpgradePlans, teamWorkspace, updateTeamWorkspace } = usePlan();
  const [editingAction, setEditingAction] = useState<EditingAction | null>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);

  const canManageWorkspace =
    teamWorkspace?.currentUserRole === "owner" ||
    teamWorkspace?.currentUserRole === "admin";

  const [wsLoading, setWsLoading] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplPrompt, setTplPrompt] = useState("");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);

  const handleEditTemplate = useCallback(
    (id: string) => {
      const tpl = teamWorkspace?.sharedTemplates.find((t) => t.id === id);
      if (!tpl) return;
      setTplName(tpl.name);
      setTplDesc(tpl.description ?? "");
      setTplPrompt(tpl.prompt);
      setEditingTplId(tpl.id);
    },
    [teamWorkspace],
  );

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageWorkspace) return;
      const previousWorkspace = teamWorkspace;
      setWsLoading(true);
      updateTeamWorkspace((cur) =>
        cur
          ? {
              ...cur,
              sharedTemplates: cur.sharedTemplates.filter((template) => template.id !== id),
            }
          : cur,
      );
      try {
        const res = await authClient.removeWorkspaceTemplate(token, id);
        updateTeamWorkspace((cur) =>
          cur ? { ...cur, sharedTemplates: mapSharedTemplates(res.templates) } : cur,
        );
        if (editingTplId === id) {
          setTplName(""); setTplDesc(""); setTplPrompt(""); setEditingTplId(null);
        }
      } catch (err) {
        console.error("Failed to remove workspace template:", err);
        updateTeamWorkspace(previousWorkspace);
      } finally {
        setWsLoading(false);
      }
    },
    [canManageWorkspace, editingTplId, teamWorkspace, updateTeamWorkspace],
  );

  const handleSaveTemplate = useCallback(async () => {
    const token = authClient.getStoredToken();
    const name = tplName.trim();
    const prompt = tplPrompt.trim();
    if (!token || !teamWorkspace || !canManageWorkspace || !name || !prompt) return;
    const previousWorkspace = teamWorkspace;
    const description = tplDesc.trim() || "";
    const optimisticId = editingTplId ?? `template-${crypto.randomUUID()}`;
    setWsLoading(true);
    updateTeamWorkspace((cur) =>
      cur
        ? {
            ...cur,
            sharedTemplates: editingTplId
              ? cur.sharedTemplates.map((template) =>
                  template.id === editingTplId
                    ? { ...template, name, description, prompt }
                    : template,
                )
              : [
                  {
                    id: optimisticId,
                    name,
                    description,
                    prompt,
                  },
                  ...cur.sharedTemplates,
                ],
          }
        : cur,
    );
    setTplName("");
    setTplDesc("");
    setTplPrompt("");
    setEditingTplId(null);
    try {
      const res = editingTplId
        ? await authClient.updateWorkspaceTemplate(token, editingTplId, {
            name, description: description || undefined, prompt,
          })
        : await authClient.addWorkspaceTemplate(token, {
            name, description: description || undefined, prompt,
          });
      updateTeamWorkspace((cur) =>
        cur ? { ...cur, sharedTemplates: mapSharedTemplates(res.templates) } : cur,
      );
    } catch (err) {
      console.error("Failed to save workspace template:", err);
      updateTeamWorkspace(previousWorkspace);
      setTplName(name);
      setTplDesc(description);
      setTplPrompt(prompt);
      setEditingTplId(editingTplId);
    } finally {
      setWsLoading(false);
    }
  }, [canManageWorkspace, editingTplId, tplDesc, tplName, tplPrompt, teamWorkspace, updateTeamWorkspace]);

  const outputPlaceholder = t("settings.postProcessing.actions.outputPlaceholder", {
    defaultValue: "dictated text",
  });

  const presets: ActionPreset[] = [
    {
      id: "candidate_note",
      icon: <ClipboardList size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.candidateNote.name"),
      description: t(
        "settings.postProcessing.actions.templates.candidateNote.description",
      ),
      badge: "ATS",
      toneClass: "voca-tone-gold",
      prompt:
        "Transform the dictated text into a clean recruiter ATS note.\n\nKeep the same language as the source.\n\nStructure the output with:\n- Candidate summary\n- Experience / background\n- Key skills\n- Motivation\n- Salary / availability if mentioned\n- Concerns / risks if mentioned\n- Next step\n\nDo not invent information. If something is not mentioned, omit it. Return only the final ATS note.\n\nText:\n${output}",
      sampleInput:
        "J'ai eu Sarah au telephone, 5 ans d'experience en B2B SaaS, maitrise Salesforce et HubSpot, cherche un poste hybride et vise 65 a 75K. Prochaine etape: lui envoyer la fourchette et planifier un call client.",
      sampleOutputTitle: "Note candidat",
      sampleOutputBody: [
        "5 ans d'experience en B2B SaaS",
        "Maitrise Salesforce + HubSpot",
        "Recherche un poste hybride",
        "Pretentions: 65-75K base",
        "Next step: envoyer la fourchette puis planifier un call client.",
      ],
    },
    {
      id: "email_candidate",
      icon: <Mail size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.emailCandidate.name"),
      description: t(
        "settings.postProcessing.actions.templates.emailCandidate.description",
      ),
      toneClass: "voca-tone-green",
      prompt:
        "Transform the dictated text into a clear, professional email to a candidate.\n\nKeep the same language as the source.\nMake it concise, polite, and natural.\nDo not add fake details.\nReturn only the email body, no subject line.\n\nText:\n${output}",
      sampleInput:
        "Remercie Sarah pour l'appel, dis-lui qu'on partage son profil demain au client et propose un point jeudi apres-midi.",
      sampleOutputTitle: "Email candidat",
      sampleOutputBody: [
        "Bonjour Sarah,",
        "Merci encore pour notre appel aujourd'hui.",
        "Je partage votre profil demain au client.",
        "Je vous propose un point jeudi apres-midi pour la suite.",
      ],
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
      toneClass: "voca-tone-blue",
      prompt:
        "Transform the dictated text into a short, natural LinkedIn message for recruiting.\n\nKeep it concise.\nMake it human, direct, and not too salesy.\nKeep the same language as the source.\nDo not exaggerate or invent details.\nReturn only the message.\n\nText:\n${output}",
      sampleInput:
        "Salut Thomas, j'ai un role AE senior a Montreal dans une equipe SaaS en croissance, ton parcours pourrait coller, ouvert a en parler 10 minutes ?",
      sampleOutputTitle: "Message LinkedIn",
      sampleOutputBody: [
        "Salut Thomas,",
        "Je recrute un AE senior a Montreal dans une equipe SaaS en croissance.",
        "Ton parcours m'a fait penser a cette opportunite.",
        "Ouvert a un rapide echange cette semaine ?",
      ],
    },
    {
      id: "client_summary",
      icon: <FileText size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.clientSummary.name"),
      description: t(
        "settings.postProcessing.actions.templates.clientSummary.description",
      ),
      toneClass: "voca-tone-rose",
      prompt:
        "Transform the dictated text into a professional candidate summary for a client.\n\nKeep the same language as the source.\nMake it clear, concise, and business-oriented.\nStructure it with:\n- Candidate profile\n- Relevant experience\n- Why they may fit the role\n- Key strengths\n- Possible concerns if mentioned\n- Recommended next step\n\nDo not invent information. Return only the client-ready summary.\n\nText:\n${output}",
      sampleInput:
        "Sarah a dirige des cycles de vente complexes en SaaS B2B, connait bien le mid-market, bonne energie, anglais fluent, point a clarifier: preavis de 6 semaines.",
      sampleOutputTitle: "Resume client",
      sampleOutputBody: [
        "Experience solide en vente B2B SaaS",
        "Bonne exposition mid-market",
        "Anglais fluent",
        "Point a clarifier: preavis de 6 semaines",
      ],
    },
    {
      id: "cleanup",
      icon: <Check size={18} aria-hidden="true" />,
      label: t("settings.postProcessing.actions.templates.cleanup.name", {
        defaultValue: "Correct",
      }),
      description: t(
        "settings.postProcessing.actions.templates.cleanup.description",
        {
          defaultValue: "Cleans up dictation without changing the meaning.",
        },
      ),
      toneClass: "voca-tone-lime",
      prompt: t("settings.postProcessing.actions.templates.cleanup.prompt", {
        defaultValue:
          "Fix the grammar, punctuation, and clarity of the following text without changing its meaning. Keep the original language. Text: ${output}",
      }),
      sampleInput:
        "bonjour Sarah merci pour ton temps ajd on reviens vers toi demain avec la suite",
      sampleOutputTitle: "Texte corrige",
      sampleOutputBody: [
        "Bonjour Sarah,",
        "Merci pour ton temps aujourd'hui.",
        "Je reviens vers toi demain avec la suite.",
      ],
    },
  ];

  const actions = (getSetting("post_process_actions") || []) as PostProcessAction[];
  const maxActionSlots = capabilities.maxActionSlots;
  const visibleSlotCount = Math.max(maxActionSlots, 1);
  const sortedActions = useMemo(
    () =>
      [...actions]
        .sort((a, b) => a.key - b.key)
        .filter((action) => action.key <= maxActionSlots),
    [actions, maxActionSlots],
  );
  const usedKeys = new Set(sortedActions.map((action) => action.key));
  const nextAvailableKey = Array.from(
    { length: maxActionSlots },
    (_, index) => index + 1,
  ).find((key) => !usedKeys.has(key));
  const resolvedSelectedKey =
    selectedKey && usedKeys.has(selectedKey)
      ? selectedKey
      : sortedActions[0]?.key ?? nextAvailableKey ?? 1;
  const selectedAction =
    sortedActions.find((action) => action.key === resolvedSelectedKey) ?? null;
  const selectedPreset =
    presets.find(
      (preset) =>
        preset.id ===
        (selectedAction ? getActionPresetId(selectedAction) : "candidate_note"),
    ) ?? presets[0];

  const providerId =
    selectedAction?.provider_id ||
    settings?.post_process_provider_id ||
    "vocalype-cloud";
  const providerLabel =
    settings?.post_process_providers?.find(
      (provider) => provider.id === providerId,
    )?.label ||
    (providerId === "vocalype-cloud" ? "Vocalype Cloud" : providerId);
  const isCloudActive =
    settings?.post_process_enabled === true &&
    settings?.post_process_provider_id === "vocalype-cloud";
  const availableKeysForEditing = Array.from(
    { length: maxActionSlots },
    (_, index) => index + 1,
  )
    .filter(
      (key) =>
        !usedKeys.has(key) ||
        key === editingAction?.key ||
        key === editingAction?.originalKey,
    )
    .map((key) => ({ value: String(key), label: String(key) }));

  const handleStartCreate = (preferredKey?: number) => {
    if (maxActionSlots === 0) {
      openUpgradePlans();
      return;
    }
    const targetKey =
      preferredKey && !usedKeys.has(preferredKey) ? preferredKey : nextAvailableKey;
    if (!targetKey) return;
    setEditingAction({
      key: targetKey,
      name: "",
      prompt: "",
      isNew: true,
    });
    setSelectedKey(targetKey);
  };

  const handleStartFromTemplate = (
    preset: Pick<ActionPreset, "label" | "prompt">,
    preferredKey?: number,
  ) => {
    if (maxActionSlots === 0) {
      openUpgradePlans();
      return;
    }
    const targetKey =
      preferredKey && !usedKeys.has(preferredKey) ? preferredKey : nextAvailableKey;
    if (!targetKey) return;
    setEditingAction({
      key: targetKey,
      name: preset.label,
      prompt: preset.prompt,
      isNew: true,
    });
    setSelectedKey(targetKey);
  };

  const handleStartEdit = (action: PostProcessAction) => {
    setEditingAction({
      key: action.key,
      originalKey: action.key,
      name: action.name,
      prompt: action.prompt,
      isNew: false,
    });
    setSelectedKey(action.key);
  };

  const handleDuplicate = (action: PostProcessAction) => {
    if (!nextAvailableKey) return;
    setEditingAction({
      key: nextAvailableKey,
      name: `${action.name} Copy`,
      prompt: action.prompt,
      isNew: true,
    });
    setSelectedKey(nextAvailableKey);
  };

  const handleSave = async () => {
    if (
      !editingAction ||
      !editingAction.name.trim() ||
      !editingAction.prompt.trim()
    ) {
      return;
    }

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
      setSelectedKey(editingAction.key);
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
      if (selectedKey === key) {
        setSelectedKey(sortedActions.find((action) => action.key !== key)?.key ?? null);
      }
    } catch (error) {
      console.error("Failed to delete action:", error);
    }
  };

  const teamTemplateItems =
    capabilities.hasSharedTemplates && teamWorkspace
      ? teamWorkspace.sharedTemplates
          .map((template) => ({
            ...template,
            onClick: () => handleStartFromTemplate({ label: template.name, prompt: template.prompt }),
          }))
      : [];

  return (
    <div className="voca-actions-page">
      <section className="voca-actions-rail-wrap">
        <div className="voca-actions-rail-head">
          <div className="voca-actions-rail-meta">
            <span className="voca-label-caps">
              {t("settings.postProcessing.actions.configuredLabel", {
                defaultValue: "Configured actions",
              })}
            </span>
            <span className="voca-actions-rail-hint">
              {t("settings.postProcessing.actions.description", {
                defaultValue:
                  "Press Ctrl + number during dictation to transform your text.",
              })}
            </span>
          </div>
          <div className="voca-actions-rail-count">
            <b>{sortedActions.length}</b> / {maxActionSlots}
          </div>
        </div>

        {maxActionSlots < 9 ? (
          <div
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(201,168,76,0.18)",
              background: "rgba(201,168,76,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                color: "rgba(255,245,214,0.82)",
                lineHeight: 1.45,
              }}
            >
              {capabilities.plan === "independent"
                ? "Independent inclut 2 actions IA et 3 templates recruteur."
                : "Cette formule ne debloque pas encore les actions IA."}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={openUpgradePlans}>
              Upgrade
            </Button>
          </div>
        ) : null}

        <div className="voca-actions-rail">
          <div className="voca-actions-ctrl">
            <div className="voca-actions-ctrl-spacer" />
            <div className="voca-actions-keycap is-ctrl">Ctrl</div>
          </div>

          {Array.from({ length: visibleSlotCount }, (_, index) => index + 1).map((slotKey) => {
            const action = sortedActions.find((item) => item.key === slotKey) ?? null;
            const preset = action
              ? presets.find((item) => item.id === getActionPresetId(action)) ||
                presets[0]
              : null;
            const isSelected = resolvedSelectedKey === slotKey && action !== null;

            return (
              <button
                key={slotKey}
                type="button"
                className={`voca-actions-slot${action ? "" : " is-empty"}${isSelected ? " is-selected" : ""}`}
                onClick={() => {
                  if (action) {
                    setSelectedKey(slotKey);
                    return;
                  }
                  handleStartCreate(slotKey);
                }}
              >
                <div className={`voca-actions-slot-chip${preset ? ` ${preset.toneClass}` : ""}`}>
                  {action ? (
                    <>
                      <div className="voca-actions-slot-topline">
                        <span className={`voca-actions-slot-icon ${preset?.toneClass ?? ""}`}>
                          {preset?.icon}
                        </span>
                        {preset?.badge ? (
                          <span className="voca-actions-slot-badge">
                            {preset.badge}
                          </span>
                        ) : null}
                      </div>
                      <span className="voca-actions-slot-name">{action.name}</span>
                    </>
                  ) : (
                    <span className="voca-actions-slot-empty">
                      <Plus size={16} aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className={`voca-actions-keycap${isSelected ? " is-selected" : ""}`}>
                  {slotKey}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="voca-actions-workbench">
        <section className="voca-actions-inspector">
          <div className="voca-actions-inspector-head">
            <div className="voca-actions-inspector-pills">
              <span className="voca-actions-pill voca-actions-pill-gold">
                {selectedAction ? `Ctrl + ${selectedAction.key}` : "New action"}
              </span>
              <span className="voca-actions-pill">{providerLabel}</span>
            </div>

            <div className="voca-actions-inspector-main">
              <div className={`voca-actions-inspector-icon ${selectedPreset.toneClass}`}>
                {selectedPreset.icon}
              </div>

              <div className="voca-actions-inspector-copy">
                <h3 className="voca-actions-inspector-title">
                  {selectedAction?.name ||
                    t("settings.postProcessing.actions.noActions", {
                      defaultValue: "No actions configured yet.",
                    })}
                </h3>
                <p className="voca-actions-inspector-desc">
                  {selectedAction
                    ? selectedAction.description || selectedPreset.description
                    : t("settings.postProcessing.actions.createFirst", {
                        defaultValue:
                          "Create your first action to process transcriptions with your configured provider.",
                      })}
                </p>
              </div>

              {selectedAction ? (
                <div className="voca-actions-inspector-tools">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDuplicate(selectedAction)}
                    disabled={!nextAvailableKey}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleStartEdit(selectedAction)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                    {t("settings.postProcessing.actions.editAction", {
                      defaultValue: "Edit action",
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => void handleDelete(selectedAction.key)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="voca-actions-inspector-body">
            <div className="voca-actions-demo">
              <div className="voca-actions-demo-column">
                <div className="voca-actions-demo-head">
                  <span className="voca-actions-demo-dot" />
                  Dictée brute
                </div>
                <p className="voca-actions-demo-raw">{selectedPreset.sampleInput}</p>
              </div>

              <div className="voca-actions-demo-column is-output">
                <div className="voca-actions-demo-head">
                  <span className="voca-actions-demo-dot is-output" />
                  {selectedPreset.sampleOutputTitle}
                </div>
                <div className="voca-actions-demo-output">
                  <ul>
                    {selectedPreset.sampleOutputBody.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="voca-actions-grid-two">
              <div className="voca-actions-info-card">
                <h4>
                  {t("settings.postProcessing.actions.prompt", {
                    defaultValue: "Prompt",
                  })}
                </h4>
                <p>
                  {getPromptPreview(
                    selectedAction?.prompt || selectedPreset.prompt,
                    outputPlaceholder,
                  )}
                </p>
              </div>
              <div className="voca-actions-info-card">
                <h4>${"{output}"}</h4>
                <p>
                  <Trans
                    i18nKey="settings.postProcessing.actions.promptTip"
                    components={{ code: <code /> }}
                  />
                </p>
              </div>
            </div>

            <div className="voca-actions-code-card">
              <div className="voca-actions-code-head">
                <span className="voca-label-caps">
                  {t("settings.postProcessing.actions.prompt", {
                    defaultValue: "Prompt",
                  })}
                </span>
                <span className="voca-actions-code-meta">{providerLabel}</span>
              </div>
              <pre>
                {getPromptExcerpt(selectedAction?.prompt || selectedPreset.prompt).join(
                  "\n",
                )}
              </pre>
            </div>
          </div>
        </section>

        <aside className="voca-actions-sidebar">
          {editingAction ? (
            <section className="voca-actions-editor">
              <div className="voca-actions-side-head">
                <span className="voca-actions-side-title">
                  {editingAction.isNew
                    ? t("settings.postProcessing.actions.addAction", {
                        defaultValue: "Add action",
                      })
                    : t("settings.postProcessing.actions.editAction", {
                        defaultValue: "Edit action",
                      })}
                </span>
              </div>

              <div className="voca-actions-editor-body">
                <div className="voca-actions-form-row">
                  <div className="voca-actions-field voca-actions-field-short">
                    <label className="voca-label-caps">
                      {t("settings.postProcessing.actions.key", {
                        defaultValue: "Key",
                      })}
                    </label>
                    <Dropdown
                      selectedValue={String(editingAction.key)}
                      onSelect={(value) =>
                        setEditingAction({
                          ...editingAction,
                          key: Number(value),
                        })
                      }
                      options={availableKeysForEditing}
                    />
                  </div>

                  <div className="voca-actions-field">
                    <label className="voca-label-caps">
                      {t("settings.postProcessing.actions.name", {
                        defaultValue: "Name",
                      })}
                    </label>
                    <Input
                      type="text"
                      value={editingAction.name}
                      onChange={(event) =>
                        setEditingAction({
                          ...editingAction,
                          name: event.target.value,
                        })
                      }
                      placeholder={t("settings.postProcessing.actions.namePlaceholder", {
                        defaultValue: "e.g. Email mode",
                      })}
                      variant="compact"
                    />
                  </div>
                </div>

                <div className="voca-actions-field">
                  <label className="voca-label-caps">
                    {t("settings.postProcessing.actions.prompt", {
                      defaultValue: "Prompt",
                    })}
                  </label>
                  <Textarea
                    value={editingAction.prompt}
                    onChange={(event) =>
                      setEditingAction({
                        ...editingAction,
                        prompt: event.target.value,
                      })
                    }
                    placeholder={t(
                      "settings.postProcessing.actions.promptPlaceholder",
                      {
                        defaultValue:
                          "Format this as a professional email with greeting and sign-off.",
                      },
                    )}
                  />
                  <p className="voca-actions-field-hint">
                    <Trans
                      i18nKey="settings.postProcessing.actions.promptTip"
                      components={{ code: <code /> }}
                    />
                  </p>
                </div>

                <div
                  className={`voca-actions-inline-note${isCloudActive ? " is-active" : ""}`}
                >
                  {isCloudActive ? (
                    <CheckCircle size={13} aria-hidden="true" />
                  ) : (
                    <Zap size={13} aria-hidden="true" />
                  )}
                  <span>
                    {isCloudActive
                      ? t("settings.postProcessing.modelPicker.cloudActive", {
                          defaultValue: "Vocalype Cloud active",
                        })
                      : t("settings.postProcessing.modelPicker.enableCloud", {
                          defaultValue: "Enable Vocalype Cloud from Settings.",
                        })}
                  </span>
                </div>

                <div className="voca-actions-editor-actions">
                  <Button
                    onClick={() => void handleSave()}
                    variant="primary"
                    size="sm"
                    disabled={
                      !editingAction.name.trim() || !editingAction.prompt.trim()
                    }
                  >
                    {t("settings.postProcessing.actions.save", {
                      defaultValue: "Save",
                    })}
                  </Button>
                  <Button
                    onClick={() => setEditingAction(null)}
                    variant="secondary"
                    size="sm"
                  >
                    {t("settings.postProcessing.actions.cancel", {
                      defaultValue: "Cancel",
                    })}
                  </Button>
                  {!editingAction.isNew ? (
                    <Button
                      onClick={() =>
                        void handleDelete(
                          editingAction.originalKey ?? editingAction.key,
                        )
                      }
                      variant="danger-ghost"
                      size="sm"
                    >
                      {t("settings.postProcessing.actions.delete", {
                        defaultValue: "Delete",
                      })}
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {(teamTemplateItems.length > 0 || canManageWorkspace) ? (
            <section className="voca-actions-library">
              <div className="voca-actions-side-head">
                <span className="voca-actions-side-title">Templates d'équipe</span>
                <span className="voca-actions-side-count">{teamTemplateItems.length}</span>
              </div>
              <div style={{ padding: 12, display: "grid", gap: 8 }}>
                {teamTemplateItems.length > 0 ? (
                  <div className="voca-actions-library-list" style={{ padding: 0 }}>
                    {teamTemplateItems.map((item) => (
                      <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          type="button"
                          className="voca-actions-library-row"
                          onClick={item.onClick}
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          <span className="voca-actions-library-icon voca-tone-green">
                            <ClipboardList size={17} aria-hidden="true" />
                          </span>
                          <span className="voca-actions-library-copy">
                            <span className="voca-actions-library-name">{item.name}</span>
                            <span className="voca-actions-library-desc">{item.description}</span>
                          </span>
                        </button>
                        {canManageWorkspace ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditTemplate(item.id)}
                              disabled={wsLoading}
                              style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.46)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteTemplate(item.id)}
                              disabled={wsLoading}
                              style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.46)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {canManageWorkspace ? (
                  <div style={{ display: "grid", gap: 6, paddingTop: teamTemplateItems.length ? 4 : 0 }}>
                    <input
                      type="text"
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder="Nom du template"
                      disabled={wsLoading}
                      style={{ height: 32, borderRadius: 7, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.94)", padding: "0 10px", fontSize: 12, fontFamily: "inherit" }}
                    />
                    <input
                      type="text"
                      value={tplDesc}
                      onChange={(e) => setTplDesc(e.target.value)}
                      placeholder="Description courte"
                      disabled={wsLoading}
                      style={{ height: 32, borderRadius: 7, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.94)", padding: "0 10px", fontSize: 12, fontFamily: "inherit" }}
                    />
                    <textarea
                      value={tplPrompt}
                      onChange={(e) => setTplPrompt(e.target.value)}
                      placeholder="Prompt partagé pour toute l'équipe"
                      disabled={wsLoading}
                      rows={3}
                      style={{ borderRadius: 7, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.94)", padding: "8px 10px", fontSize: 12, fontFamily: "inherit", resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => void handleSaveTemplate()}
                        disabled={wsLoading || !tplName.trim() || !tplPrompt.trim()}
                        style={{ flex: 1, height: 30, borderRadius: 7, border: "1px solid rgba(201,168,76,0.26)", background: "rgba(201,168,76,0.10)", color: "#d8b866", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: wsLoading || !tplName.trim() || !tplPrompt.trim() ? 0.45 : 1 }}
                      >
                        {editingTplId ? "Enregistrer" : "+ Ajouter"}
                      </button>
                      {editingTplId ? (
                        <button
                          type="button"
                          onClick={() => { setTplName(""); setTplDesc(""); setTplPrompt(""); setEditingTplId(null); }}
                          disabled={wsLoading}
                          style={{ height: 30, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.56)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Annuler
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
};

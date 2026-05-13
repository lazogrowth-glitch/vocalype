import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Building2,
  CreditCard,
  Download,
  ExternalLink,
  Layers,
  Pencil,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { commands, type HistoryStats } from "@/bindings";
import { authClient } from "@/lib/auth/client";
import type { AuthSession } from "@/lib/auth/types";
import { usePlan } from "@/lib/subscription/context";
import {
  mapSharedDictionary,
  mapSharedSnippets,
  mapSharedTemplates,
  mapTeamWorkspacePayload,
} from "@/lib/subscription/workspace";
import type { TeamRole } from "@/lib/subscription/contracts";

type TeamFeatureCell = {
  label: string;
  tone?: "neutral" | "good";
};

type TeamFeatureRow = {
  feature: string;
  independent: TeamFeatureCell;
  powerUser: TeamFeatureCell;
  smallAgency: TeamFeatureCell;
};

function formatDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "\u2014";
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function getPlanPrice(plan: string): string | null {
  switch (plan) {
    case "independent":
      return "CA$12";
    case "power_user":
      return "CA$24";
    case "small_agency":
      return "CA$18";
    default:
      return null;
  }
}

function buildPlanComparisonRows(
  t: (key: string, options?: Record<string, unknown>) => string,
): TeamFeatureRow[] {
  return [
    {
      feature: t("billing.comparison.rows.unlimitedDictation"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.pasteAnywhere"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.localOffline"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.platforms"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.microphoneShortcut"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.languageDetection"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.simpleHistory"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.unlimitedHistory"),
      independent: { label: t("billing.comparison.values.limited") },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.historyExport"),
      independent: { label: t("billing.comparison.values.basic") },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.customWords"),
      independent: {
        label: t("billing.comparison.values.personal"),
        tone: "good",
      },
      powerUser: {
        label: t("billing.comparison.values.personalAdvanced"),
        tone: "good",
      },
      smallAgency: {
        label: t("billing.comparison.values.personalTeam"),
        tone: "good",
      },
    },
    {
      feature: t("billing.comparison.rows.adaptiveVocabulary"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.recruiterTemplates"),
      independent: { label: t("billing.comparison.values.threeTemplates") },
      powerUser: {
        label: t("billing.comparison.values.allTemplates"),
        tone: "good",
      },
      smallAgency: {
        label: t("billing.comparison.values.sharedTemplates"),
        tone: "good",
      },
    },
    {
      feature: t("billing.comparison.rows.customActions"),
      independent: { label: t("billing.comparison.values.oneToTwoMax") },
      powerUser: { label: t("billing.comparison.values.nineActions"), tone: "good" },
      smallAgency: {
        label: t("billing.comparison.values.nineSharedActions"),
        tone: "good",
      },
    },
    {
      feature: t("billing.comparison.rows.cloudPostProcessing"),
      independent: { label: t("billing.comparison.values.limitedOptional") },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.privateMode"),
      independent: { label: t("billing.comparison.values.yes"), tone: "good" },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.audioImport"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.reprocessHistory"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.advancedStats"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.yes"), tone: "good" },
      smallAgency: { label: t("billing.comparison.values.team"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.sharedRecruiterTemplates"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.no") },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.sharedDictionary"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.no") },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.seatManagement"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.no") },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.centralBilling"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.no") },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.prioritySupport"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.normal") },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
    {
      feature: t("billing.comparison.rows.adminControls"),
      independent: { label: t("billing.comparison.values.no") },
      powerUser: { label: t("billing.comparison.values.no") },
      smallAgency: { label: t("billing.comparison.values.yes"), tone: "good" },
    },
  ];
}

function FeatureCell({ cell }: { cell: TeamFeatureCell }) {
  const isGood = cell.tone === "good";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 32,
        padding: "6px 10px",
        borderRadius: 8,
        background: isGood ? "rgba(52,211,153,0.10)" : "rgba(255,255,255,0.03)",
        border: isGood
          ? "1px solid rgba(52,211,153,0.22)"
          : "1px solid rgba(255,255,255,0.06)",
        color: isGood ? "#8ef0bf" : "rgba(255,255,255,0.72)",
        fontSize: 12.5,
        fontWeight: isGood ? 600 : 500,
        lineHeight: 1.3,
        textAlign: "center",
      }}
    >
      {cell.label}
    </span>
  );
}

function UsageCard({
  label,
  used,
  limit,
  footer,
  locale,
}: {
  label: string;
  used: number;
  limit: number;
  footer: string;
  locale?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isHigh = pct >= 80;

  return (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.018)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "rgba(255,255,255,0.38)",
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11.5,
            color: isHigh ? "#f59e0b" : "rgba(255,255,255,0.38)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: isHigh ? 600 : 400,
          }}
        >
          {pct} %
        </span>
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "rgba(255,255,255,0.94)",
          fontVariantNumeric: "tabular-nums",
          display: "flex",
          alignItems: "baseline",
          gap: 6,
        }}
      >
        {used.toLocaleString(locale)}
        <span
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.38)",
            fontWeight: 500,
          }}
        >
          / {limit.toLocaleString(locale)}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: isHigh
              ? "linear-gradient(90deg, #f59e0b, #fcd34d)"
              : "linear-gradient(90deg, #c9a84c, #e8c87a)",
            boxShadow: isHigh
              ? "0 0 8px rgba(245,158,11,0.4)"
              : "0 0 8px rgba(201,168,76,0.4)",
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.38)" }}>
        {footer}
      </div>
    </div>
  );
}

function PlanComparisonModal({
  open,
  onClose,
  rows,
  t,
}: {
  open: boolean;
  onClose: () => void;
  rows: TeamFeatureRow[];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (!open) return null;

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "52px 28px 20px",
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          width: "min(1240px, 100%)",
          maxHeight: "calc(100vh - 68px)",
          overflow: "hidden",
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "#12110f",
          boxShadow: "0 30px 120px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "22px 24px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "rgba(255,255,255,0.94)",
              }}
            >
              {t("billing.comparison.modalTitle")}
            </h2>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 13.5,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.42)",
              }}
            >
              {t("billing.comparison.modalSubtitle")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.72)",
              fontSize: 18,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ overflow: "auto", padding: "0 0 8px" }}>
          <div
            style={{
              minWidth: 1020,
              margin: "0 24px 24px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.018)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.45fr 1fr 1fr 1fr",
                gap: 12,
                padding: "16px 18px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                background:
                  "linear-gradient(180deg, rgba(201,168,76,0.05), rgba(255,255,255,0.01))",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                {t("billing.comparison.feature")}
              </div>
              {[
                t("billing.comparison.columns.independent"),
                t("billing.comparison.columns.powerUser"),
                t("billing.comparison.columns.smallAgency"),
              ].map((label) => (
                <div
                  key={label}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    color: "rgba(255,255,255,0.94)",
                    textAlign: "center",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            {rows.map((row, index) => (
              <div
                key={row.feature}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.45fr 1fr 1fr 1fr",
                  gap: 12,
                  padding: "12px 18px",
                  borderBottom:
                    index === rows.length - 1
                      ? "none"
                      : "1px solid rgba(255,255,255,0.05)",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.86)",
                    lineHeight: 1.4,
                  }}
                >
                  {row.feature}
                </div>
                <FeatureCell cell={row.independent} />
                <FeatureCell cell={row.powerUser} />
                <FeatureCell cell={row.smallAgency} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function roleLabel(
  role: TeamRole,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  switch (role) {
    case "owner":
      return t("billing.workspace.roles.owner");
    case "admin":
      return t("billing.workspace.roles.admin");
    default:
      return t("billing.workspace.roles.member");
  }
}

export const BillingSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const {
    isBasicTier,
    isTrialing,
    trialEndsAt,
    quota,
    openUpgradePlans,
    capabilities,
    teamWorkspace,
    updateTeamWorkspace,
  } = usePlan();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [snippetTrigger, setSnippetTrigger] = useState("");
  const [snippetExpansion, setSnippetExpansion] = useState("");
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
  const [dictionaryTerm, setDictionaryTerm] = useState("");
  const [dictionaryNote, setDictionaryNote] = useState("");
  const [editingDictionaryId, setEditingDictionaryId] = useState<string | null>(null);

  useEffect(() => {
    setSession(authClient.getStoredSession());
    commands
      .getHistoryStats()
      .then((res) => {
        if (res.status === "ok") setStats(res.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session?.user?.name) return;
    setPendingName(session.user.name);
  }, [session?.user?.name]);

  const comparisonRows = useMemo(() => buildPlanComparisonRows(t), [t]);

  const handleManage = useCallback(async () => {
    const token = authClient.getStoredToken();
    if (!token) return;
    setPortalLoading(true);
    try {
      const { url } = await authClient.createPortal(token);
      await openUrl(url);
    } catch {
      // Ignore portal launch errors; the upgrade modal remains available.
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const sub = session?.subscription;
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const planPrice = getPlanPrice(capabilities.plan);
  const planPriceSuffix =
    capabilities.plan === "small_agency"
      ? t("billing.plan.pricePeriodSeat")
      : t("billing.plan.pricePeriodAnnual");
  const isPremium = sub?.tier === "premium";
  const isManagedByAgency =
    capabilities.plan === "small_agency" && sub?.can_manage_billing === false;
  const tierLabel = isTrialing
    ? t("billing.tier.trial")
    : t(`billing.tier.${capabilities.plan}`, { defaultValue: capabilities.label });
  const showPersonalBilling = !isManagedByAgency;
  const teamMembers = teamWorkspace?.members ?? [];
  const seatsIncluded = teamWorkspace?.seatsIncluded ?? 0;
  const seatsUsed = teamMembers.length;
  const seatsRemaining = Math.max(0, seatsIncluded - seatsUsed);
  const canManageWorkspace =
    teamWorkspace?.currentUserRole === "owner" ||
    teamWorkspace?.currentUserRole === "admin";

  const statusMap: Record<string, string> = {
    trialing: t("billing.status.trialing"),
    active: t("billing.status.active"),
    past_due: t("billing.status.pastDue"),
    canceled: t("billing.status.canceled"),
    incomplete: t("billing.status.incomplete"),
    inactive: t("billing.status.inactive"),
  };

  const handleInviteMember = useCallback(async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (
      !teamWorkspace ||
      !normalizedEmail ||
      seatsRemaining <= 0 ||
      teamMembers.some((member) => member.email.toLowerCase() === normalizedEmail)
    ) {
      return;
    }

    const token = authClient.getStoredToken();
    if (!token) return;

    setWorkspaceLoading(true);
    try {
      const response = await authClient.inviteWorkspaceMember(token, {
        email: normalizedEmail,
        role: inviteRole,
      });
      updateTeamWorkspace(mapTeamWorkspacePayload(response.workspace));
      setInviteEmail("");
      setInviteRole("member");
    } catch (error) {
      console.error("Failed to invite workspace member:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [
    inviteEmail,
    inviteRole,
    seatsRemaining,
    teamMembers,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      const token = authClient.getStoredToken();
      if (!token) return;

      setWorkspaceLoading(true);
      try {
        const response = await authClient.removeWorkspaceMember(token, memberId);
        updateTeamWorkspace(mapTeamWorkspacePayload(response.workspace));
      } catch (error) {
        console.error("Failed to remove workspace member:", error);
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [updateTeamWorkspace],
  );

  const handleAddTemplate = useCallback(async () => {
    const token = authClient.getStoredToken();
    const name = templateName.trim();
    const description = templateDescription.trim();
    const prompt = templatePrompt.trim();
    if (!token || !teamWorkspace || !canManageWorkspace || !name || !prompt) return;

    setWorkspaceLoading(true);
    try {
      const response = editingTemplateId
        ? await authClient.updateWorkspaceTemplate(token, editingTemplateId, {
            name,
            description: description || undefined,
            prompt,
          })
        : await authClient.addWorkspaceTemplate(token, {
            name,
            description: description || undefined,
            prompt,
          });
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedTemplates: mapSharedTemplates(response.templates),
            }
          : current,
      );
      setTemplateName("");
      setTemplateDescription("");
      setTemplatePrompt("");
      setEditingTemplateId(null);
    } catch (error) {
      console.error("Failed to add workspace template:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [
    canManageWorkspace,
    editingTemplateId,
    teamWorkspace,
    templateDescription,
    templateName,
    templatePrompt,
    updateTeamWorkspace,
  ]);

  const handleEditTemplate = useCallback(
    (templateId: string) => {
      const template = teamWorkspace?.sharedTemplates.find(
        (entry) => entry.id === templateId,
      );
      if (!template) return;
      setTemplateName(template.name);
      setTemplateDescription(template.description);
      setTemplatePrompt(template.prompt);
      setEditingTemplateId(template.id);
    },
    [teamWorkspace],
  );

  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageWorkspace) return;

      setWorkspaceLoading(true);
      try {
        const response = await authClient.removeWorkspaceTemplate(token, templateId);
        updateTeamWorkspace((current) =>
          current
            ? {
                ...current,
                sharedTemplates: mapSharedTemplates(response.templates),
              }
            : current,
        );
        if (editingTemplateId === templateId) {
          setTemplateName("");
          setTemplateDescription("");
          setTemplatePrompt("");
          setEditingTemplateId(null);
        }
      } catch (error) {
        console.error("Failed to remove workspace template:", error);
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [canManageWorkspace, editingTemplateId, teamWorkspace, updateTeamWorkspace],
  );

  const handleAddSnippet = useCallback(async () => {
    const token = authClient.getStoredToken();
    const trigger = snippetTrigger.trim();
    const expansion = snippetExpansion.trim();
    if (!token || !teamWorkspace || !canManageWorkspace || !trigger || !expansion) return;

    setWorkspaceLoading(true);
    try {
      const response = editingSnippetId
        ? await authClient.updateWorkspaceSnippet(token, editingSnippetId, {
            trigger,
            expansion,
          })
        : await authClient.addWorkspaceSnippet(token, {
            trigger,
            expansion,
          });
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedSnippets: mapSharedSnippets(response.snippets),
            }
          : current,
      );
      setSnippetTrigger("");
      setSnippetExpansion("");
      setEditingSnippetId(null);
    } catch (error) {
      console.error("Failed to add workspace snippet:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [
    canManageWorkspace,
    editingSnippetId,
    snippetExpansion,
    snippetTrigger,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  const handleEditSnippet = useCallback(
    (snippetId: string) => {
      const snippet = teamWorkspace?.sharedSnippets.find(
        (entry) => entry.id === snippetId,
      );
      if (!snippet) return;
      setSnippetTrigger(snippet.trigger);
      setSnippetExpansion(snippet.expansion);
      setEditingSnippetId(snippet.id);
    },
    [teamWorkspace],
  );

  const handleDeleteSnippet = useCallback(
    async (snippetId: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageWorkspace) return;

      setWorkspaceLoading(true);
      try {
        const response = await authClient.removeWorkspaceSnippet(token, snippetId);
        updateTeamWorkspace((current) =>
          current
            ? {
                ...current,
                sharedSnippets: mapSharedSnippets(response.snippets),
              }
            : current,
        );
        if (editingSnippetId === snippetId) {
          setSnippetTrigger("");
          setSnippetExpansion("");
          setEditingSnippetId(null);
        }
      } catch (error) {
        console.error("Failed to remove workspace snippet:", error);
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [canManageWorkspace, editingSnippetId, teamWorkspace, updateTeamWorkspace],
  );

  const handleAddDictionaryTerm = useCallback(async () => {
    const token = authClient.getStoredToken();
    const term = dictionaryTerm.trim();
    const note = dictionaryNote.trim();
    if (!token || !teamWorkspace || !canManageWorkspace || !term) return;

    setWorkspaceLoading(true);
    try {
      const response = editingDictionaryId
        ? await authClient.updateWorkspaceDictionaryTerm(token, editingDictionaryId, {
            term,
            note: note || undefined,
          })
        : await authClient.addWorkspaceDictionaryTerm(token, {
            term,
            note: note || undefined,
          });
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedDictionary: mapSharedDictionary(response.dictionary),
            }
          : current,
      );
      setDictionaryTerm("");
      setDictionaryNote("");
      setEditingDictionaryId(null);
    } catch (error) {
      console.error("Failed to add workspace dictionary term:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [
    canManageWorkspace,
    dictionaryNote,
    dictionaryTerm,
    editingDictionaryId,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  const handleEditDictionaryTerm = useCallback(
    (termId: string) => {
      const term = teamWorkspace?.sharedDictionary.find((entry) => entry.id === termId);
      if (!term) return;
      setDictionaryTerm(term.term);
      setDictionaryNote(term.note ?? "");
      setEditingDictionaryId(term.id);
    },
    [teamWorkspace],
  );

  const handleDeleteDictionaryTerm = useCallback(
    async (termId: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageWorkspace) return;

      setWorkspaceLoading(true);
      try {
        const response = await authClient.removeWorkspaceDictionaryTerm(token, termId);
        updateTeamWorkspace((current) =>
          current
            ? {
                ...current,
                sharedDictionary: mapSharedDictionary(response.dictionary),
              }
            : current,
        );
        if (editingDictionaryId === termId) {
          setDictionaryTerm("");
          setDictionaryNote("");
          setEditingDictionaryId(null);
        }
      } catch (error) {
        console.error("Failed to remove workspace dictionary term:", error);
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [canManageWorkspace, editingDictionaryId, teamWorkspace, updateTeamWorkspace],
  );

  const handleSaveOwnName = useCallback(async () => {
    const token = authClient.getStoredToken();
    const nextName = pendingName.trim();
    if (!token || !session?.user || nextName.length < 2) return;

    setWorkspaceLoading(true);
    try {
      const updatedSession = await authClient.updateProfile(token, {
        name: nextName,
      });
      await authClient.setStoredSession(updatedSession);
      setSession(updatedSession);
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.email.toLowerCase() === updatedSession.user.email.toLowerCase()
                  ? { ...member, name: updatedSession.user.name?.trim() || member.name }
                  : member,
              ),
            }
          : current,
      );
      setEditingName(false);
    } catch (error) {
      console.error("Failed to update profile name:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [pendingName, session?.user, updateTeamWorkspace]);

  return (
    <>
      <PlanComparisonModal
        open={showPlanComparison}
        onClose={() => setShowPlanComparison(false)}
        rows={comparisonRows}
        t={t}
      />

      <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 26,
            padding: "26px 36px 36px",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.025em",
                color: "rgba(255,255,255,0.94)",
                lineHeight: 1.2,
              }}
            >
              {t("billing.title")}
            </h1>
            <p
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.38)",
                marginTop: 4,
              }}
            >
              {t("billing.subtitle")}
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 24,
              alignItems: "center",
              padding: "26px 28px",
              borderRadius: 14,
              border: "1px solid rgba(201,168,76,0.32)",
              background:
                "radial-gradient(ellipse 60% 100% at 100% 0%, rgba(201,168,76,0.10) 0%, transparent 60%), linear-gradient(180deg, rgba(201,168,76,0.06), rgba(201,168,76,0.015))",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background:
                  "radial-gradient(ellipse 100% 60% at 0% 100%, rgba(201,168,76,0.04) 0%, transparent 50%)",
              }}
            />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                minWidth: 0,
                position: "relative",
                zIndex: 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(201,168,76,0.12)",
                    border: "1px solid rgba(201,168,76,0.32)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#c9a84c",
                    letterSpacing: "0.02em",
                  }}
                >
                  <Star size={11} fill="currentColor" />
                  {tierLabel}
                </span>
                {(sub?.status === "active" || sub?.status === "trialing") && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                      color: "#34d399",
                      fontWeight: 500,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#34d399",
                        boxShadow: "0 0 8px rgba(52,211,153,0.5)",
                        display: "inline-block",
                      }}
                    />
                    {statusMap[sub?.status ?? "active"] ?? t("billing.status.active")}
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  color: "rgba(255,255,255,0.94)",
                  lineHeight: 1,
                }}
              >
                {tierLabel}
              </div>

              {planPrice && !isTrialing && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.94)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {planPrice}
                  </span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.38)" }}>
                    {planPriceSuffix}
                  </span>
                </div>
              )}

              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)" }}>
                {isManagedByAgency ? (
                  t("billing.workspace.managedByWorkspaceDescription")
                ) : null}
                {isTrialing && trialEndsAt && (
                  <>
                    {t("billing.plan.trialEnds", {
                      date: formatDate(trialEndsAt, locale),
                    })}
                    {session?.user?.email ? (
                      <>
                        {" · "}
                        <span
                          style={{
                            color: "rgba(255,255,255,0.64)",
                            fontWeight: 500,
                          }}
                        >
                          {session.user.email}
                        </span>
                      </>
                    ) : null}
                  </>
                )}
                {isPremium && !isTrialing && sub?.current_period_ends_at && showPersonalBilling ? (
                  <>
                    {t("billing.plan.renewsPrefix")}{" "}
                    <span
                      style={{
                        color: "rgba(255,255,255,0.64)",
                        fontWeight: 500,
                      }}
                    >
                      {formatDate(sub.current_period_ends_at, locale)}
                    </span>
                    {session?.user?.email ? (
                      <>
                        {" · "}
                        <span
                          style={{
                            color: "rgba(255,255,255,0.64)",
                            fontWeight: 500,
                          }}
                        >
                          {session.user.email}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : null}
                {isBasicTier && !isTrialing && session?.user?.email ? (
                  <span
                    style={{
                      color: "rgba(255,255,255,0.64)",
                      fontWeight: 500,
                    }}
                  >
                    {session.user.email}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                alignItems: "stretch",
                minWidth: 220,
              }}
            >
              {showPersonalBilling && (isPremium || isTrialing) ? (
                <>
                  <button
                    onClick={() => void handleManage()}
                    disabled={portalLoading}
                    style={{
                      height: 36,
                      padding: "0 14px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      borderRadius: 9,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: portalLoading ? "not-allowed" : "pointer",
                      background: "#c9a84c",
                      color: "#1a1407",
                      border: "none",
                      boxShadow:
                        "0 4px 14px rgba(201,168,76,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
                      opacity: portalLoading ? 0.6 : 1,
                      transition: "filter 0.15s",
                      fontFamily: "inherit",
                    }}
                  >
                    <ExternalLink size={13} />
                    {portalLoading
                      ? t("common.loading", { defaultValue: "Loading..." })
                      : t("billing.actions.manage.button")}
                  </button>
                  <button
                    onClick={openUpgradePlans}
                    style={{
                      height: 36,
                      padding: "0 14px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      borderRadius: 9,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      background: "rgba(255,255,255,0.03)",
                      color: "rgba(255,255,255,0.64)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      fontFamily: "inherit",
                    }}
                  >
                    {t("billing.actions.plans")}
                  </button>
                </>
              ) : null}

              {!showPersonalBilling ? (
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "rgba(255,255,255,0.72)",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    maxWidth: 260,
                  }}
                >
                  {t("billing.workspace.managedByWorkspace")}
                </div>
              ) : null}

              {showPersonalBilling && !isPremium && !isTrialing ? (
                <button
                  onClick={openUpgradePlans}
                  style={{
                    height: 36,
                    padding: "0 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    borderRadius: 9,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: "#c9a84c",
                    color: "#1a1407",
                    border: "none",
                    boxShadow:
                      "0 4px 14px rgba(201,168,76,0.22), inset 0 1px 0 rgba(255,255,255,0.18)",
                    transition: "filter 0.15s",
                    fontFamily: "inherit",
                  }}
                >
                  <Zap size={13} />
                  {t("billing.actions.upgrade.button")}
                </button>
              ) : null}
            </div>
          </div>

          {(quota || (stats && capabilities.canViewAdvancedStats)) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.38)",
                  }}
                >
                  {t("billing.usage.title")}
                </span>
                <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)" }}>
                  {t("billing.usage.period")}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    quota && stats && capabilities.canViewAdvancedStats
                      ? "1fr 1fr 1fr"
                      : "1fr 1fr",
                  gap: 12,
                }}
              >
                {quota ? (
                  <UsageCard
                    label={t("billing.usage.transcriptions")}
                    used={quota.count}
                    limit={quota.limit}
                    locale={locale}
                    footer={
                      quota.reset_at
                        ? t("billing.usage.resetsOn", {
                            date: formatDate(quota.reset_at, locale),
                          })
                        : t("billing.usage.weeklyReset")
                    }
                  />
                ) : null}
                {stats && capabilities.canViewAdvancedStats ? (
                  <UsageCard
                    label={t("billing.stats.words")}
                    used={stats.total_words}
                    limit={Math.max(stats.total_words, 10000)}
                    locale={locale}
                    footer={t("billing.stats.allTime")}
                  />
                ) : null}
                {stats && capabilities.canViewAdvancedStats ? (
                  <UsageCard
                    label={t("billing.stats.sessions")}
                    used={stats.total_entries}
                    limit={Math.max(stats.total_entries, 500)}
                    locale={locale}
                    footer={t("billing.stats.allSessions")}
                  />
                ) : null}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.38)",
                }}
              >
                {t("billing.comparison.eyebrow")}
              </span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)" }}>
                {t("billing.comparison.subtitle")}
              </span>
            </div>

            <div
              style={{
                padding: "18px 20px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.018)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  maxWidth: 620,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.94)",
                  }}
                >
                  {t("billing.comparison.cardTitle")}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: "rgba(255,255,255,0.42)",
                  }}
                >
                  {t("billing.comparison.cardDescription")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPlanComparison(true)}
                style={{
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(201,168,76,0.26)",
                  background: "rgba(201,168,76,0.10)",
                  color: "#d8b866",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {t("billing.comparison.button")}
              </button>
            </div>
          </div>

          {teamWorkspace ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.38)",
                  }}
                >
                  {t("billing.workspace.title")}
                </span>
                <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)" }}>
                  {t("billing.workspace.subtitle")}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, 0.75fr)",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    padding: "18px 20px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.018)",
                    display: "grid",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "grid", gap: 4 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          color: "rgba(255,255,255,0.94)",
                        }}
                      >
                        <Building2 size={16} />
                        <span style={{ fontSize: 16, fontWeight: 600 }}>
                          {teamWorkspace.name}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "rgba(255,255,255,0.42)",
                        }}
                      >
                        {teamWorkspace.currentUserRole === "owner"
                          ? t("billing.workspace.ownerWorkspace")
                          : t("billing.workspace.adminWorkspace")}{" "}
                        ·{" "}
                        {t("billing.workspace.seatsUsed", {
                          used: seatsUsed,
                          total: seatsIncluded,
                        })}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(201,168,76,0.22)",
                        background: "rgba(201,168,76,0.10)",
                        color: "#e8c87a",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <Users size={14} />
                      {t("billing.workspace.seatsAvailable", {
                        count: seatsRemaining,
                      })}
                    </div>
                  </div>

                  {canManageWorkspace ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto auto",
                        gap: 10,
                      }}
                    >
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder={t("billing.workspace.invitePlaceholder")}
                        disabled={workspaceLoading || seatsRemaining <= 0}
                        style={{
                          height: 40,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.10)",
                          background: "rgba(255,255,255,0.03)",
                          color: "rgba(255,255,255,0.94)",
                          padding: "0 12px",
                          fontSize: 13,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                      <select
                        value={inviteRole}
                        onChange={(event) => setInviteRole(event.target.value as TeamRole)}
                        disabled={workspaceLoading || seatsRemaining <= 0}
                        style={{
                          height: 40,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.10)",
                          background: "rgba(255,255,255,0.03)",
                          color: "rgba(255,255,255,0.94)",
                          padding: "0 12px",
                          fontSize: 13,
                          fontFamily: "inherit",
                        }}
                      >
                        <option value="member">{t("billing.workspace.roles.member")}</option>
                        <option value="admin">{t("billing.workspace.roles.admin")}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleInviteMember()}
                        disabled={
                          workspaceLoading || !inviteEmail.trim() || seatsRemaining <= 0
                        }
                        style={{
                          height: 40,
                          padding: "0 14px",
                          borderRadius: 10,
                          border: "1px solid rgba(201,168,76,0.26)",
                          background: "rgba(201,168,76,0.10)",
                          color: "#d8b866",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          opacity:
                            workspaceLoading || !inviteEmail.trim() || seatsRemaining <= 0
                              ? 0.45
                              : 1,
                        }}
                      >
                        <UserPlus size={14} />
                        {t("billing.workspace.inviteButton")}
                      </button>
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gap: 10 }}>
                    {teamMembers.map((member) => (
                      <div
                        key={member.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto auto",
                          gap: 12,
                          alignItems: "center",
                          padding: "12px 14px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(255,255,255,0.022)",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          {session?.user?.email &&
                          member.email.toLowerCase() === session.user.email.toLowerCase() ? (
                            editingName ? (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 2,
                                }}
                              >
                                <input
                                  type="text"
                                  value={pendingName}
                                  onChange={(event) => setPendingName(event.target.value)}
                                  disabled={workspaceLoading}
                                  style={{
                                    height: 34,
                                    minWidth: 0,
                                    width: "100%",
                                    maxWidth: 220,
                                    borderRadius: 8,
                                    border: "1px solid rgba(255,255,255,0.10)",
                                    background: "rgba(255,255,255,0.03)",
                                    color: "rgba(255,255,255,0.94)",
                                    padding: "0 10px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    fontFamily: "inherit",
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSaveOwnName()}
                                  disabled={workspaceLoading || pendingName.trim().length < 2}
                                  style={{
                                    height: 32,
                                    padding: "0 10px",
                                    borderRadius: 8,
                                    border: "1px solid rgba(201,168,76,0.26)",
                                    background: "rgba(201,168,76,0.10)",
                                    color: "#d8b866",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    opacity:
                                      workspaceLoading || pendingName.trim().length < 2
                                        ? 0.45
                                        : 1,
                                  }}
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 13.5,
                                    fontWeight: 600,
                                    color: "rgba(255,255,255,0.94)",
                                  }}
                                >
                                  {member.name}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingName(member.name);
                                    setEditingName(true);
                                  }}
                                  disabled={workspaceLoading}
                                  aria-label="Modifier mon nom"
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 999,
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    background: "rgba(255,255,255,0.03)",
                                    color: "rgba(255,255,255,0.56)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                  }}
                                >
                                  <Pencil size={12} />
                                </button>
                              </div>
                            )
                          ) : (
                            <div
                              style={{
                                fontSize: 13.5,
                                fontWeight: 600,
                                color: "rgba(255,255,255,0.94)",
                              }}
                            >
                              {member.name}
                            </div>
                          )}
                          <div
                            style={{
                              marginTop: 3,
                              fontSize: 12,
                              color: "rgba(255,255,255,0.42)",
                            }}
                          >
                            {member.email}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 9px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background:
                              member.status === "active"
                                ? "rgba(52,211,153,0.10)"
                                : "rgba(255,255,255,0.04)",
                            color:
                              member.status === "active"
                                ? "#8ef0bf"
                                : "rgba(255,255,255,0.68)",
                            fontSize: 11.5,
                            fontWeight: 600,
                          }}
                        >
                          {roleLabel(member.role, t)} ·{" "}
                          {member.status === "active"
                            ? t("billing.workspace.memberStatus.active")
                            : t("billing.workspace.memberStatus.invited")}
                        </div>

                        {member.role !== "owner" && canManageWorkspace ? (
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(member.id)}
                            disabled={workspaceLoading}
                            style={{
                              height: 32,
                              padding: "0 10px",
                              borderRadius: 8,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.68)",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            {t("billing.workspace.removeButton")}
                          </button>
                        ) : member.role === "owner" ? (
                          <span
                            style={{
                              fontSize: 11.5,
                              color: "rgba(255,255,255,0.32)",
                            }}
                          >
                            {t("billing.workspace.ownerBadge")}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 16 }}>
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.018)",
                      display: "grid",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        color: "rgba(255,255,255,0.94)",
                      }}
                    >
                      <Layers size={16} />
                      <span style={{ fontSize: 15, fontWeight: 600 }}>
                        {t("billing.workspace.sharedLibraryTitle")}
                      </span>
                    </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      }}
                    >
                      {[
                        [
                          t("billing.workspace.metrics.templates"),
                          String(teamWorkspace.sharedTemplates.length),
                        ],
                        [
                          t("billing.workspace.metrics.snippets"),
                          String(teamWorkspace.sharedSnippets.length),
                        ],
                        [
                          t("billing.workspace.metrics.terms"),
                          String(teamWorkspace.sharedDictionary.length),
                        ],
                        [
                          t("billing.workspace.metrics.support"),
                          t("billing.workspace.supportPriority"),
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          style={{
                            padding: "12px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.022)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11.5,
                              color: "rgba(255,255,255,0.38)",
                            }}
                          >
                            {label}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 18,
                              fontWeight: 700,
                              color: "rgba(255,255,255,0.94)",
                            }}
                          >
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {canManageWorkspace ? (
                      <div
                        style={{
                          display: "grid",
                          gap: 12,
                          paddingTop: 4,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "rgba(255,255,255,0.38)",
                          }}
                        >
                          {t("billing.workspace.createTitle", {
                            defaultValue: "Ajouter une ressource partagée",
                          })}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gap: 10,
                            padding: "12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.022)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "rgba(255,255,255,0.94)",
                            }}
                          >
                            {t("billing.workspace.forms.template.title", {
                              defaultValue: "Template d'équipe",
                            })}
                          </div>
                          <input
                            type="text"
                            value={templateName}
                            onChange={(event) => setTemplateName(event.target.value)}
                            placeholder={t("billing.workspace.forms.template.name", {
                              defaultValue: "Nom du template",
                            })}
                            disabled={workspaceLoading}
                            style={{
                              height: 38,
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "0 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                          />
                          <input
                            type="text"
                            value={templateDescription}
                            onChange={(event) =>
                              setTemplateDescription(event.target.value)
                            }
                            placeholder={t(
                              "billing.workspace.forms.template.description",
                              {
                                defaultValue: "Description courte",
                              },
                            )}
                            disabled={workspaceLoading}
                            style={{
                              height: 38,
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "0 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                          />
                          <textarea
                            value={templatePrompt}
                            onChange={(event) => setTemplatePrompt(event.target.value)}
                            placeholder={t("billing.workspace.forms.template.prompt", {
                              defaultValue: "Prompt partagé pour toute l'équipe",
                            })}
                            disabled={workspaceLoading}
                            rows={4}
                            style={{
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "10px 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                              resize: "vertical",
                            }}
                          />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => void handleAddTemplate()}
                              disabled={
                                workspaceLoading ||
                                !templateName.trim() ||
                                !templatePrompt.trim()
                              }
                              style={{
                                height: 36,
                                borderRadius: 9,
                                border: "1px solid rgba(201,168,76,0.26)",
                                background: "rgba(201,168,76,0.10)",
                                color: "#d8b866",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                padding: "0 12px",
                                opacity:
                                  workspaceLoading ||
                                  !templateName.trim() ||
                                  !templatePrompt.trim()
                                    ? 0.45
                                    : 1,
                              }}
                            >
                              {editingTemplateId
                                ? t("dictionary.save")
                                : t("billing.workspace.forms.template.submit", {
                                    defaultValue: "Ajouter le template",
                                  })}
                            </button>
                            {editingTemplateId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTemplateId(null);
                                  setTemplateName("");
                                  setTemplateDescription("");
                                  setTemplatePrompt("");
                                }}
                                disabled={workspaceLoading}
                                style={{
                                  height: 36,
                                  borderRadius: 9,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(255,255,255,0.03)",
                                  color: "rgba(255,255,255,0.72)",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  padding: "0 12px",
                                }}
                              >
                                {t("dictionary.cancel")}
                              </button>
                            ) : null}
                          </div>
                          {teamWorkspace.sharedTemplates.length ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              {teamWorkspace.sharedTemplates.map((template) => (
                                <div
                                  key={template.id}
                                  style={{
                                    display: "grid",
                                    gap: 8,
                                    padding: "10px 12px",
                                    borderRadius: 9,
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    background: "rgba(255,255,255,0.018)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 13,
                                          fontWeight: 600,
                                          color: "rgba(255,255,255,0.94)",
                                        }}
                                      >
                                        {template.name}
                                      </div>
                                      {template.description ? (
                                        <div
                                          style={{
                                            marginTop: 3,
                                            fontSize: 12,
                                            color: "rgba(255,255,255,0.42)",
                                          }}
                                        >
                                          {template.description}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        type="button"
                                        onClick={() => handleEditTemplate(template.id)}
                                        disabled={workspaceLoading}
                                        style={{
                                          height: 30,
                                          padding: "0 10px",
                                          borderRadius: 8,
                                          border: "1px solid rgba(255,255,255,0.10)",
                                          background: "rgba(255,255,255,0.03)",
                                          color: "rgba(255,255,255,0.72)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {t("dictionary.edit")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteTemplate(template.id)}
                                        disabled={workspaceLoading}
                                        style={{
                                          height: 30,
                                          padding: "0 10px",
                                          borderRadius: 8,
                                          border: "1px solid rgba(255,255,255,0.10)",
                                          background: "rgba(255,255,255,0.03)",
                                          color: "rgba(255,255,255,0.72)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {t("dictionary.remove")}
                                      </button>
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      lineHeight: 1.5,
                                      color: "rgba(255,255,255,0.56)",
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {template.prompt}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gap: 10,
                            padding: "12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.022)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "rgba(255,255,255,0.94)",
                            }}
                          >
                            {t("billing.workspace.forms.snippet.title", {
                              defaultValue: "Snippet d'équipe",
                            })}
                          </div>
                          <input
                            type="text"
                            value={snippetTrigger}
                            onChange={(event) => setSnippetTrigger(event.target.value)}
                            placeholder={t("billing.workspace.forms.snippet.trigger", {
                              defaultValue: "Déclencheur vocal",
                            })}
                            disabled={workspaceLoading}
                            style={{
                              height: 38,
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "0 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                          />
                          <textarea
                            value={snippetExpansion}
                            onChange={(event) => setSnippetExpansion(event.target.value)}
                            placeholder={t("billing.workspace.forms.snippet.expansion", {
                              defaultValue: "Texte développé",
                            })}
                            disabled={workspaceLoading}
                            rows={3}
                            style={{
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "10px 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                              resize: "vertical",
                            }}
                          />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => void handleAddSnippet()}
                              disabled={
                                workspaceLoading ||
                                !snippetTrigger.trim() ||
                                !snippetExpansion.trim()
                              }
                              style={{
                                height: 36,
                                borderRadius: 9,
                                border: "1px solid rgba(201,168,76,0.26)",
                                background: "rgba(201,168,76,0.10)",
                                color: "#d8b866",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                padding: "0 12px",
                                opacity:
                                  workspaceLoading ||
                                  !snippetTrigger.trim() ||
                                  !snippetExpansion.trim()
                                    ? 0.45
                                    : 1,
                              }}
                            >
                              {editingSnippetId
                                ? t("dictionary.save")
                                : t("billing.workspace.forms.snippet.submit", {
                                    defaultValue: "Ajouter le snippet",
                                  })}
                            </button>
                            {editingSnippetId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSnippetId(null);
                                  setSnippetTrigger("");
                                  setSnippetExpansion("");
                                }}
                                disabled={workspaceLoading}
                                style={{
                                  height: 36,
                                  borderRadius: 9,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(255,255,255,0.03)",
                                  color: "rgba(255,255,255,0.72)",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  padding: "0 12px",
                                }}
                              >
                                {t("dictionary.cancel")}
                              </button>
                            ) : null}
                          </div>
                          {teamWorkspace.sharedSnippets.length ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              {teamWorkspace.sharedSnippets.map((snippet) => (
                                <div
                                  key={snippet.id}
                                  style={{
                                    display: "grid",
                                    gap: 8,
                                    padding: "10px 12px",
                                    borderRadius: 9,
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    background: "rgba(255,255,255,0.018)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 13,
                                          fontWeight: 600,
                                          color: "rgba(255,255,255,0.94)",
                                        }}
                                      >
                                        {snippet.trigger}
                                      </div>
                                      <div
                                        style={{
                                          marginTop: 3,
                                          fontSize: 12,
                                          color: "rgba(255,255,255,0.42)",
                                          whiteSpace: "pre-wrap",
                                        }}
                                      >
                                        {snippet.expansion}
                                      </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        type="button"
                                        onClick={() => handleEditSnippet(snippet.id)}
                                        disabled={workspaceLoading}
                                        style={{
                                          height: 30,
                                          padding: "0 10px",
                                          borderRadius: 8,
                                          border: "1px solid rgba(255,255,255,0.10)",
                                          background: "rgba(255,255,255,0.03)",
                                          color: "rgba(255,255,255,0.72)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {t("dictionary.edit")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteSnippet(snippet.id)}
                                        disabled={workspaceLoading}
                                        style={{
                                          height: 30,
                                          padding: "0 10px",
                                          borderRadius: 8,
                                          border: "1px solid rgba(255,255,255,0.10)",
                                          background: "rgba(255,255,255,0.03)",
                                          color: "rgba(255,255,255,0.72)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {t("dictionary.remove")}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gap: 10,
                            padding: "12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.022)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "rgba(255,255,255,0.94)",
                            }}
                          >
                            {t("billing.workspace.forms.dictionary.title", {
                              defaultValue: "Terme du dictionnaire",
                            })}
                          </div>
                          <input
                            type="text"
                            value={dictionaryTerm}
                            onChange={(event) => setDictionaryTerm(event.target.value)}
                            placeholder={t("billing.workspace.forms.dictionary.term", {
                              defaultValue: "Terme ou nom produit",
                            })}
                            disabled={workspaceLoading}
                            style={{
                              height: 38,
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "0 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                          />
                          <input
                            type="text"
                            value={dictionaryNote}
                            onChange={(event) => setDictionaryNote(event.target.value)}
                            placeholder={t("billing.workspace.forms.dictionary.note", {
                              defaultValue: "Note optionnelle",
                            })}
                            disabled={workspaceLoading}
                            style={{
                              height: 38,
                              borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                              color: "rgba(255,255,255,0.94)",
                              padding: "0 12px",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                          />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => void handleAddDictionaryTerm()}
                              disabled={workspaceLoading || !dictionaryTerm.trim()}
                              style={{
                                height: 36,
                                borderRadius: 9,
                                border: "1px solid rgba(201,168,76,0.26)",
                                background: "rgba(201,168,76,0.10)",
                                color: "#d8b866",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                padding: "0 12px",
                                opacity:
                                  workspaceLoading || !dictionaryTerm.trim()
                                    ? 0.45
                                    : 1,
                              }}
                            >
                              {editingDictionaryId
                                ? t("dictionary.save")
                                : t("billing.workspace.forms.dictionary.submit", {
                                    defaultValue: "Ajouter le terme",
                                  })}
                            </button>
                            {editingDictionaryId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingDictionaryId(null);
                                  setDictionaryTerm("");
                                  setDictionaryNote("");
                                }}
                                disabled={workspaceLoading}
                                style={{
                                  height: 36,
                                  borderRadius: 9,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(255,255,255,0.03)",
                                  color: "rgba(255,255,255,0.72)",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  padding: "0 12px",
                                }}
                              >
                                {t("dictionary.cancel")}
                              </button>
                            ) : null}
                          </div>
                          {teamWorkspace.sharedDictionary.length ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              {teamWorkspace.sharedDictionary.map((term) => (
                                <div
                                  key={term.id}
                                  style={{
                                    display: "grid",
                                    gap: 8,
                                    padding: "10px 12px",
                                    borderRadius: 9,
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    background: "rgba(255,255,255,0.018)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 13,
                                          fontWeight: 600,
                                          color: "rgba(255,255,255,0.94)",
                                        }}
                                      >
                                        {term.term}
                                      </div>
                                      {term.note ? (
                                        <div
                                          style={{
                                            marginTop: 3,
                                            fontSize: 12,
                                            color: "rgba(255,255,255,0.42)",
                                          }}
                                        >
                                          {term.note}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button
                                        type="button"
                                        onClick={() => handleEditDictionaryTerm(term.id)}
                                        disabled={workspaceLoading}
                                        style={{
                                          height: 30,
                                          padding: "0 10px",
                                          borderRadius: 8,
                                          border: "1px solid rgba(255,255,255,0.10)",
                                          background: "rgba(255,255,255,0.03)",
                                          color: "rgba(255,255,255,0.72)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {t("dictionary.edit")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteDictionaryTerm(term.id)}
                                        disabled={workspaceLoading}
                                        style={{
                                          height: 30,
                                          padding: "0 10px",
                                          borderRadius: 8,
                                          border: "1px solid rgba(255,255,255,0.10)",
                                          background: "rgba(255,255,255,0.03)",
                                          color: "rgba(255,255,255,0.72)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {t("dictionary.remove")}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {canManageWorkspace ? (
                    <div
                      style={{
                        padding: "18px 20px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.018)",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          color: "rgba(255,255,255,0.94)",
                        }}
                      >
                        <ShieldCheck size={16} />
                        <span style={{ fontSize: 15, fontWeight: 600 }}>
                          {t("billing.workspace.adminBillingTitle")}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          lineHeight: 1.55,
                          color: "rgba(255,255,255,0.42)",
                        }}
                      >
                        {t("billing.workspace.adminBillingDescription")}
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
                          {t("billing.workspace.billingOwner")}:{" "}
                          {teamWorkspace.billingContactEmail}
                        </div>
                        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
                          {t("billing.workspace.supportContact")}:{" "}
                          {teamWorkspace.supportContactEmail}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {showPersonalBilling ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "380px 1fr",
                gap: 24,
                alignItems: "flex-start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.10em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.38)",
                    }}
                  >
                    {t("billing.payment.title")}
                  </span>
                </div>
                <div
                  style={{
                    padding: "18px 20px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.018)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 28,
                        borderRadius: 5,
                        background: "linear-gradient(135deg, #1a1a24, #0f0f15)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <CreditCard
                        size={14}
                        style={{ color: "rgba(255,255,255,0.64)" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "rgba(255,255,255,0.94)",
                          fontFamily: "ui-monospace, monospace",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {t("billing.payment.managed")}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "rgba(255,255,255,0.38)",
                          marginTop: 2,
                        }}
                      >
                        {t("billing.payment.securePortal")}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleManage()}
                      disabled={portalLoading}
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.64)",
                        cursor: "pointer",
                        padding: "6px 10px",
                        borderRadius: 7,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.02)",
                        fontFamily: "inherit",
                      }}
                    >
                      {t("billing.payment.modify")}
                    </button>
                  </div>
                  {session?.user?.email ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.64)",
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.38)" }}>
                        {t("billing.payment.billedTo")}
                      </span>
                      <span
                        style={{
                          color: "rgba(255,255,255,0.94)",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 12,
                        }}
                      >
                        {session.user.email}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.10em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.38)",
                    }}
                  >
                    {t("billing.invoices.title")}
                  </span>
                  <button
                    onClick={() => void handleManage()}
                    style={{
                      marginLeft: "auto",
                      fontSize: 12.5,
                      color: "#c9a84c",
                      fontWeight: 500,
                      cursor: "pointer",
                      background: "none",
                      border: "none",
                      padding: 0,
                      fontFamily: "inherit",
                    }}
                  >
                    {t("billing.invoices.viewAll")}
                  </button>
                </div>
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.018)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 1fr 90px 70px 32px",
                      gap: 14,
                      alignItems: "center",
                      padding: "11px 18px",
                      background: "rgba(0,0,0,0.18)",
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.10em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.22)",
                    }}
                  >
                    <span>{t("billing.invoices.colDate")}</span>
                    <span>{t("billing.invoices.colDescription")}</span>
                    <span>{t("billing.invoices.colStatus")}</span>
                    <span style={{ textAlign: "right" }}>
                      {t("billing.invoices.colAmount")}
                    </span>
                    <span />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "32px 18px",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 9,
                        background: "rgba(255,255,255,0.025)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Download
                        size={15}
                        style={{ color: "rgba(255,255,255,0.38)" }}
                      />
                    </div>
                    <p
                      style={{
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.38)",
                        textAlign: "center",
                      }}
                    >
                      {t("billing.invoices.portalHint")}
                    </p>
                    <button
                      onClick={() => void handleManage()}
                      disabled={portalLoading}
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#c9a84c",
                        cursor: "pointer",
                        background: "rgba(201,168,76,0.08)",
                        border: "1px solid rgba(201,168,76,0.20)",
                        borderRadius: 7,
                        padding: "6px 12px",
                        fontFamily: "inherit",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <ExternalLink size={11} />
                      {t("billing.invoices.openPortal")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: "18px 20px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.018)",
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {t("billing.workspace.managedByWorkspaceDescription")}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

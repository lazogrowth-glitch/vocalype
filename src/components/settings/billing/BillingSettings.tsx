import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Building2,
  CreditCard,
  Download,
  ExternalLink,
  Layers,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { authClient } from "@/lib/auth/client";
import type { AuthSession } from "@/lib/auth/types";
import { usePlan } from "@/lib/subscription/context";
import type { TeamMember, TeamRole } from "@/lib/subscription/workspace";
import { commands, type HistoryStats } from "@/bindings";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "—";
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

type PlanFeatureCell = {
  label: string;
  tone?: "neutral" | "good";
};

type PlanFeatureRow = {
  feature: string;
  independent: PlanFeatureCell;
  powerUser: PlanFeatureCell;
  smallAgency: PlanFeatureCell;
};

const PLAN_COMPARISON_ROWS: PlanFeatureRow[] = [
  { feature: "Dictee illimitee", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Paste dans n'importe quelle app", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Local / offline par defaut", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Mac / Windows / Linux", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Choix micro + raccourci", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Langue / auto-detection", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Historique simple", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Historique illimite", independent: { label: "Limite" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Export historique", independent: { label: "Basique" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Mots personnalises", independent: { label: "Personnel", tone: "good" }, powerUser: { label: "Personnel avance", tone: "good" }, smallAgency: { label: "Personnel + equipe", tone: "good" } },
  { feature: "Vocabulaire adaptatif", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Templates recruteur", independent: { label: "3 templates" }, powerUser: { label: "Tous les templates", tone: "good" }, smallAgency: { label: "Templates partages", tone: "good" } },
  { feature: "Actions IA custom Ctrl+1..9", independent: { label: "1 a 2 max" }, powerUser: { label: "9 actions", tone: "good" }, smallAgency: { label: "9 + partagees", tone: "good" } },
  { feature: "AI post-processing cloud", independent: { label: "Limite / optionnel" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Mode prive qui coupe le cloud", independent: { label: "Oui", tone: "good" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Import audio wav/flac", independent: { label: "Non" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Reprocess ancienne dictee", independent: { label: "Non" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Stats avancees", independent: { label: "Non" }, powerUser: { label: "Oui", tone: "good" }, smallAgency: { label: "Equipe", tone: "good" } },
  { feature: "Shared recruiter templates", independent: { label: "Non" }, powerUser: { label: "Non" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Shared dictionary / snippets team", independent: { label: "Non" }, powerUser: { label: "Non" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Gestion des sieges", independent: { label: "Non" }, powerUser: { label: "Non" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Billing centralise", independent: { label: "Non" }, powerUser: { label: "Non" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Priority support", independent: { label: "Non" }, powerUser: { label: "Normal" }, smallAgency: { label: "Oui", tone: "good" } },
  { feature: "Admin / owner controls", independent: { label: "Non" }, powerUser: { label: "Non" }, smallAgency: { label: "Oui", tone: "good" } },
];

function FeatureCell({ cell }: { cell: PlanFeatureCell }) {
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

function PlanComparisonModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
              Voir les differences
            </h2>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 13.5,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.42)",
              }}
            >
              Compare exactement ce que chaque plan debloque.
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
                Fonctionnalite
              </div>
              {["Independent", "Power user", "Small agency"].map((label) => (
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

            {PLAN_COMPARISON_ROWS.map((row, index) => (
              <div
                key={row.feature}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.45fr 1fr 1fr 1fr",
                  gap: 12,
                  padding: "12px 18px",
                  borderBottom:
                    index === PLAN_COMPARISON_ROWS.length - 1
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

// ── Main component ────────────────────────────────────────────────────────────

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

  useEffect(() => {
    setSession(authClient.getStoredSession());
    commands
      .getHistoryStats()
      .then((res) => {
        if (res.status === "ok") setStats(res.data);
      })
      .catch(() => {});
  }, []);

  const handleManage = useCallback(async () => {
    const token = authClient.getStoredToken();
    if (!token) return;
    setPortalLoading(true);
    try {
      const { url } = await authClient.createPortal(token);
      await openUrl(url);
    } catch {
      /* ignore */
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const sub = session?.subscription;
  const isPremium = sub?.tier === "premium";
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const planPrice =
    capabilities.plan === "independent"
      ? "12 €"
      : capabilities.plan === "power_user"
        ? "24 €"
        : capabilities.plan === "small_agency"
          ? "18 €"
          : null;
  const planPriceSuffix =
    capabilities.plan === "small_agency"
      ? "/ seat / mois"
      : "/ mois · facturation annuelle";

  const tierLabel = isTrialing
    ? t("billing.tier.trial")
    : capabilities.label;

  const statusMap: Record<string, string> = {
    trialing: t("billing.status.trialing"),
    active: t("billing.status.active"),
    past_due: t("billing.status.pastDue"),
    canceled: t("billing.status.canceled"),
    incomplete: t("billing.status.incomplete"),
    inactive: t("billing.status.inactive"),
  };

  const isActive = sub?.status === "active" || sub?.status === "trialing";
  const teamMembers = teamWorkspace?.members ?? [];
  const seatsIncluded = teamWorkspace?.seatsIncluded ?? 0;
  const seatsUsed = teamMembers.length;
  const seatsRemaining = Math.max(0, seatsIncluded - seatsUsed);
  const canManageWorkspace =
    teamWorkspace?.currentUserRole === "owner" ||
    teamWorkspace?.currentUserRole === "admin";

  const handleInviteMember = useCallback(() => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (
      !teamWorkspace ||
      !normalizedEmail ||
      seatsRemaining <= 0 ||
      teamMembers.some((member) => member.email.toLowerCase() === normalizedEmail)
    ) {
      return;
    }

    const inferredName = normalizedEmail.split("@")[0].replace(/[._-]+/g, " ");
    updateTeamWorkspace((current) => {
      if (!current) return current;
      return {
        ...current,
        members: [
          ...current.members,
          {
            id: `invited-${normalizedEmail}`,
            name: inferredName || normalizedEmail,
            email: normalizedEmail,
            role: inviteRole,
            status: "invited",
          },
        ],
      };
    });
    setInviteEmail("");
    setInviteRole("member");
  }, [
    inviteEmail,
    inviteRole,
    seatsRemaining,
    teamMembers,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  const handleRemoveMember = useCallback((memberId: string) => {
    updateTeamWorkspace((current) => {
      if (!current) return current;
      return {
        ...current,
        members: current.members.filter((member) => member.id !== memberId),
      };
    });
  }, [updateTeamWorkspace]);

  return (
    <>
      <PlanComparisonModal
        open={showPlanComparison}
        onClose={() => setShowPlanComparison(false)}
      />
      <div
        style={{
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 26,
          padding: "26px 36px 36px",
        }}
      >
        {/* ── Page header ── */}
        <div>
          <h1
            style={{
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
            {t("billing.subtitle", {
              defaultValue:
                "Gérez votre formule, votre utilisation et vos factures.",
            })}
          </p>
        </div>

        {/* ── Plan hero card ── */}
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
          {/* decorative corner gradient */}
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

          {/* left column */}
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
            {/* badge + status */}
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
              {isActive && (
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
                  {statusMap[sub?.status ?? "active"] ??
                    t("billing.status.active")}
                </span>
              )}
            </div>

            {/* plan name */}
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

            {/* price */}
            {planPrice && !isTrialing && (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.94)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {t("billing.plan.price", { defaultValue: planPrice })}
                </span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.38)" }}>
                  {t("billing.plan.pricePeriod", {
                    defaultValue: planPriceSuffix,
                  })}
                </span>
              </div>
            )}

            {/* meta */}
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)" }}>
              {isTrialing && trialEndsAt && (
                <>
                  {t("billing.plan.trialEnds", {
                    date: formatDate(trialEndsAt, locale),
                  })}
                  {session?.user?.email && (
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
                  )}
                </>
              )}
              {isPremium && !isTrialing && sub?.current_period_ends_at && (
                <>
                  {t("billing.plan.renewsPrefix", {
                    defaultValue: "Prochain renouvellement le",
                  })}{" "}
                  <span
                    style={{ color: "rgba(255,255,255,0.64)", fontWeight: 500 }}
                  >
                    {formatDate(sub.current_period_ends_at, locale)}
                  </span>
                  {session?.user?.email && (
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
                  )}
                </>
              )}
              {isBasicTier && !isTrialing && session?.user?.email && (
                <span
                  style={{ color: "rgba(255,255,255,0.64)", fontWeight: 500 }}
                >
                  {session.user.email}
                </span>
              )}
            </div>
          </div>

          {/* right column — actions */}
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
            {isPremium || isTrialing ? (
              <>
                <button
                  onClick={openUpgradePlans}
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
                  onMouseEnter={(e) =>
                    !portalLoading &&
                    ((e.currentTarget as HTMLButtonElement).style.filter =
                      "brightness(1.07)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.filter = "")
                  }
                >
                  <ExternalLink size={13} />
                  {portalLoading
                    ? t("common.loading", { defaultValue: "Chargement…" })
                    : t("billing.actions.manage.button", {
                        defaultValue: "Gérer l'abonnement →",
                      })}
                </button>
                <button
                  onClick={() => void handleManage()}
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
                    transition: "background 0.15s, color 0.15s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.background = "rgba(255,255,255,0.06)";
                    b.style.color = "rgba(255,255,255,0.94)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.background = "rgba(255,255,255,0.03)";
                    b.style.color = "rgba(255,255,255,0.64)";
                  }}
                >
                  {t("billing.actions.plans", {
                    defaultValue: "Voir tous les plans",
                  })}
                </button>
              </>
            ) : (
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
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.filter =
                    "brightness(1.07)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.filter = "")
                }
              >
                <Zap size={13} />
                {t("billing.actions.upgrade.button", {
                  defaultValue: "Passer à Premium →",
                })}
              </button>
            )}
          </div>
        </div>

        {/* ── Usage ── */}
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
                {t("billing.usage.title", { defaultValue: "Utilisation" })}
              </span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)" }}>
                {t("billing.usage.period", {
                  defaultValue: "Période en cours",
                })}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  quota && stats && capabilities.canViewAdvancedStats
                    ? "1fr 1fr 1fr"
                    : quota
                      ? "1fr 1fr"
                      : "1fr 1fr",
                gap: 12,
              }}
            >
              {quota && (
                <UsageCard
                  label={t("billing.usage.transcriptions", {
                    defaultValue: "Dictées",
                  })}
                  used={quota.count}
                  limit={quota.limit}
                  locale={locale}
                  footer={
                    quota.reset_at
                      ? t("billing.usage.resetsOn", {
                          defaultValue: "Réinitialisation le {{date}}",
                          date: formatDate(quota.reset_at, locale),
                        })
                      : t("billing.usage.weeklyReset", {
                          defaultValue: "Reset hebdomadaire",
                        })
                  }
                />
              )}
              {stats && capabilities.canViewAdvancedStats && (
                <UsageCard
                  label={t("billing.stats.words", {
                    defaultValue: "Mots dictés",
                  })}
                  used={stats.total_words}
                  limit={Math.max(stats.total_words, 10000)}
                  locale={locale}
                  footer={t("billing.stats.allTime", {
                    defaultValue: "Total depuis le début",
                  })}
                />
              )}
              {stats && capabilities.canViewAdvancedStats && (
                <UsageCard
                  label={t("billing.stats.sessions", {
                    defaultValue: "Dictées totales",
                  })}
                  used={stats.total_entries}
                  limit={Math.max(stats.total_entries, 500)}
                  locale={locale}
                  footer={t("billing.stats.allSessions", {
                    defaultValue: "Total historique",
                  })}
                />
              )}
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
              Comparatif des plans
            </span>
            <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)" }}>
              Resume rapide avant d'ouvrir le detail
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
                Independent, Power user, Small agency
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                Ouvre le comparatif complet pour voir les differences sur
                l'historique, les actions IA, les templates, l'equipe et le
                support.
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
              Voir les differences
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
                Workspace agence
              </span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.22)" }}>
                SiÃ¨ges, membres, templates et admin au mÃªme endroit
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
                        ? "Owner workspace"
                        : "Admin workspace"}{" "}
                      · {seatsUsed}/{seatsIncluded} siÃ¨ges utilisÃ©s
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
                    {seatsRemaining} siÃ¨ge{seatsRemaining > 1 ? "s" : ""} libre
                    {seatsRemaining > 1 ? "s" : ""}
                  </div>
                </div>

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
                    placeholder="coequipier@agence.com"
                    disabled={!canManageWorkspace || seatsRemaining <= 0}
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
                    disabled={!canManageWorkspace || seatsRemaining <= 0}
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
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleInviteMember}
                    disabled={!canManageWorkspace || !inviteEmail.trim() || seatsRemaining <= 0}
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
                        !canManageWorkspace || !inviteEmail.trim() || seatsRemaining <= 0
                          ? 0.45
                          : 1,
                    }}
                  >
                    <UserPlus size={14} />
                    Inviter
                  </button>
                </div>

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
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: "rgba(255,255,255,0.94)",
                          }}
                        >
                          {member.name}
                        </div>
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
                          textTransform: "capitalize",
                        }}
                      >
                        {member.role} · {member.status}
                      </div>

                      {member.role !== "owner" ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={!canManageWorkspace}
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
                          Retirer
                        </button>
                      ) : (
                        <span
                          style={{
                            fontSize: 11.5,
                            color: "rgba(255,255,255,0.32)",
                          }}
                        >
                          Owner
                        </span>
                      )}
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
                      Bibliotheque partagee
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
                      ["Templates", String(teamWorkspace.sharedTemplates.length)],
                      ["Snippets", String(teamWorkspace.sharedSnippets.length)],
                      ["Termes", String(teamWorkspace.sharedDictionary.length)],
                      ["Support", "Priority"],
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
                </div>

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
                      Admin et facturation
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: "rgba(255,255,255,0.42)",
                    }}
                  >
                    Le workspace centralise les siÃ¨ges, les ressources
                    partagÃ©es et le contact de facturation.
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
                      Billing owner: {teamWorkspace.billingContactEmail}
                    </div>
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
                      Priority support: {teamWorkspace.supportContactEmail}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Bottom row: Payment + Invoices ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "380px 1fr",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          {/* Payment method */}
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
                {t("billing.payment.title", {
                  defaultValue: "Méthode de paiement",
                })}
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
                    {t("billing.payment.managed", {
                      defaultValue: "Géré via Stripe",
                    })}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "rgba(255,255,255,0.38)",
                      marginTop: 2,
                    }}
                  >
                    {t("billing.payment.securePortal", {
                      defaultValue: "Portail sécurisé",
                    })}
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
                    transition: "background 0.15s, color 0.15s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.background = "rgba(255,255,255,0.06)";
                    b.style.color = "rgba(255,255,255,0.94)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.background = "rgba(255,255,255,0.02)";
                    b.style.color = "rgba(255,255,255,0.64)";
                  }}
                >
                  {t("billing.payment.modify", { defaultValue: "Modifier" })}
                </button>
              </div>
              {session?.user?.email && (
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
                    {t("billing.payment.billedTo", {
                      defaultValue: "Facturé à",
                    })}
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
              )}
            </div>
          </div>

          {/* Invoices */}
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
                {t("billing.invoices.title", {
                  defaultValue: "Factures récentes",
                })}
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
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.color =
                    "#e8c87a")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.color =
                    "#c9a84c")
                }
              >
                {t("billing.invoices.viewAll", { defaultValue: "Tout voir →" })}
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
              {/* Table header */}
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
                <span>
                  {t("billing.invoices.colDate", { defaultValue: "Date" })}
                </span>
                <span>
                  {t("billing.invoices.colDescription", {
                    defaultValue: "Description",
                  })}
                </span>
                <span>
                  {t("billing.invoices.colStatus", { defaultValue: "Statut" })}
                </span>
                <span style={{ textAlign: "right" }}>
                  {t("billing.invoices.colAmount", { defaultValue: "Montant" })}
                </span>
                <span />
              </div>

              {/* Empty state — data lives in Stripe portal */}
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
                  {t("billing.invoices.portalHint", {
                    defaultValue:
                      "Vos factures sont disponibles dans le portail Stripe.",
                  })}
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
                    transition: "background 0.15s",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(201,168,76,0.13)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(201,168,76,0.08)")
                  }
                >
                  <ExternalLink size={11} />
                  {t("billing.invoices.openPortal", {
                    defaultValue: "Ouvrir le portail →",
                  })}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
};

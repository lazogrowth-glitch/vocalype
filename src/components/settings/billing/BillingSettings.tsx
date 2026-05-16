import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CreditCard, Download, ExternalLink, Zap } from "lucide-react";
import { commands, type HistoryStats } from "@/bindings";
import { authClient } from "@/lib/auth/client";
import type { AuthSession } from "@/lib/auth/types";
import { usePlan } from "@/lib/subscription/context";

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
  } = usePlan();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

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
  const workspaceRole = teamWorkspace?.currentUserRole ?? null;
  const canSeeWorkspaceBilling =
    capabilities.plan === "small_agency" &&
    (workspaceRole === "owner" || workspaceRole === "admin");
  const canOpenWorkspaceBillingPortal = sub?.can_manage_billing === true;
  const isManagedByAgency =
    capabilities.plan === "small_agency" &&
    !canSeeWorkspaceBilling &&
    sub?.can_manage_billing === false;
  const tierLabel = isTrialing
    ? t("billing.tier.trial")
    : t(`billing.tier.${capabilities.plan}`, {
        defaultValue: capabilities.label,
      });
  const showPersonalBilling = !isManagedByAgency;

  const statusMap: Record<string, string> = {
    trialing: t("billing.status.trialing"),
    active: t("billing.status.active"),
    past_due: t("billing.status.pastDue"),
    canceled: t("billing.status.canceled"),
    incomplete: t("billing.status.incomplete"),
    inactive: t("billing.status.inactive"),
  };

  return (
    <>
      <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 26,
            padding: "26px 36px 36px",
          }}
        >
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
                    {statusMap[sub?.status ?? "active"] ??
                      t("billing.status.active")}
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
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 4 }}
                >
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
                  <span
                    style={{ fontSize: 13, color: "rgba(255,255,255,0.38)" }}
                  >
                    {planPriceSuffix}
                  </span>
                </div>
              )}

              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)" }}>
                {isManagedByAgency
                  ? t("billing.workspace.managedByWorkspaceDescription")
                  : null}
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
                {isPremium &&
                !isTrialing &&
                sub?.current_period_ends_at &&
                showPersonalBilling ? (
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
              {showPersonalBilling &&
              (isPremium || isTrialing) &&
              canOpenWorkspaceBillingPortal ? (
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

              {showPersonalBilling &&
              (isPremium || isTrialing) &&
              !canOpenWorkspaceBillingPortal ? (
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
                  {t("billing.workspace.managedByWorkspaceDescription")}
                </div>
              ) : null}

              {showPersonalBilling &&
              !isPremium &&
              !isTrialing &&
              canOpenWorkspaceBillingPortal ? (
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
                  />
                ) : null}
                {stats && capabilities.canViewAdvancedStats ? (
                  <UsageCard
                    label={t("billing.stats.sessions")}
                    used={stats.total_entries}
                    limit={Math.max(stats.total_entries, 500)}
                    locale={locale}
                  />
                ) : null}
              </div>
            </div>
          )}

          {showPersonalBilling ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "380px 1fr",
                gap: 24,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 12 }}
                >
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
                    </div>
                    {canOpenWorkspaceBillingPortal ? (
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
                    ) : null}
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

              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 12 }}
                >
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
                  {canOpenWorkspaceBillingPortal ? (
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
                  ) : null}
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
                    {canOpenWorkspaceBillingPortal ? (
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
                    ) : null}
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

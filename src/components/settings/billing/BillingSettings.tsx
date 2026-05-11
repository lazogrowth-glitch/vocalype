import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CreditCard, Download, ExternalLink, Star, Zap } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import type { AuthSession } from "@/lib/auth/types";
import { usePlan } from "@/lib/subscription/context";
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

// ── Main component ────────────────────────────────────────────────────────────

export const BillingSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { isBasicTier, isTrialing, trialEndsAt, quota, openUpgradePlans } =
    usePlan();
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
      /* ignore */
    } finally {
      setPortalLoading(false);
    }
  }, []);

  const sub = session?.subscription;
  const isPremium = sub?.tier === "premium";
  const locale = i18n.resolvedLanguage || i18n.language || undefined;

  const tierLabel = isTrialing
    ? t("billing.tier.trial")
    : isPremium
      ? t("billing.tier.premium")
      : t("billing.tier.basic");

  const statusMap: Record<string, string> = {
    trialing: t("billing.status.trialing"),
    active: t("billing.status.active"),
    past_due: t("billing.status.pastDue"),
    canceled: t("billing.status.canceled"),
    incomplete: t("billing.status.incomplete"),
    inactive: t("billing.status.inactive"),
  };

  const isActive = sub?.status === "active" || sub?.status === "trialing";

  return (
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
            {isPremium && !isTrialing && (
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
                  {t("billing.plan.price", { defaultValue: "12 €" })}
                </span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.38)" }}>
                  {t("billing.plan.pricePeriod", {
                    defaultValue: "/ mois · facturation annuelle",
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
        {(quota || stats) && (
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
                  quota && stats
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
              {stats && (
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
              {stats && (
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
  );
};

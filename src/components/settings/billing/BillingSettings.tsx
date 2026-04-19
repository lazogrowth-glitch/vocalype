import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CreditCard, ExternalLink, Zap } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import type { AuthSession } from "@/lib/auth/types";
import { usePlan } from "@/lib/subscription/context";
import { commands, type HistoryStats } from "@/bindings";
import { Button } from "../../ui/Button";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { FeatureGateHint } from "../../ui/FeatureGateHint";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-white/50">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
        <span
          className={isHigh ? "font-medium text-amber-400" : "text-white/40"}
        >
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full transition-all ${
            isHigh ? "bg-amber-400" : "bg-logo-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const BillingSettings: React.FC = () => {
  const { t } = useTranslation();
  const { isBasicTier, isTrialing, trialEndsAt, quota, onStartCheckout } =
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

  const handleUpgrade = useCallback(async () => {
    try {
      const url = await onStartCheckout();
      if (url) await openUrl(url);
    } catch {
      /* handled upstream */
    }
  }, [onStartCheckout]);

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
  const canManageBilling = sub?.can_manage_billing ?? false;

  // Tier label
  const tierLabel = isTrialing
    ? t("billing.tier.trial", { defaultValue: "Premium (trial)" })
    : isPremium
      ? t("billing.tier.premium", { defaultValue: "Premium" })
      : t("billing.tier.basic", { defaultValue: "Basic" });

  // Status label
  const statusLabel: Record<string, string> = {
    trialing: t("billing.status.trialing", { defaultValue: "Trialing" }),
    active: t("billing.status.active", { defaultValue: "Active" }),
    past_due: t("billing.status.pastDue", { defaultValue: "Past due" }),
    canceled: t("billing.status.canceled", { defaultValue: "Canceled" }),
    incomplete: t("billing.status.incomplete", { defaultValue: "Incomplete" }),
    inactive: t("billing.status.inactive", { defaultValue: "Inactive" }),
  };

  return (
    <div className="w-full">
      {/* Header */}
      <section
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-logo-primary/20 bg-logo-primary/10">
          <CreditCard size={18} className="text-logo-primary" />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold text-white/90">
            {t("billing.title", { defaultValue: "Billing & Subscription" })}
          </h1>
          <p className="text-[12px] text-white/40">
            {session?.user?.email ?? ""}
          </p>
        </div>
      </section>

      {/* Current plan */}
      <SettingsGroup
        title={t("billing.plan.title", { defaultValue: "Current plan" })}
      >
        <SettingContainer
          title={tierLabel}
          description={
            sub?.status
              ? (statusLabel[sub.status] ?? sub.status)
              : t("billing.plan.noSubscription", {
                  defaultValue: "No active subscription",
                })
          }
          grouped={false}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isTrialing && trialEndsAt && (
              <span className="text-[12px] text-white/40">
                {t("billing.plan.trialEnds", {
                  defaultValue: "Ends {{date}}",
                  date: formatDate(trialEndsAt),
                })}
              </span>
            )}
            {isPremium && !isTrialing && sub?.current_period_ends_at && (
              <span className="text-[12px] text-white/40">
                {t("billing.plan.renewsOn", {
                  defaultValue: "Renews {{date}}",
                  date: formatDate(sub.current_period_ends_at),
                })}
              </span>
            )}
          </div>
        </SettingContainer>
      </SettingsGroup>

      {/* Usage */}
      {quota && (
        <SettingsGroup
          title={t("billing.usage.title", { defaultValue: "Weekly usage" })}
          description={t("billing.usage.description", {
            defaultValue:
              "Resets every Monday. Usage is approximate — based on transcription count.",
          })}
        >
          <div
            className="voca-surface"
            style={{
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <p className="text-[12px] font-medium text-white/60">
              {t("billing.usage.transcriptions", {
                defaultValue: "Transcriptions this week",
              })}
            </p>
            <UsageBar used={quota.count} limit={quota.limit} />
            {quota.reset_at && (
              <p className="text-[11px] text-white/30">
                {t("billing.usage.resetsOn", {
                  defaultValue: "Resets {{date}}",
                  date: formatDate(quota.reset_at),
                })}
              </p>
            )}
          </div>
        </SettingsGroup>
      )}

      {/* Local stats */}
      {stats && (
        <SettingsGroup
          title={t("billing.stats.title", { defaultValue: "All-time stats" })}
        >
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            <div className="voca-surface" style={{ padding: "24px" }}>
              <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                {t("billing.stats.words", { defaultValue: "Words dictated" })}
              </p>
              <p
                style={{ marginTop: 4 }}
                className="text-[28px] font-semibold leading-none text-white/90"
              >
                {stats.total_words.toLocaleString()}
              </p>
            </div>
            <div className="voca-surface" style={{ padding: "24px" }}>
              <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                {t("billing.stats.sessions", {
                  defaultValue: "Total sessions",
                })}
              </p>
              <p
                style={{ marginTop: 4 }}
                className="text-[28px] font-semibold leading-none text-white/90"
              >
                {stats.total_entries.toLocaleString()}
              </p>
            </div>
          </div>
        </SettingsGroup>
      )}

      {/* Upgrade prompt for basic */}
      {isBasicTier && (
        <FeatureGateHint
          tone="premium"
          title={t("billing.upgrade.title", {
            defaultValue: "Upgrade to Premium",
          })}
          description={t("billing.upgrade.description", {
            defaultValue:
              "Unlock unlimited dictation, custom shortcuts, and full history across all your apps.",
          })}
          actionLabel={t("billing.upgrade.cta", {
            defaultValue: "Upgrade now →",
          })}
          onAction={handleUpgrade}
        />
      )}

      {/* Actions */}
      <SettingsGroup
        title={t("billing.actions.title", { defaultValue: "Actions" })}
      >
        {canManageBilling && (
          <SettingContainer
            title={t("billing.actions.manage.title", {
              defaultValue: "Manage subscription",
            })}
            description={t("billing.actions.manage.description", {
              defaultValue:
                "Update payment method, cancel, or change plan via Stripe.",
            })}
            grouped={false}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleManage()}
              disabled={portalLoading}
            >
              <ExternalLink size={13} className="mr-1.5" />
              {portalLoading
                ? t("common.loading", { defaultValue: "Loading…" })
                : t("billing.actions.manage.button", {
                    defaultValue: "Manage →",
                  })}
            </Button>
          </SettingContainer>
        )}
        {!canManageBilling && (
          <SettingContainer
            title={t("billing.actions.upgrade.title", {
              defaultValue: isTrialing
                ? "Start Premium subscription"
                : "Upgrade to Premium",
            })}
            description={t("billing.actions.upgrade.description", {
              defaultValue: isTrialing
                ? "Start your paid subscription via Stripe before the trial ends."
                : "Start your premium subscription via Stripe.",
            })}
            grouped={false}
          >
            <Button
              variant="primary-soft"
              size="sm"
              onClick={() => void handleUpgrade()}
            >
              <Zap size={13} className="mr-1.5" />
              {t("billing.actions.upgrade.button", {
                defaultValue: "Upgrade →",
              })}
            </Button>
          </SettingContainer>
        )}
      </SettingsGroup>
    </div>
  );
};

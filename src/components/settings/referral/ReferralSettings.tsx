import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, Gift, Share2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import type { ReferralCode, ReferralStats } from "@/lib/auth/types";
import { Button } from "../../ui/Button";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";

// ── Stat card ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  label: string;
  value: string | number;
  sub?: string;
}> = ({ label, value, sub }) => (
  <div className="flex flex-col gap-1 rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
    <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/30">
      {label}
    </p>
    <p className="text-[22px] font-semibold leading-none text-white/90">
      {value}
    </p>
    {sub && <p className="text-[11px] text-white/35">{sub}</p>}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

export const ReferralSettings: React.FC = () => {
  const { t } = useTranslation();
  const [code, setCode] = useState<ReferralCode | null>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = authClient.getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    Promise.all([
      authClient.getReferralCode(token),
      authClient.getReferralStats(token),
    ])
      .then(([codeData, statsData]) => {
        setCode(codeData);
        setStats(statsData);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = useCallback(async () => {
    if (!code?.referral_url) return;
    try {
      await navigator.clipboard.writeText(code.referral_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback: do nothing */
    }
  }, [code]);

  const handleShare = useCallback(async () => {
    if (!code?.referral_url) return;
    await openUrl(code.referral_url);
  }, [code]);

  const isLoggedOut = !authClient.getStoredToken();

  if (isLoggedOut) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white/30">
        <Gift size={32} className="opacity-40" />
        <p className="text-[13px]">
          {t("referral.loginRequired", {
            defaultValue: "Log in to access your referral program.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <section className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-green-500/20 bg-green-500/10">
          <Gift size={18} className="text-green-400" />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold text-white/90">
            {t("referral.title", { defaultValue: "Refer & Earn" })}
          </h1>
          <p className="text-[12px] text-white/40">
            {t("referral.subtitle", {
              defaultValue:
                "Invite friends and earn free Premium months for each conversion.",
            })}
          </p>
        </div>
      </section>

      {/* Your referral link */}
      <SettingsGroup
        title={t("referral.link.title", { defaultValue: "Your referral link" })}
      >
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-4 space-y-3">
          {loading ? (
            <p className="text-[13px] text-white/30">
              {t("common.loading", { defaultValue: "Loading…" })}
            </p>
          ) : error ? (
            <p className="text-[13px] text-amber-400/80">
              {t("referral.link.unavailable", {
                defaultValue: "Referral link not available yet.",
              })}
            </p>
          ) : code ? (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <p className="truncate text-[13px] font-mono text-white/70">
                    {code.referral_url}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleCopy()}
                  className="shrink-0"
                >
                  {copied ? (
                    <>
                      <Check size={13} className="mr-1.5 text-green-400" />
                      {t("referral.link.copied", { defaultValue: "Copied!" })}
                    </>
                  ) : (
                    <>
                      <Copy size={13} className="mr-1.5" />
                      {t("referral.link.copy", { defaultValue: "Copy" })}
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleShare()}
                  className="shrink-0"
                  title={t("referral.link.openInBrowser", {
                    defaultValue: "Open in browser",
                  })}
                >
                  <Share2 size={13} />
                </Button>
              </div>
              <p className="text-[11px] text-white/30">
                {t("referral.link.codeLabel", {
                  defaultValue: "Your code: {{code}}",
                  code: code.code,
                })}
              </p>
            </>
          ) : null}
        </div>
      </SettingsGroup>

      {/* Stats */}
      {stats && (
        <SettingsGroup
          title={t("referral.stats.title", { defaultValue: "Your referrals" })}
        >
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label={t("referral.stats.invited", { defaultValue: "Invited" })}
              value={stats.referral_count}
            />
            <StatCard
              label={t("referral.stats.converted", {
                defaultValue: "Converted",
              })}
              value={stats.converted_count}
            />
            <StatCard
              label={t("referral.stats.earned", {
                defaultValue: "Months earned",
              })}
              value={stats.earned_months}
              sub={
                stats.earned_months > 0
                  ? t("referral.stats.earnedSub", {
                      defaultValue: "Free Premium",
                    })
                  : undefined
              }
            />
          </div>
        </SettingsGroup>
      )}

      {/* How it works */}
      <SettingsGroup
        title={t("referral.howItWorks.title", { defaultValue: "How it works" })}
      >
        <SettingContainer
          title={t("referral.howItWorks.step1.title", {
            defaultValue: "Share your link",
          })}
          description={t("referral.howItWorks.step1.description", {
            defaultValue:
              "Send your unique referral link to friends, teammates, or your audience.",
          })}
          grouped={false}
        >
          <></>
        </SettingContainer>
        <SettingContainer
          title={t("referral.howItWorks.step2.title", {
            defaultValue: "They sign up and subscribe",
          })}
          description={t("referral.howItWorks.step2.description", {
            defaultValue:
              "When a friend creates an account and upgrades to Premium using your link, the referral is counted.",
          })}
          grouped={false}
        >
          <></>
        </SettingContainer>
        <SettingContainer
          title={t("referral.howItWorks.step3.title", {
            defaultValue: "You both earn Premium",
          })}
          description={t("referral.howItWorks.step3.description", {
            defaultValue:
              "You earn one free month of Premium per successful conversion. Your friend gets a discount too.",
          })}
          grouped={false}
        >
          <></>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};

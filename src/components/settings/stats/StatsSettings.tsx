/* eslint-disable i18next/no-literal-string */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  BookOpen,
  Clock3,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { commands, type HistoryStats } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";

interface TopCorrection {
  from: string;
  to: string;
  count: number;
}

interface LearningStats {
  total_corrections_recorded: number;
  distinct_corrections: number;
  dictionary_entries: number;
  auto_learned_pairs: number;
  top_corrections: TopCorrection[];
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function estimatedTimeSaved(words: number): string {
  const seconds = Math.round((words / 40) * 60);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem} min` : `${hours}h`;
}

const StatCard: React.FC<{
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "gold" | "blue" | "green" | "default";
}> = ({ label, value, sub, icon, tone = "default" }) => {
  const accentClasses =
    tone === "gold"
      ? {
          wrap: "border-logo-primary/14 bg-logo-primary/[0.08] text-logo-primary",
          bar: "bg-logo-primary",
        }
      : tone === "blue"
        ? {
            wrap: "border-sky-400/16 bg-sky-400/[0.08] text-sky-300",
            bar: "bg-sky-300",
          }
        : tone === "green"
          ? {
              wrap: "border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-300",
              bar: "bg-emerald-300",
            }
          : {
              wrap: "border-white/10 bg-white/[0.04] text-white/52",
              bar: "bg-white/14",
            };

  return (
    <div
      className="rounded-xl border border-white/8 bg-white/[0.03]"
      style={{ padding: "16px 20px" }}
    >
      <div className={`mb-4 h-[3px] w-12 rounded-full ${accentClasses.bar}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
            {label}
          </p>
          <p
            style={{ marginTop: 6 }}
            className="text-[30px] font-semibold leading-none text-white/92"
          >
            {value}
          </p>
        </div>
        {icon ? (
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-[11px] border ${accentClasses.wrap}`}
          >
            {icon}
          </div>
        ) : null}
      </div>
      {sub ? (
        <p
          style={{ marginTop: 12 }}
          className="text-[12px] leading-relaxed text-white/40"
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
};

const StatLine: React.FC<{ label: string; value: string | number }> = ({
  label,
  value,
}) => (
  <div className="flex min-h-[42px] items-center justify-between gap-4 px-1 py-2.5">
    <span className="text-[12px] leading-[18px] text-white/46">{label}</span>
    <span className="shrink-0 text-[14px] font-semibold leading-none text-white/90">
      {value}
    </span>
  </div>
);

interface UserProfile {
  learned_terms: string[];
  auto_synced_count: number;
}

interface WeeklyInsight {
  kind: string;
  message: string;
  value: number | null;
}

interface WeeklyReport {
  period_start_ts: number;
  period_end_ts: number;
  sessions_this_week: number;
  sessions_last_week: number;
  words_this_week: number;
  words_last_week: number;
  avg_words_per_session: number;
  daily_sessions: number[];
  peak_hour_label: string | null;
  corrections_total: number;
  profile_terms: number;
  dictionary_entries: number;
  insights: WeeklyInsight[];
}

// ── Mini bar chart for daily sessions ────────────────────────────────────────

const DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

const MiniBarChart: React.FC<{ data: number[] }> = ({ data }) => {
  const max = Math.max(...data, 1);
  const today = (new Date().getDay() + 6) % 7; // 0=Mon
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 36 }}>
      {data.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
          <div
            className={`w-full rounded-sm transition-all ${
              i === today ? "bg-logo-primary/60" : "bg-white/[0.10]"
            }`}
            style={{ height: `${Math.max(2, (v / max) * 32)}px` }}
          />
          <span
            className={`text-[9px] font-medium ${
              i === today ? "text-logo-primary/70" : "text-white/20"
            }`}
          >
            {DAY_LABELS[i]}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Insight icon ─────────────────────────────────────────────────────────────

const InsightIcon: React.FC<{ kind: string }> = ({ kind }) => {
  switch (kind) {
    case "growth":
      return <TrendingUp size={13} className="text-emerald-400" />;
    case "decline":
      return <TrendingDown size={13} className="text-amber-400" />;
    case "peak_time":
      return <Clock3 size={13} className="text-sky-400" />;
    case "learning":
      return <Sparkles size={13} className="text-logo-primary" />;
    case "milestone":
      return <Zap size={13} className="text-amber-400" />;
    default:
      return <Activity size={13} className="text-white/40" />;
  }
};

export const StatsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [learning, setLearning] = useState<LearningStats | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [histResult, learnResult, profileResult, reportResult] =
        await Promise.all([
          commands.getHistoryStats(),
          invoke<LearningStats>("get_learning_stats").catch(() => null),
          invoke<UserProfile>("get_user_profile").catch(() => null),
          invoke<WeeklyReport>("get_weekly_report").catch(() => null),
        ]);
      if (histResult.status === "ok") setStats(histResult.data);
      if (learnResult) setLearning(learnResult);
      if (profileResult) setProfile(profileResult);
      if (reportResult) setReport(reportResult);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const added = await invoke<number>("sync_dictionary_to_profile");
      const refreshed = await invoke<UserProfile>("get_user_profile");
      setProfile(refreshed);
      if (added > 0) {
        // re-fetch learning stats too since dict may have changed
        const learnResult = await invoke<LearningStats>(
          "get_learning_stats",
        ).catch(() => null);
        if (learnResult) setLearning(learnResult);
      }
    } catch {
      // silently ignore
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveTerm = async (term: string) => {
    try {
      await invoke("remove_profile_term", { term });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              learned_terms: prev.learned_terms.filter(
                (t) => t.toLowerCase() !== term.toLowerCase(),
              ),
            }
          : prev,
      );
    } catch {
      // silently ignore
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !stats) {
    return (
      <div style={{ paddingTop: 8 }}>
        <p className="text-[13px] italic text-white/30">
          {t("stats.loading", { defaultValue: "Chargement..." })}
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{ paddingTop: 8 }}>
        <p className="text-[13px] italic text-white/30">
          {t("stats.empty", { defaultValue: "Aucune donnée disponible." })}
        </p>
      </div>
    );
  }

  const avgWords =
    stats.total_entries > 0
      ? Math.round(stats.total_words / stats.total_entries)
      : 0;
  return (
    <div className="w-full">
      <section
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-logo-primary/20 bg-logo-primary/10">
            <BarChart3 size={18} className="text-logo-primary" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-white/90">
              {t("stats.title", { defaultValue: "Statistiques" })}
            </h1>
            <p className="text-[12px] text-white/40">
              {t("stats.subtitle", {
                defaultValue:
                  "Un aperçu simple de votre usage et de vos résultats dans l'app.",
              })}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/34 transition-colors hover:bg-white/[0.07] hover:text-white/70 disabled:opacity-50"
          title={t("stats.refresh", { defaultValue: "Actualiser" })}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </section>

      {report && report.sessions_this_week > 0 && (
        <SettingsGroup
          title={t("stats.weeklyReport", { defaultValue: "Cette semaine" })}
          description={t("stats.weeklyReportDescription", {
            defaultValue:
              "Votre usage des 7 derniers jours et ce que Vocalype a appris.",
          })}
        >
          {/* Top row: sessions + words + bars */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
            }}
          >
            <div
              className="rounded-xl border border-white/8 bg-white/[0.03]"
              style={{ padding: "14px 16px" }}
            >
              <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                {t("stats.weekSessions", { defaultValue: "Sessions" })}
              </p>
              <p className="mt-1.5 text-[26px] font-semibold leading-none text-white/90">
                {report.sessions_this_week}
              </p>
              {report.sessions_last_week > 0 && (
                <p className="mt-2 text-[11px] text-white/36">
                  {report.sessions_this_week >= report.sessions_last_week
                    ? "+"
                    : ""}
                  {report.sessions_this_week - report.sessions_last_week} vs
                  sem. passée
                </p>
              )}
            </div>

            <div
              className="rounded-xl border border-white/8 bg-white/[0.03]"
              style={{ padding: "14px 16px" }}
            >
              <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                {t("stats.weekWords", { defaultValue: "Mots dictés" })}
              </p>
              <p className="mt-1.5 text-[26px] font-semibold leading-none text-white/90">
                {report.words_this_week.toLocaleString()}
              </p>
              {report.avg_words_per_session > 0 && (
                <p className="mt-2 text-[11px] text-white/36">
                  ~{report.avg_words_per_session} mots / session
                </p>
              )}
            </div>

            <div
              className="rounded-xl border border-white/8 bg-white/[0.03]"
              style={{ padding: "14px 16px" }}
            >
              <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-white/30">
                {t("stats.weekActivity", { defaultValue: "Activité" })}
              </p>
              <MiniBarChart data={report.daily_sessions} />
              {report.peak_hour_label && (
                <p className="mt-2 text-[11px] text-white/36">
                  Pic : {report.peak_hour_label}
                </p>
              )}
            </div>
          </div>

          {/* Insight cards */}
          {report.insights.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {report.insights.map((insight, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="mt-0.5 shrink-0">
                    <InsightIcon kind={insight.kind} />
                  </div>
                  <p className="text-[12.5px] leading-[1.5] text-white/65">
                    {insight.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup
        title={t("stats.overview", { defaultValue: "Vue d'ensemble" })}
        description={t("stats.overviewDescription", {
          defaultValue:
            "Les métriques les plus utiles à lire d'un coup d'oeil.",
        })}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <StatCard
            label={t("stats.totalWords", { defaultValue: "Mots dictés" })}
            value={formatNumber(stats.total_words)}
            sub={t("stats.timeSaved", {
              defaultValue: "≈ {{time}} économisés",
              time: estimatedTimeSaved(stats.total_words),
            })}
            icon={<Sparkles size={15} />}
            tone="gold"
          />
          <StatCard
            label={t("stats.totalEntries", { defaultValue: "Transcriptions" })}
            value={formatNumber(stats.total_entries)}
            sub={t("stats.totalEntriesSub", {
              defaultValue: "Nombre total de résultats enregistrés.",
            })}
            icon={<Activity size={15} />}
            tone="blue"
          />
          <StatCard
            label={t("stats.today", { defaultValue: "Aujourd'hui" })}
            value={formatNumber(stats.entries_today)}
            sub={t("stats.transcriptions", {
              defaultValue: "transcriptions",
            })}
            icon={<Waves size={15} />}
            tone="green"
          />
          <StatCard
            label={t("stats.thisWeek", { defaultValue: "Cette semaine" })}
            value={formatNumber(stats.entries_this_week)}
            sub={t("stats.transcriptions", {
              defaultValue: "transcriptions",
            })}
            icon={<BarChart3 size={15} />}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("stats.insights", { defaultValue: "Repères" })}
        description={t("stats.insightsDescription", {
          defaultValue:
            "Quelques repères simples pour comprendre votre rythme.",
        })}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <div
            className="rounded-xl border border-white/8 bg-white/[0.03]"
            style={{ padding: "16px 20px" }}
          >
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
              {t("stats.mostUsedModel", {
                defaultValue: "Modèle le plus utilisé",
              })}
            </p>
            <p
              style={{ marginTop: 8 }}
              className="text-[18px] font-semibold leading-snug text-white/90"
            >
              {stats.most_used_model ??
                t("stats.noModel", {
                  defaultValue: "Aucun modèle dominant pour l'instant",
                })}
            </p>
            <p style={{ marginTop: 10 }} className="text-[12px] text-white/40">
              {t("stats.modelSub", {
                defaultValue: "Le moteur que vous utilisez le plus souvent.",
              })}
            </p>
          </div>

          <div
            className="rounded-xl border border-white/8 bg-white/[0.03]"
            style={{ padding: "16px 20px" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                  {t("stats.avgWords", {
                    defaultValue: "Mots par transcription",
                  })}
                </p>
                <p
                  style={{ marginTop: 6 }}
                  className="text-[30px] font-semibold leading-none text-white/92"
                >
                  {avgWords}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-white/10 bg-white/[0.04] text-white/52">
                <Clock3 size={15} />
              </div>
            </div>
            <p style={{ marginTop: 12 }} className="text-[12px] text-white/40">
              {t("stats.avgWordsSub", {
                defaultValue: "Longueur moyenne de chaque transcription.",
              })}
            </p>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("stats.quickRead", { defaultValue: "Lecture rapide" })}
      >
        <div
          className="rounded-xl border border-white/8 bg-white/[0.03]"
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="border-b border-white/[0.06]">
            <StatLine
              label={t("stats.snapshotEntries", {
                defaultValue: "Sessions totales",
              })}
              value={formatNumber(stats.total_entries)}
            />
          </div>
          <div className="border-b border-white/[0.06]">
            <StatLine
              label={t("stats.snapshotWords", { defaultValue: "Mots dictés" })}
              value={formatNumber(stats.total_words)}
            />
          </div>
          <StatLine
            label={t("stats.snapshotTime", {
              defaultValue: "Temps gagné estimé",
            })}
            value={estimatedTimeSaved(stats.total_words)}
          />
        </div>
      </SettingsGroup>

      {learning &&
        (learning.total_corrections_recorded > 0 ||
          learning.dictionary_entries > 0) && (
          <SettingsGroup
            title={t("stats.learning", { defaultValue: "Apprentissage" })}
            description={t("stats.learningDescription", {
              defaultValue:
                "Ce que Vocalype a appris de vos corrections. Plus vous corrigez, moins il y a d'erreurs.",
            })}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <div
                className="rounded-xl border border-logo-primary/14 bg-logo-primary/[0.06]"
                style={{ padding: "16px 20px" }}
              >
                <div className="mb-3 h-[3px] w-10 rounded-full bg-logo-primary" />
                <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                  {t("stats.correctionsRecorded", {
                    defaultValue: "Corrections",
                  })}
                </p>
                <p
                  style={{ marginTop: 6 }}
                  className="text-[28px] font-semibold leading-none text-white/92"
                >
                  {formatNumber(learning.total_corrections_recorded)}
                </p>
                <p
                  style={{ marginTop: 10 }}
                  className="text-[11px] text-white/36"
                >
                  {t("stats.correctionsRecordedSub", {
                    defaultValue: "{{n}} paires distinctes",
                    n: learning.distinct_corrections,
                  })}
                </p>
              </div>

              <div
                className="rounded-xl border border-white/8 bg-white/[0.03]"
                style={{ padding: "16px 20px" }}
              >
                <div className="mb-3 h-[3px] w-10 rounded-full bg-white/14" />
                <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                  {t("stats.dictionaryEntries", {
                    defaultValue: "Dictionnaire",
                  })}
                </p>
                <p
                  style={{ marginTop: 6 }}
                  className="text-[28px] font-semibold leading-none text-white/92"
                >
                  {formatNumber(learning.dictionary_entries)}
                </p>
                <p
                  style={{ marginTop: 10 }}
                  className="text-[11px] text-white/36"
                >
                  {t("stats.dictionaryEntriesSub", {
                    defaultValue: "{{n}} appris automatiquement",
                    n: learning.auto_learned_pairs,
                  })}
                </p>
              </div>

              <div
                className="rounded-xl border border-white/8 bg-white/[0.03]"
                style={{ padding: "16px 20px" }}
              >
                <div className="mb-3 h-[3px] w-10 rounded-full bg-white/14" />
                <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                  {t("stats.switchingCost", {
                    defaultValue: "Valeur accumulée",
                  })}
                </p>
                <p
                  style={{ marginTop: 6 }}
                  className="text-[28px] font-semibold leading-none text-white/92"
                >
                  {learning.total_corrections_recorded > 0
                    ? `${Math.min(100, Math.round((learning.auto_learned_pairs / Math.max(1, learning.distinct_corrections)) * 100))}%`
                    : "—"}
                </p>
                <p
                  style={{ marginTop: 10 }}
                  className="text-[11px] text-white/36"
                >
                  {t("stats.switchingCostSub", {
                    defaultValue: "corrections actives dans votre dict.",
                  })}
                </p>
              </div>
            </div>

            {learning.top_corrections.length > 0 && (
              <div
                className="mt-3 rounded-xl border border-white/8 bg-white/[0.03]"
                style={{ padding: "16px 20px" }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen size={12} className="text-white/30" />
                  <p className="text-[10px] font-medium uppercase tracking-widest text-white/30">
                    {t("stats.topCorrections", {
                      defaultValue: "Corrections les plus fréquentes",
                    })}
                  </p>
                </div>
                <div className="flex flex-col divide-y divide-white/[0.05]">
                  {learning.top_corrections.map((c) => (
                    <div
                      key={c.from}
                      className="flex items-center justify-between gap-4 py-2"
                    >
                      <div className="flex items-center gap-2 text-[12.5px]">
                        <span className="text-white/50 line-through">
                          {c.from}
                        </span>
                        <span className="text-white/25">→</span>
                        <span className="font-medium text-white/80">
                          {c.to}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-medium text-white/40">
                        {c.count}×
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SettingsGroup>
        )}

      {profile && (
        <SettingsGroup
          title={t("stats.profile", { defaultValue: "Mon Profil vocal" })}
          description={t("stats.profileDescription", {
            defaultValue:
              "Les termes que Vocalype connaît pour votre voix. Plus il y en a, moins le modèle se trompe sur vos mots.",
          })}
        >
          <div className="flex items-center justify-between gap-3 pb-1">
            <p className="text-[12px] text-white/40">
              {profile.learned_terms.length > 0
                ? t("stats.profileCount", {
                    defaultValue: "{{n}} terme(s) dans votre profil",
                    n: profile.learned_terms.length,
                  })
                : t("stats.profileEmpty", {
                    defaultValue:
                      "Aucun terme appris. Corrigez des transcriptions pour commencer.",
                  })}
            </p>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-50"
            >
              {syncing ? (
                <RefreshCw size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              {t("stats.syncProfile", {
                defaultValue: "Synchroniser le dictionnaire",
              })}
            </button>
          </div>

          {profile.learned_terms.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {profile.learned_terms.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => void handleRemoveTerm(term)}
                  title={t("stats.removeProfileTerm", {
                    defaultValue: "Retirer du profil",
                  })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-white/65 transition-colors hover:border-red-400/20 hover:bg-red-400/[0.06] hover:text-red-300"
                >
                  {term}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="opacity-40"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </SettingsGroup>
      )}
    </div>
  );
};

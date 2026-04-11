import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  Clock3,
  RefreshCw,
  Sparkles,
  Waves,
} from "lucide-react";
import { commands, type HistoryStats } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";

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
  <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.025] px-4 py-3">
    <span className="text-[12px] text-white/42">{label}</span>
    <span className="text-[14px] font-semibold text-white/88">{value}</span>
  </div>
);

export const StatsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await commands.getHistoryStats();
      if (result.status === "ok") {
        setStats(result.data);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

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
            gap: 10,
          }}
        >
          <StatLine
            label={t("stats.snapshotEntries", {
              defaultValue: "Sessions totales",
            })}
            value={formatNumber(stats.total_entries)}
          />
          <StatLine
            label={t("stats.snapshotWords", { defaultValue: "Mots dictés" })}
            value={formatNumber(stats.total_words)}
          />
          <StatLine
            label={t("stats.snapshotTime", {
              defaultValue: "Temps gagné estimé",
            })}
            value={estimatedTimeSaved(stats.total_words)}
          />
        </div>
      </SettingsGroup>
    </div>
  );
};

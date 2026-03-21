import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { commands, type HistoryStats } from "@/bindings";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Very rough estimate: average typing speed ~40 wpm → each word ≈ 1.5 s saved. */
function estimatedTimeSaved(words: number): string {
  const seconds = Math.round((words / 40) * 60);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem} min` : `${hours}h`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  label: string;
  value: string | number;
  sub?: string;
}> = ({ label, value, sub }) => (
  <div className="flex flex-col gap-1 rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
    <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/30">{label}</p>
    <p className="text-[22px] font-semibold leading-none text-white/90">{value}</p>
    {sub && <p className="text-[11px] text-white/35">{sub}</p>}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

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

  return (
    <div className="space-y-5 pt-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-white/50">
          {t("stats.title", { defaultValue: "Statistiques d'utilisation" })}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-white/30 hover:text-white/60 transition-colors"
          title={t("stats.refresh", { defaultValue: "Actualiser" })}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !stats ? (
        <p className="text-[13px] italic text-white/30">
          {t("stats.loading", { defaultValue: "Chargement…" })}
        </p>
      ) : stats ? (
        <>
          {/* Grid — primary stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label={t("stats.totalWords", { defaultValue: "Mots dictés" })}
              value={formatNumber(stats.total_words)}
              sub={t("stats.timeSaved", {
                defaultValue: "≈ {{time}} économisés",
                time: estimatedTimeSaved(stats.total_words),
              })}
            />
            <StatCard
              label={t("stats.totalEntries", { defaultValue: "Transcriptions" })}
              value={formatNumber(stats.total_entries)}
            />
            <StatCard
              label={t("stats.today", { defaultValue: "Aujourd'hui" })}
              value={formatNumber(stats.entries_today)}
              sub={t("stats.transcriptions", { defaultValue: "transcriptions" })}
            />
            <StatCard
              label={t("stats.thisWeek", { defaultValue: "Cette semaine" })}
              value={formatNumber(stats.entries_this_week)}
              sub={t("stats.transcriptions", { defaultValue: "transcriptions" })}
            />
          </div>

          {/* Most used model */}
          {stats.most_used_model && (
            <div className="rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/30">
                {t("stats.mostUsedModel", { defaultValue: "Modèle le plus utilisé" })}
              </p>
              <p className="text-[15px] font-medium text-logo-primary">
                {stats.most_used_model}
              </p>
            </div>
          )}

          {/* Words per transcription */}
          {stats.total_entries > 0 && (
            <div className="rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/30">
                {t("stats.avgWords", { defaultValue: "Mots par transcription (moy.)" })}
              </p>
              <p className="text-[22px] font-semibold text-white/90">
                {Math.round(stats.total_words / stats.total_entries)}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-[13px] italic text-white/30">
          {t("stats.empty", { defaultValue: "Aucune donnée disponible." })}
        </p>
      )}
    </div>
  );
};

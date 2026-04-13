//! Weekly usage report — local analytics for the founder and the user.
//!
//! Aggregates the last 7 days of transcription history into a structured
//! report with usage trends, peak times, and learning progress.

use crate::managers::history::{HistoryManager, WeeklyReportData};
use crate::processing::correction_tracker::CorrectionTracker;
use crate::processing::dictionary::DictionaryManager;
use crate::settings::get_settings;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

// ── Report shape ──────────────────────────────────────────────────────────────

/// A single actionable insight derived from the weekly data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklyInsight {
    /// Machine-readable category: "peak_time" | "growth" | "decline" |
    /// "learning" | "habit" | "milestone"
    pub kind: String,
    /// Human-readable message body (in French, localized in the Rust layer
    /// so the frontend just renders it).
    pub message: String,
    /// Optional numeric value powering the message (e.g. "+23%", "9h").
    pub value: Option<f32>,
}

/// Full weekly report returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklyReport {
    // ── Period ──────────────────────────────────────────────────────────────
    pub period_start_ts: i64,
    pub period_end_ts: i64,

    // ── Usage ───────────────────────────────────────────────────────────────
    pub sessions_this_week: i64,
    pub sessions_last_week: i64,
    pub words_this_week: i64,
    pub words_last_week: i64,
    pub avg_words_per_session: i64,

    // ── Daily bars (Mon=0 … Sun=6) ───────────────────────────────────────
    pub daily_sessions: Vec<i64>,

    // ── Peak hour label e.g. "9h – 11h" ─────────────────────────────────
    pub peak_hour_label: Option<String>,

    // ── Learning ────────────────────────────────────────────────────────────
    pub corrections_total: u32,
    pub profile_terms: usize,
    pub dictionary_entries: usize,

    // ── Insights ────────────────────────────────────────────────────────────
    pub insights: Vec<WeeklyInsight>,
}

// ── Command ───────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn get_weekly_report(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    correction_tracker: State<'_, Arc<CorrectionTracker>>,
    dictionary: State<'_, Arc<DictionaryManager>>,
) -> Result<WeeklyReport, String> {
    let raw: WeeklyReportData = history_manager
        .get_weekly_report_data()
        .map_err(|e| e.to_string())?;

    let settings = get_settings(&app);
    let corrections_total: u32 = correction_tracker.all_counts().values().sum();
    let profile_terms = settings.custom_words.len();
    let dictionary_entries = dictionary.entries().len();

    let peak_hour_label = raw.peak_hour_block.map(|b| {
        let start = b * 2;
        format!("{}h – {}h", start, start + 2)
    });

    let insights = build_insights(&raw, corrections_total, profile_terms);

    Ok(WeeklyReport {
        period_start_ts: raw.period_start_ts,
        period_end_ts: raw.period_end_ts,
        sessions_this_week: raw.sessions_this_week,
        sessions_last_week: raw.sessions_last_week,
        words_this_week: raw.words_this_week,
        words_last_week: raw.words_last_week,
        avg_words_per_session: raw.avg_words_per_session,
        daily_sessions: raw.daily_sessions,
        peak_hour_label,
        corrections_total,
        profile_terms,
        dictionary_entries,
        insights,
    })
}

// ── Insight engine ────────────────────────────────────────────────────────────

fn build_insights(
    raw: &WeeklyReportData,
    corrections_total: u32,
    profile_terms: usize,
) -> Vec<WeeklyInsight> {
    let mut insights = Vec::new();

    // Growth / decline vs last week
    if raw.sessions_last_week > 0 {
        let pct = ((raw.sessions_this_week - raw.sessions_last_week) as f32
            / raw.sessions_last_week as f32)
            * 100.0;
        if pct >= 10.0 {
            insights.push(WeeklyInsight {
                kind: "growth".to_string(),
                message: format!(
                    "+{:.0}% de sessions par rapport à la semaine dernière.",
                    pct
                ),
                value: Some(pct),
            });
        } else if pct <= -10.0 {
            insights.push(WeeklyInsight {
                kind: "decline".to_string(),
                message: format!(
                    "{:.0}% de sessions de moins que la semaine dernière.",
                    pct
                ),
                value: Some(pct),
            });
        }
    } else if raw.sessions_this_week > 0 {
        insights.push(WeeklyInsight {
            kind: "milestone".to_string(),
            message: "Première semaine d'utilisation — bienvenue !".to_string(),
            value: None,
        });
    }

    // Peak time
    if let Some(block) = raw.peak_hour_block {
        let start = block * 2;
        let day = peak_day_name(&raw.daily_sessions);
        if let Some(day_name) = day {
            insights.push(WeeklyInsight {
                kind: "peak_time".to_string(),
                message: format!(
                    "Tu dictes le plus le {} entre {}h et {}h.",
                    day_name, start, start + 2
                ),
                value: Some(start as f32),
            });
        } else {
            insights.push(WeeklyInsight {
                kind: "peak_time".to_string(),
                message: format!(
                    "Ton heure de pointe : {}h – {}h.",
                    start, start + 2
                ),
                value: Some(start as f32),
            });
        }
    }

    // Session length
    if raw.avg_words_per_session > 0 {
        let label = if raw.avg_words_per_session >= 100 {
            "Tes dictées sont longues — tu l'utilises vraiment.".to_string()
        } else if raw.avg_words_per_session >= 30 {
            format!(
                "En moyenne {} mots par dictée cette semaine.",
                raw.avg_words_per_session
            )
        } else {
            format!(
                "Dictées courtes cette semaine : {} mots en moyenne.",
                raw.avg_words_per_session
            )
        };
        insights.push(WeeklyInsight {
            kind: "habit".to_string(),
            message: label,
            value: Some(raw.avg_words_per_session as f32),
        });
    }

    // Learning
    if corrections_total > 0 {
        let msg = if profile_terms > 10 {
            format!(
                "{} termes dans ton profil — le modèle te connaît bien.",
                profile_terms
            )
        } else if corrections_total >= 5 {
            format!(
                "{} corrections enregistrées. Continue, ça accélère l'apprentissage.",
                corrections_total
            )
        } else {
            format!(
                "{} correction(s) enregistrée(s) cette semaine.",
                corrections_total
            )
        };
        insights.push(WeeklyInsight {
            kind: "learning".to_string(),
            message: msg,
            value: Some(corrections_total as f32),
        });
    }

    // Milestone: 1000 words
    if raw.words_this_week >= 1000 {
        insights.push(WeeklyInsight {
            kind: "milestone".to_string(),
            message: format!(
                "{} mots dictés cette semaine. Tu économises du temps chaque jour.",
                raw.words_this_week
            ),
            value: Some(raw.words_this_week as f32),
        });
    }

    insights
}

fn peak_day_name(daily_sessions: &[i64]) -> Option<&'static str> {
    let days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
    daily_sessions
        .iter()
        .enumerate()
        .max_by_key(|(_, &v)| v)
        .filter(|(_, &v)| v > 0)
        .map(|(i, _)| days[i % 7])
}

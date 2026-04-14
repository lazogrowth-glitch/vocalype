use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_RECENT_SESSIONS: usize = 20;
const PREVIEW_WORD_LIMIT: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ParakeetFailureMode {
    Healthy,
    UnderchunkingLongUtterance,
    OvertrimOverlap,
    MissingWordTimestamps,
    RetryRecoveredChunk,
    FinalChunkHallucination,
    LowAudioDensity,
    BoundaryWordLoss,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ParakeetSessionDiagnostics {
    pub session_id: u64,
    pub operation_id: Option<u64>,
    pub binding_id: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub provider: String,
    pub selected_language: String,
    pub device_name: Option<String>,
    pub recording_mode: String,
    pub chunk_interval_samples: usize,
    pub chunk_overlap_samples: usize,
    pub total_chunks: usize,
    pub empty_chunks: usize,
    pub retry_chunks: usize,
    pub filtered_chunks: usize,
    pub trimmed_words_total: usize,
    pub chunks_without_word_timestamps: usize,
    pub chunk_candidates_rejected: usize,
    pub chunk_candidates_sent: usize,
    pub output_words: usize,
    pub finalization_recoveries: usize,
    pub duration_secs: f32,
    pub audio_to_word_ratio: f32,
    pub estimated_issue: ParakeetFailureMode,
    pub quality_risk_score: f32,
    pub assembled_preview: String,
    pub last_updated_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ParakeetDiagnosticsSnapshot {
    pub active_session: Option<ParakeetSessionDiagnostics>,
    pub recent_sessions: Vec<ParakeetSessionDiagnostics>,
}

#[derive(Debug, Clone)]
pub struct ParakeetSessionStart {
    pub session_id: u64,
    pub operation_id: Option<u64>,
    pub binding_id: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub provider: String,
    pub selected_language: String,
    pub device_name: Option<String>,
    pub recording_mode: String,
    pub chunk_interval_samples: usize,
    pub chunk_overlap_samples: usize,
}

#[derive(Debug, Clone)]
struct ActiveParakeetSession {
    base: ParakeetSessionDiagnostics,
}

pub struct ParakeetDiagnosticsState {
    inner: Mutex<ParakeetDiagnosticsInner>,
}

#[derive(Debug, Clone, Default)]
pub struct ParakeetSessionCompletion {
    pub total_chunks: usize,
    pub empty_chunks: usize,
    pub empty_nonfinal_chunks: usize,
    pub final_chunk_words: usize,
    pub final_chunk_samples: usize,
    pub retry_chunks: usize,
    pub filtered_chunks: usize,
    pub trimmed_words_total: usize,
    pub chunks_without_word_timestamps: usize,
    pub chunk_candidates_rejected: usize,
    pub chunk_candidates_sent: usize,
    pub output_words: usize,
    pub finalization_recoveries: usize,
}

#[derive(Default)]
struct ParakeetDiagnosticsInner {
    active_sessions: HashMap<u64, ActiveParakeetSession>,
    recent_sessions: VecDeque<ParakeetSessionDiagnostics>,
}

impl ParakeetDiagnosticsState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ParakeetDiagnosticsInner::default()),
        }
    }

    pub fn start_session(&self, meta: ParakeetSessionStart) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.active_sessions.insert(
            meta.session_id,
            ActiveParakeetSession {
                base: ParakeetSessionDiagnostics {
                    session_id: meta.session_id,
                    operation_id: meta.operation_id,
                    binding_id: meta.binding_id,
                    model_id: meta.model_id,
                    model_name: meta.model_name,
                    provider: meta.provider,
                    selected_language: meta.selected_language,
                    device_name: meta.device_name,
                    recording_mode: meta.recording_mode,
                    chunk_interval_samples: meta.chunk_interval_samples,
                    chunk_overlap_samples: meta.chunk_overlap_samples,
                    total_chunks: 0,
                    empty_chunks: 0,
                    retry_chunks: 0,
                    filtered_chunks: 0,
                    trimmed_words_total: 0,
                    chunks_without_word_timestamps: 0,
                    chunk_candidates_rejected: 0,
                    chunk_candidates_sent: 0,
                    output_words: 0,
                    finalization_recoveries: 0,
                    duration_secs: 0.0,
                    audio_to_word_ratio: 0.0,
                    estimated_issue: ParakeetFailureMode::Healthy,
                    quality_risk_score: 0.0,
                    assembled_preview: String::new(),
                    last_updated_ms: crate::runtime_observability::now_ms(),
                },
            },
        );
    }

    pub fn finish_session(
        &self,
        session_id: u64,
        completion: ParakeetSessionCompletion,
        duration_samples: usize,
        assembled_text: &str,
    ) -> Option<ParakeetSessionDiagnostics> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut session = inner.active_sessions.remove(&session_id)?;
        session.base.total_chunks = completion.total_chunks;
        session.base.empty_chunks = completion.empty_chunks;
        session.base.retry_chunks = completion.retry_chunks;
        session.base.filtered_chunks = completion.filtered_chunks;
        session.base.trimmed_words_total = completion.trimmed_words_total;
        session.base.chunks_without_word_timestamps = completion.chunks_without_word_timestamps;
        session.base.chunk_candidates_rejected = completion.chunk_candidates_rejected;
        session.base.chunk_candidates_sent = completion.chunk_candidates_sent;
        session.base.output_words = completion.output_words;
        session.base.finalization_recoveries = completion.finalization_recoveries;
        let duration_secs = duration_samples as f32 / 16_000.0;
        session.base.duration_secs = duration_secs;
        session.base.assembled_preview = preview_words(assembled_text, PREVIEW_WORD_LIMIT);
        session.base.audio_to_word_ratio = if duration_secs > 0.0 {
            session.base.output_words as f32 / duration_secs
        } else {
            0.0
        };
        session.base.estimated_issue = infer_failure_mode(&session.base);
        session.base.quality_risk_score = estimate_quality_risk(&session.base);
        session.base.last_updated_ms = crate::runtime_observability::now_ms();

        let snapshot = session.base.clone();
        inner.recent_sessions.push_back(snapshot.clone());
        while inner.recent_sessions.len() > MAX_RECENT_SESSIONS {
            inner.recent_sessions.pop_front();
        }
        Some(snapshot)
    }

    pub fn snapshot(&self) -> ParakeetDiagnosticsSnapshot {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        ParakeetDiagnosticsSnapshot {
            active_session: inner
                .active_sessions
                .values()
                .last()
                .map(|session| session.base.clone()),
            recent_sessions: inner.recent_sessions.iter().cloned().collect(),
        }
    }
}

fn preview_words(text: &str, limit: usize) -> String {
    text.split_whitespace()
        .take(limit)
        .collect::<Vec<_>>()
        .join(" ")
}

fn infer_failure_mode(session: &ParakeetSessionDiagnostics) -> ParakeetFailureMode {
    if session.filtered_chunks > 0 && session.empty_chunks > 0 {
        return ParakeetFailureMode::FinalChunkHallucination;
    }
    if session.chunks_without_word_timestamps > 0 && session.retry_chunks > 0 {
        return ParakeetFailureMode::RetryRecoveredChunk;
    }
    if session.finalization_recoveries > 0 {
        return ParakeetFailureMode::RetryRecoveredChunk;
    }
    if session.chunks_without_word_timestamps > 0 {
        return ParakeetFailureMode::MissingWordTimestamps;
    }
    if session.trimmed_words_total >= 12 {
        return ParakeetFailureMode::OvertrimOverlap;
    }
    if session.chunk_candidates_rejected > 2 {
        return ParakeetFailureMode::UnderchunkingLongUtterance;
    }
    if session.audio_to_word_ratio < 1.2 && session.duration_secs >= 8.0 {
        return ParakeetFailureMode::LowAudioDensity;
    }
    if session.empty_chunks > 0 {
        return ParakeetFailureMode::BoundaryWordLoss;
    }
    ParakeetFailureMode::Healthy
}

fn estimate_quality_risk(session: &ParakeetSessionDiagnostics) -> f32 {
    let mut risk = 0.0_f32;
    risk += (session.empty_chunks as f32) * 0.18;
    risk += (session.retry_chunks as f32) * 0.08;
    risk += (session.filtered_chunks as f32) * 0.10;
    risk += (session.chunks_without_word_timestamps as f32) * 0.07;
    risk += (session.trimmed_words_total as f32 / 30.0).min(0.25);
    risk += (session.chunk_candidates_rejected as f32 / 10.0).min(0.20);
    risk -= (session.finalization_recoveries as f32 * 0.03).min(0.09);
    risk.clamp(0.0, 1.0)
}

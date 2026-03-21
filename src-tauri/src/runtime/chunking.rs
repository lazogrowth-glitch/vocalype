use crate::managers::model::{EngineType, ModelInfo};
use crate::model_ids::{
    PARAKEET_V3_ENGLISH_ID, PARAKEET_V3_LEGACY_ID, PARAKEET_V3_MULTILINGUAL_ID,
};
use crate::settings::AppSettings;
use crate::voice_profile::current_runtime_adjustment;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

// ── Streaming chunk constants ────────────────────────────────────────────────

/// Accumulate this many speech samples before sending a chunk for background transcription.
pub(crate) const DEFAULT_CHUNK_INTERVAL_SAMPLES: usize = 15 * 16_000; // 15 s at 16 kHz
/// Overlap kept at the START of each new chunk to avoid cutting words at boundaries.
pub(crate) const DEFAULT_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Small benchmarks best with slightly larger chunks on weak PCs.
pub(crate) const WHISPER_SMALL_CHUNK_INTERVAL_SAMPLES: usize = 12 * 16_000; // 12 s
pub(crate) const WHISPER_SMALL_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Medium tuned for latency while staying conservative on slow machines.
pub(crate) const WHISPER_MEDIUM_CHUNK_INTERVAL_SAMPLES: usize = 6 * 16_000; // 6 s
pub(crate) const WHISPER_MEDIUM_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Turbo: larger chunks reduce tail assembly overhead on low-end hardware.
pub(crate) const WHISPER_TURBO_CHUNK_INTERVAL_SAMPLES: usize = 12 * 16_000; // 12 s
pub(crate) const WHISPER_TURBO_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Large: quality-oriented but avoids all-work-after-key-up behaviour.
pub(crate) const WHISPER_LARGE_CHUNK_INTERVAL_SAMPLES: usize = 8 * 16_000; // 8 s
pub(crate) const WHISPER_LARGE_CHUNK_OVERLAP_SAMPLES: usize = 12_000; // 0.75 s
/// Shorter polling reduces how long a ready chunk waits before getting sent.
pub(crate) const CHUNK_SAMPLER_POLL_MS: u64 = 200;
/// Prevent Whisper from queueing many background chunks when the model is slower than real time.
pub(crate) const MAX_PENDING_BACKGROUND_CHUNKS: usize = 1;
/// English Parakeet profile tuned to reduce long-utterance truncation.
pub(crate) const PARAKEET_V3_EN_CHUNK_INTERVAL_SAMPLES: usize = 20 * 16_000; // 20 s at 16 kHz
pub(crate) const PARAKEET_V3_EN_CHUNK_OVERLAP_SAMPLES: usize = 16_000; // 1 s
/// French-first multilingual Parakeet profile tuned for lower EN drift.
pub(crate) const PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 5 * 16_000; // 5 s at 16 kHz
/// Small overlap limits boundary cuts while keeping tight chunks.
pub(crate) const PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 16_000; // 1 s

// ── Chunking types ───────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct ChunkingProfile {
    pub(crate) interval_samples: usize,
    pub(crate) overlap_samples: usize,
}

pub(crate) struct ChunkingSharedState {
    pub(crate) last_committed_idx: usize,
    pub(crate) next_chunk_idx: usize,
}

pub struct ChunkingHandle {
    pub(crate) sampler_handle: std::thread::JoinHandle<()>,
    pub(crate) worker_handle: std::thread::JoinHandle<()>,
    pub(crate) chunk_tx: std::sync::mpsc::Sender<Option<(Vec<f32>, usize)>>,
    pub(crate) shared_state: Arc<Mutex<ChunkingSharedState>>,
    pub(crate) results: Arc<Mutex<Vec<(usize, String)>>>,
    pub(crate) pending_chunks: Arc<AtomicUsize>,
    pub(crate) chunk_overlap_samples: usize,
}

pub struct ActiveChunkingHandle(pub Mutex<Option<ChunkingHandle>>);

// ── Chunking functions ───────────────────────────────────────────────────────

pub(crate) fn chunking_profile_for_model(
    app: &AppHandle,
    model_info: Option<&ModelInfo>,
    settings: &AppSettings,
) -> Option<ChunkingProfile> {
    match model_info {
        Some(info) if matches!(info.id.as_str(), "small" | "medium" | "turbo" | "large") => {
            if let Some(config) = settings.adaptive_whisper_config(&info.id) {
                let adjusted = current_runtime_adjustment(
                    app,
                    &info.id,
                    config.chunk_seconds,
                    config.overlap_ms,
                )
                .unwrap_or_else(|| crate::voice_profile::VoiceRuntimeAdjustment {
                    adjusted_chunk_seconds: config.chunk_seconds,
                    adjusted_overlap_ms: config.overlap_ms,
                    vad_hangover_frames_delta: 0,
                    reason: None,
                });
                return Some(ChunkingProfile {
                    interval_samples: usize::from(adjusted.adjusted_chunk_seconds) * 16_000,
                    overlap_samples: (usize::from(adjusted.adjusted_overlap_ms) * 16_000) / 1000,
                });
            }

            match info.id.as_str() {
                "small" => Some(ChunkingProfile {
                    interval_samples: WHISPER_SMALL_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_SMALL_CHUNK_OVERLAP_SAMPLES,
                }),
                "medium" => Some(ChunkingProfile {
                    interval_samples: WHISPER_MEDIUM_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_MEDIUM_CHUNK_OVERLAP_SAMPLES,
                }),
                "turbo" => Some(ChunkingProfile {
                    interval_samples: WHISPER_TURBO_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_TURBO_CHUNK_OVERLAP_SAMPLES,
                }),
                "large" => Some(ChunkingProfile {
                    interval_samples: WHISPER_LARGE_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_LARGE_CHUNK_OVERLAP_SAMPLES,
                }),
                _ => None,
            }
        }
        Some(info) if info.id == PARAKEET_V3_ENGLISH_ID => Some(ChunkingProfile {
            interval_samples: PARAKEET_V3_EN_CHUNK_INTERVAL_SAMPLES,
            overlap_samples: PARAKEET_V3_EN_CHUNK_OVERLAP_SAMPLES,
        }),
        Some(info)
            if matches!(
                info.id.as_str(),
                PARAKEET_V3_MULTILINGUAL_ID | PARAKEET_V3_LEGACY_ID
            ) =>
        {
            Some(ChunkingProfile {
                interval_samples: PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES,
                overlap_samples: PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES,
            })
        }
        Some(info)
            if matches!(
                info.engine_type,
                EngineType::Whisper | EngineType::MoonshineStreaming
            ) =>
        {
            Some(ChunkingProfile {
                interval_samples: DEFAULT_CHUNK_INTERVAL_SAMPLES,
                overlap_samples: DEFAULT_CHUNK_OVERLAP_SAMPLES,
            })
        }
        None => Some(ChunkingProfile {
            interval_samples: DEFAULT_CHUNK_INTERVAL_SAMPLES,
            overlap_samples: DEFAULT_CHUNK_OVERLAP_SAMPLES,
        }),
        _ => None,
    }
}

/// Remove words duplicated at the boundary between two adjacent chunk transcriptions.
/// Looks for up to 8 words of suffix/prefix overlap (case-insensitive).
pub fn deduplicate_boundary(prev: &str, next: &str) -> String {
    let prev_words: Vec<&str> = prev.split_whitespace().collect();
    let next_words: Vec<&str> = next.split_whitespace().collect();
    if prev_words.is_empty() || next_words.is_empty() {
        return next.to_string();
    }
    let max_overlap = 8.min(prev_words.len()).min(next_words.len());
    for n in (1..=max_overlap).rev() {
        let prev_suffix: Vec<String> = prev_words[prev_words.len() - n..]
            .iter()
            .map(|w| {
                w.to_lowercase()
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string()
            })
            .collect();
        let next_prefix: Vec<String> = next_words[..n]
            .iter()
            .map(|w| {
                w.to_lowercase()
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string()
            })
            .collect();
        if prev_suffix == next_prefix {
            return next_words[n..].join(" ");
        }
    }
    next.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deduplicate_boundary_empty_inputs() {
        assert_eq!(deduplicate_boundary("", "hello world"), "hello world");
        assert_eq!(deduplicate_boundary("hello world", ""), "");
    }

    #[test]
    fn test_deduplicate_boundary_no_overlap() {
        let prev = "the cat sat on";
        let next = "a mat over there";
        assert_eq!(deduplicate_boundary(prev, next), "a mat over there");
    }

    #[test]
    fn test_deduplicate_boundary_with_overlap() {
        let prev = "hello world foo bar";
        let next = "foo bar baz qux";
        // "foo bar" is the 2-word suffix/prefix overlap
        assert_eq!(deduplicate_boundary(prev, next), "baz qux");
    }

    #[test]
    fn test_deduplicate_boundary_full_duplicate() {
        let prev = "same same";
        let next = "same same";
        // entire next is duplicate → empty string
        assert_eq!(deduplicate_boundary(prev, next), "");
    }

    #[test]
    fn test_deduplicate_boundary_case_insensitive() {
        let prev = "Hello World";
        let next = "hello world nice day";
        assert_eq!(deduplicate_boundary(prev, next), "nice day");
    }
}

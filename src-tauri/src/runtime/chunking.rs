use crate::managers::model::{EngineType, ModelInfo};
use crate::model_ids::{PARAKEET_V3_LEGACY_ID, PARAKEET_V3_MULTILINGUAL_ID};
use crate::parakeet_quality::ParakeetSessionCompletion;
use crate::settings::AppSettings;
use crate::telemetry::TranscriptionTelemetry;
use crate::voice_profile::{current_runtime_adjustment, current_voice_profile_for_context};
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

// ── Streaming chunk constants ────────────────────────────────────────────────

/// Accumulate this many speech samples before sending a chunk for background transcription.
pub(crate) const DEFAULT_CHUNK_INTERVAL_SAMPLES: usize = 15 * 16_000; // 15 s at 16 kHz
/// Overlap kept at the START of each new chunk to avoid cutting words at boundaries.
pub(crate) const DEFAULT_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s
/// Whisper Small benchmarks best with slightly larger chunks on weak PCs.
pub(crate) const WHISPER_SMALL_CHUNK_INTERVAL_SAMPLES: usize = 12 * 16_000; // 12 s
pub(crate) const WHISPER_SMALL_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s
/// Whisper Medium tuned for latency while staying conservative on slow machines.
pub(crate) const WHISPER_MEDIUM_CHUNK_INTERVAL_SAMPLES: usize = 6 * 16_000; // 6 s
pub(crate) const WHISPER_MEDIUM_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s
/// Whisper Turbo: larger chunks reduce tail assembly overhead on low-end hardware.
pub(crate) const WHISPER_TURBO_CHUNK_INTERVAL_SAMPLES: usize = 12 * 16_000; // 12 s
pub(crate) const WHISPER_TURBO_CHUNK_OVERLAP_SAMPLES: usize = 24_000; // 1.5 s
/// Whisper Large: quality-oriented but avoids all-work-after-key-up behaviour.
pub(crate) const WHISPER_LARGE_CHUNK_INTERVAL_SAMPLES: usize = 8 * 16_000; // 8 s
pub(crate) const WHISPER_LARGE_CHUNK_OVERLAP_SAMPLES: usize = 12_000; // 0.75 s
/// Shorter polling reduces how long a ready chunk waits before getting sent.
pub(crate) const CHUNK_SAMPLER_POLL_MS: u64 = 200;
/// Prevent Whisper from queueing many background chunks when the model is slower than real time.
pub(crate) const MAX_PENDING_BACKGROUND_CHUNKS: usize = 1;
/// Minimum new samples required before a VAD-triggered flush can fire (1 s at 16 kHz).
/// Prevents spurious flushes at the very start of an utterance.
pub(crate) const VAD_FLUSH_MIN_CONTENT_SAMPLES: usize = 24_000; // 1.5 s
/// Width of the silence window scanned for VAD-triggered flush (500 ms at 16 kHz).
/// 500 ms filters out inter-word hesitation pauses (typically 100-400 ms) while
/// still catching genuine sentence-ending pauses (≥ 500 ms).
pub(crate) const VAD_FLUSH_SILENCE_SAMPLES: usize = 9_600; // 600 ms
/// Mean-squared energy threshold — windows below this are considered silent.
/// 1e-5 ≈ RMS 0.003, well below conversational speech (~0.02–0.1 RMS).
pub(crate) const VAD_FLUSH_ENERGY_THRESHOLD: f32 = 1e-5;
/// Minimum samples for a Parakeet chunk result to be kept when it produces
/// only 1 word. Below this, the result is almost certainly a hallucination
/// (Parakeet inventing English filler words in near-silence audio).
pub(crate) const PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD: usize = 24_000; // 1.5 s
/// Minimum remaining samples to bother sending the final chunk.
/// Chunks shorter than this are silence tail after the user stopped speaking.
pub(crate) const MIN_FINAL_CHUNK_SAMPLES: usize = 8_000; // 0.5 s
/// Unified Parakeet V3 profile for user-selected language dictation.
/// Keep this conservative: most Vocalype users dictate in English, with
/// Spanish/Hindi/Portuguese also sharing the multilingual path.
pub(crate) const PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 8 * 16_000; // 8 s at 16 kHz
/// Keep overlap because fixed-interval chunks can still cut through a word.
/// Word timestamps in the worker trim this overlap back out during assembly.
pub(crate) const PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 12_000; // 0.75 s; // 2.5 s; // 2.0 s
/// French errors are handled by text/vocabulary learning rather than a more
/// aggressive chunk profile, which regressed long-form eval samples.
pub(crate) const PARAKEET_V3_FRENCH_CHUNK_INTERVAL_SAMPLES: usize =
    PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES;
pub(crate) const PARAKEET_V3_FRENCH_CHUNK_OVERLAP_SAMPLES: usize =
    PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES;
/// Auto mode must be English-safe because it is the majority traffic path.
pub(crate) const PARAKEET_V3_AUTO_CHUNK_INTERVAL_SAMPLES: usize =
    PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES;
pub(crate) const PARAKEET_V3_AUTO_CHUNK_OVERLAP_SAMPLES: usize =
    PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES;

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
    pub(crate) chunk_tx: std::sync::mpsc::Sender<Option<(Vec<f32>, usize, f32, bool)>>,
    pub(crate) shared_state: Arc<Mutex<ChunkingSharedState>>,
    pub(crate) results: Arc<Mutex<Vec<(usize, String)>>>,
    pub(crate) pending_chunks: Arc<AtomicUsize>,
    pub(crate) failed_chunks: Arc<AtomicUsize>,
    pub(crate) parakeet_counters: Arc<Mutex<ParakeetSessionCompletion>>,
    pub(crate) final_recovery_candidate: Arc<Mutex<Option<(usize, String)>>>,
    pub(crate) chunk_overlap_samples: usize,
    /// True when the active model is Parakeet V3 TDT.
    /// Used to gate timestamp-based overlap trimming (which is only safe for
    /// word-level TDT output) and to skip redundant text deduplication.
    pub(crate) is_parakeet_v3: bool,
    /// Unique ID for this recording session (epoch-ms at start), used for telemetry.
    pub(crate) session_id: u64,
    /// Telemetry writer — shared with sampler + worker threads.
    pub(crate) tel: Arc<TranscriptionTelemetry>,
}

pub struct ActiveChunkingHandle(pub Mutex<Option<ChunkingHandle>>);

/// Holds the cancel_flag for the currently active worker thread.
/// Kept as a separate state so it remains accessible even after the
/// ActiveChunkingHandle is taken by stop_transcription_action, allowing
/// cancel_current_operation to interrupt a worker that is draining its queue.
pub struct ActiveWorkerCancelFlag(pub Mutex<Option<Arc<AtomicBool>>>);

fn parakeet_language_base_profile(selected_language: &str) -> (u8, u16) {
    match selected_language {
        lang if lang.starts_with("fr") => (
            (PARAKEET_V3_FRENCH_CHUNK_INTERVAL_SAMPLES / 16_000) as u8,
            ((PARAKEET_V3_FRENCH_CHUNK_OVERLAP_SAMPLES * 1000) / 16_000) as u16,
        ),
        "auto" => (
            (PARAKEET_V3_AUTO_CHUNK_INTERVAL_SAMPLES / 16_000) as u8,
            ((PARAKEET_V3_AUTO_CHUNK_OVERLAP_SAMPLES * 1000) / 16_000) as u16,
        ),
        _ => (
            (PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES / 16_000) as u8,
            ((PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES * 1000) / 16_000) as u16,
        ),
    }
}

fn refine_parakeet_adjustment(
    adjusted_chunk_seconds: u8,
    adjusted_overlap_ms: u16,
    selected_language: &str,
    avg_words_per_minute: f32,
    avg_pause_ms: f32,
) -> (u8, u16) {
    let mut chunk = i16::from(adjusted_chunk_seconds);
    let mut overlap = i32::from(adjusted_overlap_ms);

    if selected_language.starts_with("fr") {
        chunk -= 1;
        overlap += 120;
    }

    if avg_words_per_minute >= 165.0 {
        chunk -= 1;
        overlap += 120;
    }

    if avg_pause_ms >= 700.0 {
        chunk += 1;
        overlap -= 80;
    } else if avg_pause_ms > 0.0 && avg_pause_ms <= 180.0 {
        chunk -= 1;
        overlap += 160;
    }

    (chunk.clamp(8, 14) as u8, overlap.clamp(700, 1600) as u16)
}

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
                    &settings.selected_language,
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
        Some(info)
            if matches!(
                info.id.as_str(),
                PARAKEET_V3_MULTILINGUAL_ID | PARAKEET_V3_LEGACY_ID
            ) =>
        {
            let (base_chunk_seconds, base_overlap_ms) =
                parakeet_language_base_profile(&settings.selected_language);
            let adjusted = current_runtime_adjustment(
                app,
                &info.id,
                &settings.selected_language,
                base_chunk_seconds,
                base_overlap_ms,
            )
            .unwrap_or_else(|| crate::voice_profile::VoiceRuntimeAdjustment {
                adjusted_chunk_seconds: base_chunk_seconds,
                adjusted_overlap_ms: base_overlap_ms,
                vad_hangover_frames_delta: 0,
                reason: None,
            });
            let (chunk_seconds, overlap_ms) = if let Some(profile) =
                current_voice_profile_for_context(app, &info.id, &settings.selected_language)
                    .filter(|p| p.sessions_count > 0)
            {
                refine_parakeet_adjustment(
                    adjusted.adjusted_chunk_seconds,
                    adjusted.adjusted_overlap_ms,
                    &settings.selected_language,
                    profile.avg_words_per_minute,
                    profile.avg_pause_ms,
                )
            } else {
                (
                    adjusted.adjusted_chunk_seconds,
                    adjusted.adjusted_overlap_ms,
                )
            };
            Some(ChunkingProfile {
                interval_samples: usize::from(chunk_seconds) * 16_000,
                overlap_samples: (usize::from(overlap_ms) * 16_000) / 1000,
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
    deduplicate_boundary_n(prev, next, 8)
}

/// Same as `deduplicate_boundary` but caps the search window at `max_words`.
/// Use a small value (e.g. 3) for Parakeet V3 where timestamp trimming already
/// handles most of the overlap — only residual 1-2 word duplicates need cleanup.
pub fn deduplicate_boundary_n(prev: &str, next: &str, max_words: usize) -> String {
    let prev_words: Vec<&str> = prev.split_whitespace().collect();
    let next_words: Vec<&str> = next.split_whitespace().collect();
    if prev_words.is_empty() || next_words.is_empty() {
        return next.to_string();
    }
    let max_overlap = max_words.min(prev_words.len()).min(next_words.len());
    for n in (1..=max_overlap).rev() {
        let prev_suffix: Vec<String> = prev_words[prev_words.len() - n..]
            .iter()
            .map(|w| boundary_word_key(w))
            .collect();
        let next_prefix: Vec<String> = next_words[..n]
            .iter()
            .map(|w| boundary_word_key(w))
            .collect();
        if prev_suffix.iter().all(|w| !w.is_empty()) && prev_suffix == next_prefix {
            if n == 1 && is_boundary_function_word(&prev_suffix[0]) {
                continue;
            }
            return next_words[n..].join(" ");
        }
    }
    next.to_string()
}

fn boundary_word_key(word: &str) -> String {
    word.to_lowercase()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string()
}

fn is_boundary_function_word(word: &str) -> bool {
    matches!(
        word,
        "a"
            | "an"
            | "the"
            | "le"
            | "la"
            | "les"
            | "un"
            | "une"
            | "des"
            | "du"
            | "de"
            | "d"
            | "el"
            | "los"
            | "las"
            | "lo"
            | "del"
            | "al"
    )
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

    #[test]
    fn test_deduplicate_boundary_with_three_word_overlap() {
        let prev = "je vais faire";
        let next = "vais faire un test";
        assert_eq!(deduplicate_boundary_n(prev, next, 3), "un test");
    }

    #[test]
    fn test_deduplicate_boundary_ignores_punctuation_only_overlap() {
        assert_eq!(
            deduplicate_boundary_n("hello ...", "... world", 3),
            "... world"
        );
    }

    #[test]
    fn test_deduplicate_boundary_keeps_single_function_word_overlap() {
        assert_eq!(deduplicate_boundary_n("we saw the", "the candidate arrived", 3), "the candidate arrived");
        assert_eq!(deduplicate_boundary_n("on a", "a call with hr", 3), "a call with hr");
    }

    #[test]
    fn french_parakeet_base_profile_is_shorter_and_wider() {
        let (chunk_seconds, overlap_ms) = parakeet_language_base_profile("fr");
        assert_eq!(chunk_seconds, 8);
        assert_eq!(overlap_ms, 750);
    }

    #[test]
    fn auto_parakeet_base_profile_stays_english_safe() {
        let (chunk_seconds, overlap_ms) = parakeet_language_base_profile("auto");
        assert_eq!(chunk_seconds, 8);
        assert_eq!(overlap_ms, 750);
    }

    #[test]
    fn spanish_hindi_and_portuguese_use_multilingual_profile() {
        for language in ["es", "hi", "pt"] {
            let (chunk_seconds, overlap_ms) = parakeet_language_base_profile(language);
            assert_eq!(chunk_seconds, 8);
            assert_eq!(overlap_ms, 750);
        }
    }

    #[test]
    fn auto_parakeet_refinement_does_not_get_french_tuning() {
        let (chunk_seconds, overlap_ms) =
            refine_parakeet_adjustment(12, 1000, "auto", 120.0, 320.0);
        assert_eq!(chunk_seconds, 12);
        assert_eq!(overlap_ms, 1000);
    }

    #[test]
    fn adaptive_parakeet_profile_tightens_for_fast_tight_speech() {
        let (chunk_seconds, overlap_ms) = refine_parakeet_adjustment(12, 1000, "en", 172.0, 140.0);
        assert!(chunk_seconds < 12);
        assert!(overlap_ms > 1000);
    }
}

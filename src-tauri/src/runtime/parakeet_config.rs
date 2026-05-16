//! Shared Parakeet V3 runtime thresholds and retry reason codes.

pub const SAMPLES_PER_SECOND: usize = 16_000;

pub const LOW_ENERGY_RMS_THRESHOLD: f32 = 0.05;
pub const LOW_ENERGY_TARGET_RMS: f32 = 0.1;
pub const LOW_ENERGY_MAX_GAIN: f32 = 4.5;

pub const SHORT_PHRASE_SAMPLES: usize = 5 * SAMPLES_PER_SECOND;
pub const FAST_SHORT_PHRASE_SAMPLES: usize = 40_000;
pub const SHORT_PHRASE_PAD_SAMPLES: usize = SAMPLES_PER_SECOND / 2;
pub const TAIL_PAD_SAMPLES: usize = SAMPLES_PER_SECOND / 2;
pub const SENTENCE_RESCUE_MAX_WORDS: usize = 24;
pub const ULTRA_SHORT_PHRASE_SAMPLES: usize = 3 * SAMPLES_PER_SECOND;
pub const STATEFUL_STREAMING_FRAME_SAMPLES: usize = 2_560;
pub const STATEFUL_STREAMING_MAX_BATCH_SAMPLES: usize = 10 * SAMPLES_PER_SECOND;

pub const DEFAULT_CHUNK_INTERVAL_SAMPLES: usize = 15 * SAMPLES_PER_SECOND;
pub const DEFAULT_CHUNK_OVERLAP_SAMPLES: usize = 24_000;
pub const CHUNK_SAMPLER_POLL_MS: u64 = 200;
pub const MAX_PENDING_BACKGROUND_CHUNKS: usize = 1;

pub const VAD_FLUSH_MIN_CONTENT_SAMPLES: usize = 24_000;
pub const VAD_FLUSH_SILENCE_SAMPLES: usize = 9_600;
pub const VAD_FLUSH_ENERGY_THRESHOLD: f32 = 1e-5;
pub const VAD_SILENT_CHUNK_ENERGY_THRESHOLD: f32 = 1e-9;
pub const VAD_SKIP_SHORT_MAX_DURATION_SECS: f32 = 2.2;
pub const VAD_SKIP_SHORT_MAX_RMS: f32 = 0.0015;
pub const VAD_SKIP_SHORT_MAX_PEAK: f32 = 0.01;
pub const VAD_DEFER_SHORT_MAX_DURATION_SECS: f32 = 2.8;
pub const VAD_DEFER_SHORT_MAX_RMS: f32 = 0.0035;
pub const VAD_DEFER_SHORT_MAX_PEAK: f32 = 0.04;

pub const MIN_SAMPLES_FOR_SINGLE_WORD: usize = 24_000;
pub const MIN_FINAL_CHUNK_SAMPLES: usize = 8_000;

pub const V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 8 * SAMPLES_PER_SECOND;
pub const V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 12_000;
pub const V3_FRENCH_CHUNK_INTERVAL_SAMPLES: usize = 5 * SAMPLES_PER_SECOND;
pub const V3_FRENCH_CHUNK_OVERLAP_SAMPLES: usize = SAMPLES_PER_SECOND;
pub const V3_AUTO_CHUNK_INTERVAL_SAMPLES: usize = V3_MULTI_CHUNK_INTERVAL_SAMPLES;
pub const V3_AUTO_CHUNK_OVERLAP_SAMPLES: usize = V3_MULTI_CHUNK_OVERLAP_SAMPLES;

pub const TIMESTAMP_CLUSTER_MIN_WORDS: usize = 5;
pub const TIMESTAMP_CLUSTER_MIN_CHUNK_SAMPLES: usize = 3 * SAMPLES_PER_SECOND;
pub const TIMESTAMP_CLUSTER_MAX_SPAN_PER_WORD_SECS: f32 = 0.04;

pub const FULL_AUDIO_RECOVERY_MIN_DURATION_SECS: f32 = 6.0;
pub const FULL_AUDIO_RECOVERY_MAX_DURATION_SECS: f32 = 35.0;
pub const FULL_AUDIO_RECOVERY_MIN_EXTRA_WORDS: usize = 4;
pub const FULL_AUDIO_RECOVERY_MIN_RELATIVE_GAIN: f32 = 1.20;
pub const FULL_AUDIO_RECOVERY_MIN_WORDS_PER_SEC: f32 = 0.3;
pub const FULL_AUDIO_RECOVERY_MAX_WORDS_PER_SEC: f32 = 5.5;
pub const FULL_AUDIO_RECOVERY_TAIL_PAD_SAMPLES: usize = 4_000;
pub const TARGETED_ALIGNMENT_MIN_OVERLAP_WORDS: usize = 3;
pub const TARGETED_ALIGNMENT_MAX_OVERLAP_WORDS: usize = 8;
pub const TARGETED_ALIGNMENT_MIN_EXTRA_WORDS: usize = 2;
pub const TARGETED_ALIGNMENT_MIN_DURATION_SECS: f32 = 6.0;
pub const TARGETED_ALIGNMENT_MAX_DURATION_SECS: f32 = 45.0;

pub const RETRY_KIND_LANGUAGE_CONTEXT_BILATERAL: &str = "language_context_bilateral";
pub const RETRY_KIND_TIMESTAMP_TRIM_FALLBACK_FULL: &str = "timestamp_trim_fallback_full";
pub const RETRY_KIND_WITHOUT_OVERLAP: &str = "without_overlap";
pub const RETRY_KIND_LANGUAGE_CONTEXT: &str = "language_context";
pub const RETRY_KIND_LANGUAGE_CONTEXT_DRIFT: &str = "language_context_drift";
pub const RETRY_KIND_LANGUAGE_CONTEXT_HYBRID: &str = "language_context_hybrid";
pub const RETRY_KIND_LANGUAGE_CONTEXT_SHORT_UNCERTAIN: &str = "language_context_short_uncertain";
pub const RETRY_KIND_LANGUAGE_CONTEXT_MIXED_PHRASE: &str = "language_context_mixed_phrase";

pub const RETRY_OUTCOME_BILATERAL_CONTEXT_IMPROVED: &str = "bilateral_context_improved";
pub const RETRY_OUTCOME_BILATERAL_CONTEXT_STILL_SUSPICIOUS: &str =
    "bilateral_context_still_suspicious";
pub const RETRY_OUTCOME_BILATERAL_CONTEXT_NO_CHANGE: &str = "bilateral_context_no_change";
pub const RETRY_OUTCOME_LANGUAGE_CONTEXT_IMPROVED: &str = "language_context_improved";
pub const RETRY_OUTCOME_LANGUAGE_CONTEXT_STILL_DRIFTS: &str = "language_context_still_drifts";
pub const RETRY_OUTCOME_LANGUAGE_CONTEXT_STILL_HYBRID_SUSPICIOUS: &str =
    "language_context_still_hybrid_suspicious";
pub const RETRY_OUTCOME_LANGUAGE_CONTEXT_NO_CHANGE: &str = "language_context_no_change";
pub const RETRY_OUTCOME_DEFERRED_WAITING_FOR_RIGHT_CONTEXT: &str =
    "deferred_waiting_for_right_context";
pub const RETRY_OUTCOME_EMPTY_OUTPUT_AFTER_OVERLAP_PATH: &str = "empty_output_after_overlap_path";

pub const RETRY_REASON_COARSE_OR_EMPTY_WORD_TIMESTAMPS: &str = "coarse_or_empty_word_timestamps";
pub const RETRY_REASON_PUNCT_GUARD_WIPED_ALL_SURVIVORS: &str = "punct_guard_wiped_all_survivors";
pub const RETRY_REASON_COMPRESSED_TIMESTAMPS_CLUSTER: &str = "compressed_timestamps_cluster";

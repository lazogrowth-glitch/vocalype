use super::model_selection::{model_supports_selected_language, resolve_runtime_model_override};
use super::paste::dispatch_text_insertion;
use super::post_processing::process_transcription_text;
use super::profiler::PipelineProfiler;
use crate::audio_feedback::{play_feedback_sound, SoundType};
use crate::chunking::{
    chunking_profile_for_model, deduplicate_boundary, deduplicate_boundary_n, ActiveChunkingHandle,
    ChunkingHandle, ChunkingSharedState, CHUNK_SAMPLER_POLL_MS, MAX_PENDING_BACKGROUND_CHUNKS,
    MIN_FINAL_CHUNK_SAMPLES, PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD, VAD_FLUSH_ENERGY_THRESHOLD,
    VAD_FLUSH_MIN_CONTENT_SAMPLES, VAD_FLUSH_SILENCE_SAMPLES,
};
use crate::context_detector::{detect_current_app_context, ActiveAppContextState};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::model::ModelManager;
use crate::managers::transcription::{TranscriptionManager, TranscriptionRequest};
use crate::model_ids::is_parakeet_v3_model_id;
use crate::parakeet_quality::{
    ParakeetDiagnosticsState, ParakeetSessionCompletion, ParakeetSessionStart,
};
use crate::runtime_observability::{
    emit_runtime_error_with_context, RuntimeErrorStage, TranscriptionLifecycleState,
};
use crate::settings::get_settings;
use crate::shortcut;
use crate::telemetry::TranscriptionTelemetry;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_preparing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::TranscriptionCoordinator;
use log::{debug, error, info, warn};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

struct FinishGuard {
    app: AppHandle,
    binding_id: String,
    operation_id: u64,
}

impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(state) = self.app.try_state::<ActiveAppContextState>() {
            if let Ok(mut snapshot) = state.0.lock() {
                snapshot.clear_active_context(&self.binding_id);
            }
        }
        if let Some(coordinator) = self.app.try_state::<TranscriptionCoordinator>() {
            // Don't abort if the operation is already in the Pasting stage.
            // The paste has been dispatched to the main thread and will
            // complete (or fail) the operation itself — calling fail_operation
            // here would clear active_operation_id before the main thread runs,
            // causing is_operation_active() to return false and silently skip
            // the paste.
            let already_pasting =
                coordinator.lifecycle_state() == TranscriptionLifecycleState::Pasting;
            if coordinator.is_operation_active(self.operation_id) && !already_pasting {
                coordinator.fail_operation(&self.app, self.operation_id, "pipeline-aborted");
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TranscriptionStatus {
    Success,
    NoSpeech,
    Partial,
}

struct TranscriptionResult {
    session_id: u64,
    samples: Vec<f32>,
    transcription: String,
    confidence_payload: Option<crate::transcription_confidence::TranscriptionConfidencePayload>,
    #[allow(dead_code)]
    chunk_count: usize,
    status: TranscriptionStatus,
    failed_chunk_count: usize,
}

fn preview_text(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn build_live_preview(results: &[(usize, String)], max_chars: usize) -> String {
    let mut ordered: Vec<_> = results
        .iter()
        .filter_map(|(idx, text)| {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((*idx, trimmed.to_string()))
            }
        })
        .collect();
    ordered.sort_by_key(|(idx, _)| *idx);
    preview_text(
        &ordered
            .into_iter()
            .map(|(_, text)| text)
            .collect::<Vec<_>>()
            .join(" "),
        max_chars,
    )
}

fn emit_transcription_preview(
    app: &AppHandle,
    operation_id: u64,
    stage: &str,
    text: &str,
    stable: bool,
) {
    let trimmed = text.trim();
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.update_live_preview(
            operation_id,
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            },
        );
    }
    let _ = app.emit(
        "transcription-preview",
        serde_json::json!({
            "operation_id": operation_id,
            "stage": stage,
            "stable": stable,
            "text": if trimmed.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(trimmed.to_string()) },
        }),
    );
}

fn is_viable_preview_rescue_candidate(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.split_whitespace().count() >= 4
        && trimmed.chars().filter(|ch| ch.is_alphabetic()).count() >= 12
}

fn is_viable_final_recovery_candidate(text: &str) -> bool {
    text.split_whitespace().count() >= 3 && text.chars().any(|ch| ch.is_alphabetic())
}

fn append_recovered_final_chunk(assembled: &str, recovered: &str) -> String {
    if assembled.trim().is_empty() {
        return recovered.trim().to_string();
    }

    let deduped = deduplicate_boundary_n(assembled, recovered, 6);
    if deduped.trim().is_empty() {
        assembled.to_string()
    } else {
        format!("{} {}", assembled.trim_end(), deduped.trim_start())
    }
}

fn should_attempt_full_audio_recovery(
    summary: &ParakeetSessionCompletion,
    sample_count: usize,
    assembled: &str,
) -> bool {
    let duration_secs = sample_count as f32 / 16_000.0;
    if !(6.0..=35.0).contains(&duration_secs) {
        return false;
    }

    let assembled_words = assembled.split_whitespace().count();
    let assembled_words_per_sec = assembled_words as f32 / duration_secs.max(0.1);
    let final_chunk_secs = summary.final_chunk_samples as f32 / 16_000.0;
    let final_chunk_words_per_sec = summary.final_chunk_words as f32 / final_chunk_secs.max(0.1);

    let low_density = assembled_words_per_sec <= 1.20;
    let empty_boundary = summary.empty_nonfinal_chunks > 0 && low_density;
    let short_final_chunk = final_chunk_secs >= 1.0
        && final_chunk_secs <= 4.5
        && summary.final_chunk_words <= 1
        && assembled_words_per_sec <= 2.2;
    let sparse_final_chunk = final_chunk_secs >= 4.0
        && final_chunk_words_per_sec <= 0.18
        && assembled_words_per_sec <= 1.8;
    // Empty final chunk with any density: ending was likely cut
    let empty_final_chunk =
        summary.final_chunk_words == 0 && final_chunk_secs >= 2.0 && assembled_words_per_sec <= 2.3;

    empty_boundary || short_final_chunk || sparse_final_chunk || empty_final_chunk
}

fn should_promote_full_audio_recovery(
    assembled: &str,
    recovered: &str,
    sample_count: usize,
) -> bool {
    let assembled_words = assembled.split_whitespace().count();
    let recovered_words = recovered.split_whitespace().count();
    let duration_secs = sample_count as f32 / 16_000.0;
    let recovered_words_per_sec = recovered_words as f32 / duration_secs.max(0.1);

    recovered_words >= assembled_words + 4
        && (recovered_words as f32) >= (assembled_words as f32 * 1.20)
        && (0.3..=5.5).contains(&recovered_words_per_sec)
        && is_viable_preview_rescue_candidate(recovered)
}

fn is_operation_active(app: &AppHandle, operation_id: u64) -> bool {
    app.try_state::<TranscriptionCoordinator>()
        .map(|coordinator| coordinator.is_operation_active(operation_id))
        .unwrap_or(false)
}

fn should_auto_paste(status: TranscriptionStatus) -> bool {
    matches!(status, TranscriptionStatus::Success)
}

fn should_fallback_from_timestamp_trim(raw_text: &str, words_in: usize, words_out: usize) -> bool {
    let raw_word_count = raw_text.split_whitespace().count();
    if raw_word_count < 3 {
        return false;
    }

    words_out == 0 || (words_in <= 1 && words_out + 2 < raw_word_count)
}

/// Returns `true` when the TDT word timestamps are too tightly clustered to be
/// trustworthy for overlap trimming.
///
/// The TDT joint head predicts both a token and a duration (frame advance).  When
/// `duration_step = 0` for several consecutive tokens, the decoder stays on the
/// same encoder frame and all those tokens share an identical timestamp.  This can
/// cause an entire chunk's worth of words to land at a single frame value —
/// e.g. all 10 words at `t = 5.0 s` even though the overlap cutoff is `2.0 s`.
/// In that case none of them are trimmed, and the overlap content leaks into the
/// final text as duplicates.
///
/// Detection: if the span between the earliest and latest word timestamp is less
/// than `words_in × 0.04 s`, the timestamps cannot reflect real audio positions
/// (minimum realistic spread is `words_in × 0.08 s`, one encoder frame per word).
///
/// Guard: only activates on chunks longer than 3 s (to avoid false positives on
/// legitimately short/dense clips) with at least 5 word segments.
fn is_timestamp_cluster_compressed(
    segs: &[transcribe_rs::TranscriptionSegment],
    words_in: usize,
    chunk_samples: usize,
) -> bool {
    if words_in < 5 || chunk_samples <= 3 * 16_000 {
        return false;
    }
    let min_ts = segs.iter().map(|s| s.start).fold(f32::INFINITY, f32::min);
    let max_ts = segs
        .iter()
        .map(|s| s.start)
        .fold(f32::NEG_INFINITY, f32::max);
    let ts_span = max_ts - min_ts;
    // Threshold: half the minimum spread assuming each word occupies one encoder
    // frame (0.08 s).  Below this the timestamps are physically impossible to be
    // correct.
    ts_span < words_in as f32 * 0.04
}

/// Returns `true` when a word (already lowercased, punctuation-stripped) is a common
/// French word that contains no accent characters.  Used to avoid false-positive
/// language-switch detections on valid short French phrases like "Musique de qui?"
/// or "Pas de mentir." that happen to have no accent chars.
fn is_known_french_word_no_accent(w: &str) -> bool {
    matches!(
        w,
        // ── Pronouns ──────────────────────────────────────────────────────────
        "je" | "tu" | "il" | "elle" | "nous" | "vous" | "ils" | "elles" | "on"
        | "moi" | "toi" | "lui" | "eux" | "soi" | "y"
        // ── Articles & determiners ────────────────────────────────────────────
        | "le" | "la" | "les" | "un" | "une" | "des" | "du" | "de" | "l" | "d"
        // ── Possessives ───────────────────────────────────────────────────────
        | "mon" | "ma" | "mes" | "ton" | "ta" | "tes" | "son" | "sa" | "ses"
        | "notre" | "nos" | "votre" | "vos" | "leur" | "leurs"
        // ── Demonstratives ────────────────────────────────────────────────────
        | "ce" | "cet" | "cette" | "ces" | "celui" | "celle" | "ceux" | "celles"
        // ── Conjunctions & connectors ─────────────────────────────────────────
        | "et" | "ou" | "mais" | "donc" | "or" | "ni" | "car" | "si"
        | "que" | "qui" | "quand" | "comment" | "combien" | "pourquoi"
        | "quoi" | "dont" | "lequel" | "laquelle" | "lesquels" | "lesquelles"
        // ── Prepositions ──────────────────────────────────────────────────────
        | "en" | "dans" | "sur" | "sous" | "avec" | "sans" | "pour" | "par"
        | "vers" | "chez" | "entre" | "parmi" | "apres" | "avant" | "depuis"
        | "lors" | "jusque" | "selon" | "contre" | "malgre"
        // ── Negation ──────────────────────────────────────────────────────────
        | "pas" | "ne" | "non" | "jamais" | "rien" | "guere" | "point"
        // ── Common verbs (accent-free forms only) ────────────────────────────
        | "est" | "sont" | "ont" | "a" | "ai" | "as" | "fait" | "dit" | "va"
        | "vais" | "vas" | "suis" | "faut" | "sait" | "croit" | "crois"
        | "vois" | "voit" | "peut" | "veut" | "veux" | "joue" | "joues"
        | "parle" | "parles" | "connais" | "connait" | "viens" | "vient"
        | "tiens" | "tient" | "prends" | "prend" | "suit" | "met" | "mets"
        | "sort" | "sors" | "vaut" | "comprend" | "comprends" | "appartient"
        | "font" | "vont" | "savent" | "lisent" | "croient" | "disent"
        | "voient" | "mettent" | "sortent" | "viennent" | "tiennent"
        | "voir" | "savoir" | "pouvoir" | "vouloir" | "devoir" | "avoir"
        | "faire" | "dire" | "aller" | "venir" | "partir" | "finir"
        | "mentir" | "sortir" | "prendre" | "mettre" | "connaitre"
        | "comprendre" | "apprendre" | "commencer" | "continuer"
        | "regarder" | "ecouter" | "parler" | "penser" | "croire"
        // ── Adverbs ───────────────────────────────────────────────────────────
        | "bien" | "mal" | "vite" | "souvent" | "parfois" | "toujours"
        | "aussi" | "encore" | "puis" | "alors" | "ensuite" | "sinon"
        | "vraiment" | "beaucoup" | "trop" | "peu" | "plus" | "moins"
        | "deja" | "maintenant" | "bientot" | "tout" | "tous" | "toute"
        | "toutes" | "fort" | "tres"
        // ── Common adjectives (no accent) ────────────────────────────────────
        | "bon" | "bonne" | "bons" | "bonnes" | "grand" | "grande" | "grands"
        | "grandes" | "petit" | "petite" | "petits" | "petites"
        | "seul" | "seule" | "seuls" | "seules" | "vrai" | "vraie" | "vrais"
        | "vraies" | "faux" | "fausse" | "long" | "court" | "rapide" | "lent"
        | "libre" | "dur" | "dure" | "durs" | "dures"
        // ── Common nouns without accents ─────────────────────────────────────
        | "musique" | "film" | "films" | "livre" | "livres" | "sport" | "jeu"
        | "jeux" | "fois" | "mois" | "ans" | "jours" | "jour" | "an" | "soir"
        | "matin" | "moment" | "temps" | "coup" | "bout" | "lieu" | "tour"
        | "part" | "type" | "truc" | "trucs" | "chose" | "choses" | "gens"
        | "monde" | "vie" | "pays" | "rue" | "cas" | "nom" | "mot" | "mots"
        | "sens" | "faits" | "personne" | "personnes" | "homme" | "femme"
        | "enfant" | "ami" | "amis" | "travail" | "boulot" | "argent"
        | "voiture" | "maison" | "appartement" | "recruteur" | "recruteurs"
        | "application" | "applications" | "message" | "messages"
        | "client" | "clients" | "service" | "services" | "projet" | "projets"
        | "probleme" | "problemes" | "solution" | "solutions" | "question"
        | "questions" | "reponse" | "reponses" | "idee" | "idees"
        | "plan" | "plans" | "objectif" | "objectifs"
        // ── Numbers ───────────────────────────────────────────────────────────
        | "deux" | "trois" | "quatre" | "cinq" | "six" | "sept" | "huit"
        | "neuf" | "dix" | "onze" | "douze" | "vingt" | "trente" | "quarante"
        | "cinquante" | "soixante" | "cent" | "mille"
        // ── Expressions & fillers ─────────────────────────────────────────────
        | "oui" | "bah" | "boh" | "ben" | "voila" | "super" | "ok" | "okay"
        | "genre" | "hein" | "nan" | "ouais" | "wesh" | "bonjour" | "bonsoir"
        | "merci" | "pardon" | "salut" | "hop" | "allez"
    )
}

/// Returns `true` when a short chunk in a non-English session produced output
/// that is likely a language switch to English rather than valid target-language speech.
///
/// Three-stage check (early exits prevent false positives):
/// 1. Apostrophes in the text → definitely target-language (French "quelqu'un",
///    "c'est"; these contractions are rare in 1-3 word English ASR output).
/// 2. At least one target-language accent char → still in the right language.
/// 3. All words present in the French no-accent lexicon → valid French without
///    accents (e.g. "Musique de qui?", "Pas de mentir.") — skip retry.
///
/// Only triggers for non-auto, non-English sessions on short chunks (≤ 3 s, ≤ 3 words).
fn is_likely_language_switched_short_chunk(
    text: &str,
    selected_language: &str,
    chunk_samples: usize,
) -> bool {
    if selected_language == "auto" || selected_language.starts_with("en") {
        return false;
    }
    if chunk_samples > 3 * 16_000 {
        return false;
    }
    let word_count = text.split_whitespace().count();
    if word_count == 0 || word_count > 3 {
        return false;
    }
    // Apostrophes signal target-language contractions.
    if text.contains('\'') || text.contains('\u{2019}') {
        return false;
    }
    // At least one accent char → still in target language.
    let has_accent = text.chars().any(|c| {
        matches!(
            c,
            'é' | 'è'
                | 'ê'
                | 'ë'
                | 'à'
                | 'â'
                | 'ä'
                | 'ô'
                | 'ö'
                | 'û'
                | 'ü'
                | 'ù'
                | 'ï'
                | 'î'
                | 'ç'
                | 'œ'
                | 'æ'
                | 'É'
                | 'È'
                | 'Ê'
                | 'Ë'
                | 'À'
                | 'Â'
                | 'Ä'
                | 'Ô'
                | 'Ö'
                | 'Û'
                | 'Ü'
                | 'Ù'
                | 'Ï'
                | 'Î'
                | 'Ç'
                | 'Œ'
                | 'Æ'
                | 'ñ'
                | 'Ñ'
                | 'ú'
                | 'Ú'
                | 'ó'
                | 'Ó'
                | 'ã'
                | 'Ã'
                | 'õ'
                | 'Õ'
                | 'ß'
        )
    });
    if has_accent {
        return false;
    }
    // No accent chars and no apostrophes.  For French sessions, check if every word
    // is a known French word that simply has no accent — e.g. "Musique de qui?"
    // These are valid output; retrying them wastes an inference call.
    if selected_language == "fr" || selected_language.starts_with("fr-") {
        let all_french = text.split_whitespace().all(|token| {
            let bare: String = token
                .chars()
                .filter(|c| c.is_alphabetic())
                .collect::<String>()
                .to_lowercase();
            bare.is_empty() || is_known_french_word_no_accent(&bare)
        });
        if all_french {
            return false;
        }
    }
    true
}

fn should_skip_low_signal_vad_chunk(new_slice: &[f32]) -> bool {
    if new_slice.is_empty() {
        return false;
    }
    let mean_energy = new_slice.iter().map(|s| s * s).sum::<f32>() / (new_slice.len() as f32);
    mean_energy < crate::chunking::VAD_SILENT_CHUNK_ENERGY_THRESHOLD
}

/// Returns `true` when BOTH conditions are met:
///
///  1. **Code context** — the session glossary holds ≥ 3 extracted identifiers,
///     meaning the user has been actively copying code recently.
///
///  2. **Text is worth processing** — at least one of:
///     - The text contains a known glossary term (technical content).
///       This is the primary signal: Parakeet already strips most filler words,
///       so checking for fillers in its output is unreliable. A glossary term
///       in the transcription is a direct, stable signal that the text is code-related.
///     - The text is ≥ 8 words (long-form dictation — likely a complex request).
///       Short phrases like "ok thanks" or "good morning" never reach 8 words,
///       so they're always left untouched.
///
/// Filler-word detection was deliberately removed: Parakeet V3 partially removes
/// fillers itself, making the check inconsistent and prone to missed triggers.
fn auto_llm_should_trigger(app: &AppHandle, text: &str) -> bool {
    // Primary signal: spoken code patterns in the transcription itself.
    // Works regardless of which app is active or what's in the clipboard.
    if crate::code_dictation::contains_spoken_code_patterns(text) {
        return true;
    }

    // Secondary signal: glossary has code identifiers AND text references one.
    // Catches cases like "add error handling to fetchUser" (no spoken symbols).
    let Some(state) = app.try_state::<crate::runtime::session_glossary::SessionGlossaryState>()
    else {
        return false;
    };
    let Ok(glossary) = state.0.lock() else {
        return false;
    };
    if glossary.term_count() < 3 {
        return false;
    }
    let text_lower = text.to_lowercase();
    glossary
        .terms
        .iter()
        .any(|term| text_lower.contains(&term.to_lowercase()))
}

fn classify_microphone_start_error(message: &str) -> &'static str {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("permission") || normalized.contains("access denied") {
        "MIC_PERMISSION_DENIED"
    } else if normalized.contains("no input device")
        || normalized.contains("no longer available")
        || normalized.contains("ambiguous")
        || normalized.contains("not found")
    {
        "MIC_NOT_FOUND"
    } else {
        "MIC_OPEN_FAILED"
    }
}

#[derive(Clone, Copy, Debug)]
struct AudioSignalSummary {
    duration_seconds: f32,
    rms: f32,
    peak: f32,
}

impl AudioSignalSummary {
    fn has_captured_signal(self) -> bool {
        self.duration_seconds >= 1.0 && (self.rms >= 0.003 || self.peak >= 0.02)
    }
}

fn summarize_audio_signal(samples: &[f32]) -> AudioSignalSummary {
    if samples.is_empty() {
        return AudioSignalSummary {
            duration_seconds: 0.0,
            rms: 0.0,
            peak: 0.0,
        };
    }

    let mut sum_squares = 0.0_f32;
    let mut peak = 0.0_f32;
    for sample in samples {
        let magnitude = sample.abs();
        sum_squares += sample * sample;
        if magnitude > peak {
            peak = magnitude;
        }
    }

    AudioSignalSummary {
        duration_seconds: samples.len() as f32 / 16_000.0,
        rms: (sum_squares / samples.len() as f32).sqrt(),
        peak,
    }
}

fn empty_transcription_error(samples: &[f32]) -> (&'static str, String, &'static str) {
    let signal = summarize_audio_signal(samples);
    if signal.has_captured_signal() {
        (
            "AUDIO_CAPTURED_EMPTY_TRANSCRIPT",
            format!(
                "Audio signal was captured ({:.1}s, rms {:.4}, peak {:.4}), but transcription returned empty output; paste skipped",
                signal.duration_seconds, signal.rms, signal.peak
            ),
            "audio-captured-empty-transcription",
        )
    } else {
        (
            "NO_SPEECH_DETECTED",
            "No speech detected in the captured audio; paste skipped".to_string(),
            "no-speech",
        )
    }
}

pub(super) fn should_switch_to_long_audio_model(
    duration_seconds: f32,
    threshold_seconds: f32,
    current_model_id: Option<&str>,
    long_model_id: Option<&str>,
) -> bool {
    let Some(long_model_id) = long_model_id else {
        return false;
    };

    duration_seconds > threshold_seconds && current_model_id != Some(long_model_id)
}

pub(crate) fn start_transcription_action(app: &AppHandle, binding_id: &str) {
    let start_time = Instant::now();
    debug!("[TIMING] ⏱ shortcut received for binding: {}", binding_id);

    if let Err(err) = crate::license::enforce_any_access(app, "dictation") {
        warn!("Access gate denied transcription start: {}", err);
        let _ = app.emit("premium-access-denied", err.clone());
        return;
    }
    debug!("[TIMING] license check: {:?}", start_time.elapsed());

    let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() else {
        error!("TranscriptionCoordinator not initialized");
        return;
    };
    let operation_id = match coordinator.begin_preparing(app, binding_id) {
        Ok(operation_id) => operation_id,
        Err(reason) => {
            debug!(
                "Skipping transcription start for '{}': {}",
                binding_id, reason
            );
            return;
        }
    };
    debug!("[TIMING] begin_preparing: {:?}", start_time.elapsed());
    show_preparing_overlay(app);
    debug!(
        "[TIMING] show_preparing_overlay: {:?}",
        start_time.elapsed()
    );

    if !crate::startup_warmup::can_start_recording(app) {
        crate::startup_warmup::ensure_startup_warmup(app, "transcription-blocked");
        let warmup_status = crate::startup_warmup::current_status(app);

        // Let recording start while the selected model finishes loading in the
        // background. This removes the perceived 2-5s dead time before the
        // overlay appears, while still keeping hard blocks for missing models
        // or microphone failures.
        let should_block_capture = matches!(
            warmup_status.reason,
            crate::startup_warmup::StartupWarmupReason::NoModelSelected
                | crate::startup_warmup::StartupWarmupReason::ModelNotDownloaded
                | crate::startup_warmup::StartupWarmupReason::MicrophoneError
                | crate::startup_warmup::StartupWarmupReason::ModelError
        );

        if should_block_capture {
            let message = crate::startup_warmup::block_message(app);
            warn!(
                "Blocking transcription start until warmup completes: {}",
                message
            );
            let _ = app.emit("transcription-warmup-blocked", message);
            let _ = coordinator.complete_operation(app, operation_id, "warmup-blocked");
            utils::hide_recording_overlay(app);
            change_tray_icon(app, TrayIconState::Idle);
            return;
        }
        debug!(
            "[TIMING] warmup bypassed (PreparingModel): {:?}",
            start_time.elapsed()
        );
    }
    debug!("[TIMING] warmup check: {:?}", start_time.elapsed());

    if crate::license::current_plan(app).as_deref() == Some("basic") {
        let since = (chrono::Utc::now() - chrono::Duration::days(7)).timestamp();
        let hm = app.state::<Arc<HistoryManager>>();
        match hm.count_recent_transcriptions(since) {
            Ok(count) if count >= 30 => {
                warn!(
                    "Basic quota exceeded ({}/30), blocking transcription start",
                    count
                );
                let _ = app.emit(
                    "transcription-quota-exceeded",
                    serde_json::json!({ "count": count, "limit": 30 }),
                );
                let _ = coordinator.complete_operation(app, operation_id, "quota-exceeded");
                utils::hide_recording_overlay(app);
                change_tray_icon(app, TrayIconState::Idle);
                return;
            }
            Err(e) => {
                warn!("Failed to check transcription quota: {}", e);
            }
            _ => {}
        }
    }

    let captured_app_context = detect_current_app_context();
    debug!("[TIMING] app context detected: {:?}", start_time.elapsed());

    let tm = app.state::<Arc<TranscriptionManager>>();
    let model_was_loaded_before_click = tm.is_model_loaded();
    tm.initiate_model_load();

    let binding_id = binding_id.to_string();

    let rm = app.state::<Arc<AudioRecordingManager>>();
    let settings = get_settings(app);
    let is_always_on = settings.always_on_microphone;
    let microphone_stream_was_open_before_click = rm.is_microphone_stream_open();

    play_feedback_sound(app, SoundType::Start);
    if is_always_on {
        rm.apply_mute();
    }

    let recording_start_time = Instant::now();
    let recording_started = rm.try_start_recording(&binding_id);
    debug!(
        "[TIMING] try_start_recording: {:?} (took {:?})",
        start_time.elapsed(),
        recording_start_time.elapsed()
    );
    if !recording_started {
        let reason = rm
            .last_error_message()
            .unwrap_or_else(|| "Failed to start microphone recording".to_string());
        emit_runtime_error_with_context(
            app,
            classify_microphone_start_error(&reason),
            RuntimeErrorStage::Capture,
            reason.clone(),
            true,
            Some(operation_id),
            get_settings(app).selected_microphone.clone(),
            tm.get_current_model(),
        );
        let _ = coordinator.fail_operation(app, operation_id, "microphone-start-failed");
        shortcut::unregister_cancel_shortcut(app);
        shortcut::unregister_pause_shortcut(app);
        shortcut::unregister_action_shortcuts(app);
        utils::hide_recording_overlay(app);
        change_tray_icon(app, TrayIconState::Idle);
        return;
    }

    debug!("Recording started in {:?}", recording_start_time.elapsed());

    // Start llama-server (if not already running) while the user is speaking.
    // 2-4s startup is hidden behind the dictation. Server stops after post-processing.
    if settings.post_process_enabled || settings.llm_auto_mode {
        crate::llm::llama_server::start_for_transcription(app.clone());
    }

    if !is_always_on {
        rm.apply_mute();
    }
    if settings.auto_pause_media {
        crate::platform::media_control::pause_media();
    }

    if let Some(state) = app.try_state::<ActiveAppContextState>() {
        if let Ok(mut snapshot) = state.0.lock() {
            snapshot.set_active_context(&binding_id, captured_app_context.clone());
        }
    }

    shortcut::register_cancel_shortcut(app);
    shortcut::register_pause_shortcut(app);
    shortcut::register_action_shortcuts(app);
    debug!("[TIMING] shortcuts registered: {:?}", start_time.elapsed());
    let _ = coordinator.mark_recording(app, operation_id);
    change_tray_icon(app, TrayIconState::Recording);
    show_recording_overlay(app);
    debug!(
        "[TIMING] ✅ show_recording_overlay (bouton visible): {:?}",
        start_time.elapsed()
    );

    let current_model_info = app.try_state::<Arc<ModelManager>>().and_then(|mm| {
        let settings = get_settings(app);
        let model_id = if settings.selected_model.is_empty() {
            app.state::<Arc<TranscriptionManager>>().get_current_model()
        } else {
            Some(settings.selected_model)
        }?;
        mm.get_model_info(&model_id)
    });
    let chunking_profile = chunking_profile_for_model(app, current_model_info.as_ref(), &settings);

    if let Some(chunking_profile) = chunking_profile {
        let is_parakeet_v3 = current_model_info
            .as_ref()
            .map(|info| is_parakeet_v3_model_id(&info.id))
            .unwrap_or(false);

        let rm_s = Arc::clone(&*app.state::<Arc<AudioRecordingManager>>());
        let tm_s = Arc::clone(&*app.state::<Arc<TranscriptionManager>>());

        // Telemetry — unique session ID per recording.
        let session_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let provider = settings
            .adaptive_machine_profile
            .as_ref()
            .and_then(|profile| profile.active_backend.as_ref().map(|b| format!("{:?}", b)))
            .unwrap_or_else(|| "runtime-default".to_string());
        let tel: Arc<TranscriptionTelemetry> = app
            .try_state::<Arc<TranscriptionTelemetry>>()
            .map(|s| Arc::clone(&*s))
            .unwrap_or_else(|| Arc::new(TranscriptionTelemetry::disabled()));
        let tel_sampler = Arc::clone(&tel);
        let tel_worker = Arc::clone(&tel);
        let tel_engine = Arc::clone(&tel);
        let quality_counters = Arc::new(Mutex::new(ParakeetSessionCompletion::default()));
        let final_recovery_candidate: Arc<Mutex<Option<(usize, String)>>> =
            Arc::new(Mutex::new(None));
        let recording_start_elapsed_ms = recording_start_time.elapsed().as_millis() as u64;
        let startup_path_latency_ms = start_time.elapsed().as_millis() as u64;
        let record_start_marker = Instant::now();

        if is_parakeet_v3 {
            tel.log_session_start(
                session_id,
                Some(operation_id),
                current_model_info
                    .as_ref()
                    .map(|info| info.id.as_str())
                    .unwrap_or("parakeet-v3"),
                current_model_info.as_ref().map(|info| info.name.as_str()),
                &provider,
                &settings.selected_language,
                settings.selected_microphone.as_deref(),
                &format!("{:?}", settings.effective_recording_mode()).to_ascii_lowercase(),
                chunking_profile.interval_samples,
                chunking_profile.overlap_samples,
            );
            tel.log_recording_path(
                session_id,
                Some(operation_id),
                current_model_info
                    .as_ref()
                    .map(|info| info.id.as_str())
                    .unwrap_or("parakeet-v3"),
                microphone_stream_was_open_before_click,
                model_was_loaded_before_click,
                recording_start_elapsed_ms,
                startup_path_latency_ms,
            );
            if model_was_loaded_before_click {
                tel.log_engine_activation(
                    session_id,
                    Some(operation_id),
                    current_model_info
                        .as_ref()
                        .map(|info| info.id.as_str())
                        .unwrap_or("parakeet-v3"),
                    0,
                    true,
                    "already_loaded_before_click",
                );
            } else {
                let tm_engine = Arc::clone(&*tm);
                let model_id = current_model_info
                    .as_ref()
                    .map(|info| info.id.clone())
                    .unwrap_or_else(|| "parakeet-v3".to_string());
                let engine_wait_start = Instant::now();
                std::thread::spawn(move || {
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
                    loop {
                        if tm_engine.get_current_model().as_deref() == Some(model_id.as_str())
                            && tm_engine.is_model_loaded()
                        {
                            tel_engine.log_engine_activation(
                                session_id,
                                Some(operation_id),
                                &model_id,
                                engine_wait_start.elapsed().as_millis() as u64,
                                false,
                                "loaded_after_click",
                            );
                            break;
                        }

                        if std::time::Instant::now() >= deadline {
                            tel_engine.log_engine_activation(
                                session_id,
                                Some(operation_id),
                                &model_id,
                                engine_wait_start.elapsed().as_millis() as u64,
                                false,
                                "timed_out_waiting_for_load",
                            );
                            break;
                        }

                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                });
            }
            if let Some(state) = app.try_state::<ParakeetDiagnosticsState>() {
                state.start_session(ParakeetSessionStart {
                    session_id,
                    operation_id: Some(operation_id),
                    binding_id: binding_id.to_string(),
                    model_id: current_model_info
                        .as_ref()
                        .map(|info| info.id.clone())
                        .unwrap_or_else(|| "parakeet-v3".to_string()),
                    model_name: current_model_info.as_ref().map(|info| info.name.clone()),
                    provider: provider.clone(),
                    selected_language: settings.selected_language.clone(),
                    device_name: settings.selected_microphone.clone(),
                    recording_mode: format!("{:?}", settings.effective_recording_mode())
                        .to_ascii_lowercase(),
                    chunk_interval_samples: chunking_profile.interval_samples,
                    chunk_overlap_samples: chunking_profile.overlap_samples,
                });
            }
        }

        let shared_state = Arc::new(Mutex::new(ChunkingSharedState {
            last_committed_idx: 0,
            next_chunk_idx: 0,
        }));
        let results: Arc<Mutex<Vec<(usize, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let failed_chunks = Arc::new(AtomicUsize::new(0));
        let pending_chunks = Arc::new(AtomicUsize::new(0));
        let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // Channel payload: (audio, chunk_idx, overlap_cutoff_secs)
        // overlap_cutoff_secs = 0.0 for the first chunk (no real overlap yet),
        // = overlap_samples / 16_000 for all subsequent chunks.
        let (chunk_tx, chunk_rx) =
            std::sync::mpsc::channel::<Option<(Vec<f32>, usize, f32, bool)>>();

        let shared_s = Arc::clone(&shared_state);
        let tx_s = chunk_tx.clone();
        let pending_s = Arc::clone(&pending_chunks);
        let cancel_flag_worker = Arc::clone(&cancel_flag);
        let counters_sampler = Arc::clone(&quality_counters);
        let sampler_handle = std::thread::spawn(move || {
            // After a VAD flush, the boundary falls on a natural pause, so the
            // next chunk needs no overlap (no risk of cutting mid-word).
            // This prevents the first words of a new sentence from being
            // silently discarded by the timestamp-based overlap trimmer.
            let mut skip_overlap_next_chunk = false;

            // Diagnostic-only counters for stuck-session detection (no behaviour change).
            let sampler_start = Instant::now();
            let mut chunks_dispatched: u64 = 0;
            let mut last_warn_secs: u64 = 0;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(CHUNK_SAMPLER_POLL_MS));

                // Diagnostic: warn if a session has been running unusually long.
                // Threshold: ≥300 s elapsed, then every 60 s. No behaviour change.
                let elapsed_secs = sampler_start.elapsed().as_secs();
                if elapsed_secs >= 300 && elapsed_secs.saturating_sub(last_warn_secs) >= 60 {
                    warn!(
                        "[sampler] session_id={} still running after {}s ({} chunks dispatched) — possible stuck session (diagnostic)",
                        session_id, elapsed_secs, chunks_dispatched
                    );
                    last_warn_secs = elapsed_secs;
                }

                let snapshot = match rm_s.snapshot_recording() {
                    Some(s) => s,
                    None => break,
                };

                let total = snapshot.len();
                let (last_committed, next_idx) = {
                    let s = shared_s.lock().unwrap_or_else(|e| e.into_inner());
                    (s.last_committed_idx, s.next_chunk_idx)
                };
                let new_samples = total.saturating_sub(last_committed);

                // ── Interval flush ────────────────────────────────────────────── //
                let interval_ready = new_samples >= chunking_profile.interval_samples;

                // ── VAD-triggered flush (Parakeet V3 only) ────────────────────── //
                // When a natural pause of ≥300 ms is detected after ≥1 s of new
                // speech, flush immediately instead of waiting for the interval.
                // This prevents sentence-boundary word cuts that happen with fixed
                // intervals when the user speaks longer than the chunk duration.
                let recent_energy: Option<f32> = if is_parakeet_v3
                    && !interval_ready
                    && new_samples >= VAD_FLUSH_MIN_CONTENT_SAMPLES
                    && total >= VAD_FLUSH_SILENCE_SAMPLES
                {
                    let recent = &snapshot[total - VAD_FLUSH_SILENCE_SAMPLES..];
                    Some(
                        recent.iter().map(|s| s * s).sum::<f32>()
                            / VAD_FLUSH_SILENCE_SAMPLES as f32,
                    )
                } else {
                    None
                };
                let vad_flush = recent_energy.map_or(false, |e| e < VAD_FLUSH_ENERGY_THRESHOLD);

                if interval_ready || vad_flush {
                    let pending_now = pending_s.load(Ordering::Relaxed);
                    if pending_now >= MAX_PENDING_BACKGROUND_CHUNKS {
                        if is_parakeet_v3 {
                            tel_sampler.log_chunk_candidate(
                                session_id,
                                next_idx,
                                if interval_ready { "interval" } else { "vad" },
                                new_samples,
                                total,
                                chunking_profile.overlap_samples,
                                chunking_profile.overlap_samples as f32 / 16_000.0,
                                pending_now,
                                false,
                                "pending_background_limit",
                            );
                            if let Ok(mut counters) = counters_sampler.lock() {
                                counters.chunk_candidates_rejected += 1;
                            }
                        }
                        continue;
                    }

                    // After a VAD flush, skip overlap so the timestamp trimmer
                    // doesn't discard the first words of the following sentence.
                    let overlap = if skip_overlap_next_chunk {
                        0
                    } else {
                        chunking_profile.overlap_samples
                    };
                    let actual_overlap = last_committed.min(overlap);
                    let chunk_start = last_committed - actual_overlap;
                    // Interval flush: commit exactly interval_samples from last_committed.
                    // VAD flush: commit everything up to now (total) so no audio is lost.
                    let chunk_end = if interval_ready {
                        last_committed + chunking_profile.interval_samples
                    } else {
                        total
                    };
                    let chunk = snapshot[chunk_start..chunk_end].to_vec();
                    let cutoff_secs = actual_overlap as f32 / 16_000.0;
                    let new_slice = if actual_overlap <= chunk.len() {
                        &chunk[actual_overlap..]
                    } else {
                        &chunk[..]
                    };

                    // Next chunk skips overlap only when this one ended on a VAD pause.
                    skip_overlap_next_chunk = vad_flush;

                    let flush_type = if interval_ready { "interval" } else { "vad" };
                    if is_parakeet_v3 {
                        if chunks_dispatched == 0 {
                            tel_sampler.log_first_chunk_dispatch(
                                session_id,
                                next_idx,
                                record_start_marker.elapsed().as_millis() as u64,
                                new_samples,
                                total,
                                flush_type,
                            );
                        }
                        tel_sampler.log_chunk_candidate(
                            session_id,
                            next_idx,
                            flush_type,
                            new_samples,
                            total,
                            actual_overlap,
                            cutoff_secs,
                            pending_now,
                            true,
                            if interval_ready {
                                "interval_reached"
                            } else {
                                "vad_pause_detected"
                            },
                        );
                        if let Ok(mut counters) = counters_sampler.lock() {
                            counters.chunk_candidates_sent += 1;
                        }
                    }
                    let new_signal = summarize_audio_signal(new_slice);
                    tel_sampler.log_chunk_sent(
                        session_id,
                        next_idx,
                        flush_type,
                        new_samples,
                        total,
                        recent_energy.unwrap_or(-1.0),
                        new_signal.rms,
                        new_signal.peak,
                        actual_overlap,
                        cutoff_secs,
                    );

                    // Dead-silence gate: skip model inference when the new portion of a
                    // VAD-triggered chunk is pure noise (user held push-to-talk in silence).
                    // Compute mean energy only over new_samples (excluding overlap prefix).
                    let is_dead_silent_vad_chunk =
                        is_parakeet_v3 && vad_flush && should_skip_low_signal_vad_chunk(new_slice);
                    if is_dead_silent_vad_chunk {
                        let mut s = shared_s.lock().unwrap_or_else(|e| e.into_inner());
                        s.last_committed_idx = chunk_end;
                        continue;
                    }

                    pending_s.fetch_add(1, Ordering::Relaxed);
                    match tx_s.send(Some((chunk, next_idx, cutoff_secs, false))) {
                        Ok(()) => {
                            let mut s = shared_s.lock().unwrap_or_else(|e| e.into_inner());
                            s.last_committed_idx = chunk_end;
                            s.next_chunk_idx += 1;
                            chunks_dispatched += 1;
                        }
                        Err(_) => {
                            pending_s.fetch_sub(1, Ordering::Relaxed);
                            break;
                        }
                    }
                }
            }
            // Diagnostic: log sampler exit for stuck-session diagnosis.
            info!(
                "[sampler] exiting — ran {}s, {} chunks dispatched",
                sampler_start.elapsed().as_secs(),
                chunks_dispatched
            );
        });

        let results_w = Arc::clone(&results);
        let failed_chunks_w = Arc::clone(&failed_chunks);
        let pending_w = Arc::clone(&pending_chunks);
        let is_parakeet_v3_w = is_parakeet_v3;
        let counters_worker = Arc::clone(&quality_counters);
        let final_recovery_worker = Arc::clone(&final_recovery_candidate);
        let ah_w = app.clone();
        let operation_id_w = operation_id;
        let selected_language_w = settings.selected_language.clone();
        let worker_handle = std::thread::spawn(move || {
            let chunk_app_context = if get_settings(&ah_w).app_context_enabled {
                ah_w.try_state::<ActiveAppContextState>().and_then(|state| {
                    state
                        .0
                        .lock()
                        .ok()
                        .and_then(|snapshot| snapshot.active_context_for_binding(&binding_id))
                })
            } else {
                None
            };
            info!("[worker] started");
            // Tail of the last successfully transcribed chunk's audio.
            // Used to prepend context when re-running inference on a short
            // chunk that looks like a language switch.
            let mut prev_chunk_tail: Vec<f32> = Vec::new();
            while let Ok(message) = chunk_rx.recv() {
                // ESC was pressed — discard remaining queued chunks immediately.
                if cancel_flag_worker.load(std::sync::atomic::Ordering::Relaxed) {
                    info!("[worker] cancel_flag set — exiting");
                    break;
                }
                let Some((audio, idx, overlap_cutoff_secs, is_final_chunk)) = message else {
                    info!("[worker] received None sentinel — exiting");
                    break;
                };
                info!(
                    "[worker] processing chunk idx={} samples={}",
                    idx,
                    audio.len()
                );

                let chunk_samples = audio.len();
                // Keep a copy for overlap-retry and language-context retry.
                let audio_for_retry = if is_parakeet_v3_w {
                    Some(audio.clone())
                } else {
                    None
                };
                let chunk_start_time = std::time::Instant::now();
                match tm_s.transcribe_detailed_request(TranscriptionRequest {
                    audio,
                    app_context: chunk_app_context.clone(),
                }) {
                    Ok(output) => {
                        let latency_ms = chunk_start_time.elapsed().as_millis() as u64;
                        tel_worker.log_chunk_text_stage(
                            session_id,
                            idx,
                            "raw_engine_output",
                            &output.text,
                        );
                        // Timestamp-based overlap trimming — Parakeet V3 only.
                        // Parakeet V3 TDT outputs per-word timestamps that are reliable
                        // enough to use as the sole deduplication mechanism.
                        // For other engines (Whisper, Moonshine…) their segments carry
                        // sentence-level or zero timestamps that would incorrectly drop
                        // the whole chunk; rely on deduplicate_boundary instead.
                        let mut used_word_timestamps = false;
                        let text = if is_parakeet_v3_w && overlap_cutoff_secs > 0.0 {
                            if let Some(segs) = &output.segments {
                                used_word_timestamps = true;
                                // Words mode succeeded: filter out every word that lies
                                // entirely within the overlap prefix.
                                let words_in = segs.len();
                                let mut trimmed_out = String::new();
                                let mut trimmed_words_out = 0usize;
                                for seg in segs.iter().filter(|s| s.start >= overlap_cutoff_secs) {
                                    let is_punct = seg.text.len() == 1
                                        && seg.text.chars().all(|c| {
                                            matches!(c, '.' | ',' | '!' | '?' | ';' | ':' | ')')
                                        });
                                    if !trimmed_out.is_empty() && !is_punct {
                                        trimmed_out.push(' ');
                                    }
                                    trimmed_out.push_str(&seg.text);
                                    trimmed_words_out += 1;
                                }
                                // If only stray punctuation survived the trim (e.g. ".")
                                // discard it — it's a dangling mark from a word that
                                // was in the overlap zone and got cut.
                                let trimmed_out = if !trimmed_out.is_empty()
                                    && trimmed_out.chars().all(|c| !c.is_alphabetic())
                                {
                                    String::new()
                                } else {
                                    trimmed_out
                                };
                                let mut out = trimmed_out.clone();
                                let mut words_out = trimmed_words_out;

                                // Two fallback triggers:
                                // 1. Coarse/empty timestamps: words_in is 0 or 1 while raw
                                //    has much more content → timestamps not reliable at all.
                                // 2. Punct-guard wipe: all surviving segments were punctuation
                                //    so the guard set `out = ""` even though `trimmed_words_out`
                                //    was > 0 (e.g. 2 commas survived the cutoff).  The standard
                                //    `words_out == 0` check misses this because it looks at
                                //    `trimmed_words_out`, not the actual output string.
                                // In both cases: fall back to the full raw text and let
                                // `deduplicate_boundary` in assembly handle boundary dedup —
                                // that is the text-based overlap matching, zero extra inference.
                                let fallback_reason: Option<&'static str> =
                                    if should_fallback_from_timestamp_trim(
                                        &output.text,
                                        words_in,
                                        trimmed_words_out,
                                    ) {
                                        Some("coarse_or_empty_word_timestamps")
                                    } else if out.is_empty()
                                        && !output.text.trim().is_empty()
                                        && output.text.split_whitespace().count() >= 3
                                    {
                                        Some("punct_guard_wiped_all_survivors")
                                    } else if is_timestamp_cluster_compressed(
                                        segs,
                                        words_in,
                                        chunk_samples,
                                    ) {
                                        Some("compressed_timestamps_cluster")
                                    } else {
                                        None
                                    };
                                if let Some(reason) = fallback_reason {
                                    tel_worker.log_chunk_retry(
                                        session_id,
                                        idx,
                                        "timestamp_trim_fallback_full",
                                        reason,
                                        output.text.len(),
                                        output.text.len(),
                                        true,
                                    );
                                    out = output.text.clone();
                                    words_out = out.split_whitespace().count();
                                    if let Ok(mut counters) = counters_worker.lock() {
                                        counters.retry_chunks += 1;
                                    }
                                }
                                tel_worker.log_chunk_result(
                                    session_id,
                                    idx,
                                    latency_ms,
                                    chunk_samples,
                                    overlap_cutoff_secs,
                                    words_in,
                                    words_out,
                                    words_in.saturating_sub(words_out),
                                    &out.chars().take(120).collect::<String>(),
                                );
                                tel_worker.log_text_transform(
                                    session_id,
                                    &format!("chunk_{idx}_overlap_trim"),
                                    &output.text,
                                    &out,
                                );
                                tel_worker.log_chunk_text_stage(
                                    session_id,
                                    idx,
                                    "after_overlap_trim",
                                    &out,
                                );
                                // Empty → the chunk contained only overlap audio.
                                out
                            } else {
                                // Words mode fell back to Sentences (no per-word timestamps).
                                // If output.text is empty, retry without the overlap prefix —
                                // Parakeet sometimes fails to transcribe chunks whose audio
                                // starts mid-sentence (the overlap zone). Stripping the overlap
                                // gives it clean audio from the actual new content onward.
                                let retry_text = if output.text.is_empty() {
                                    if let Some(ref orig) = audio_for_retry {
                                        let skip = (overlap_cutoff_secs * 16_000.0) as usize;
                                        let non_overlap = orig[skip.min(orig.len())..].to_vec();
                                        if non_overlap.len() >= 8_000 {
                                            tel_worker.log_chunk_retry(
                                                session_id,
                                                idx,
                                                "without_overlap",
                                                "empty_output_after_overlap_path",
                                                orig.len(),
                                                non_overlap.len(),
                                                true,
                                            );
                                            if let Ok(mut counters) = counters_worker.lock() {
                                                counters.retry_chunks += 1;
                                            }
                                            tm_s.transcribe_detailed_request(TranscriptionRequest {
                                                audio: non_overlap,
                                                app_context: chunk_app_context.clone(),
                                            })
                                            .map(|o| o.text)
                                            .unwrap_or_default()
                                        } else {
                                            String::new()
                                        }
                                    } else {
                                        String::new()
                                    }
                                } else {
                                    output.text
                                };
                                let words = retry_text.split_whitespace().count();
                                tel_worker.log_chunk_result(
                                    session_id,
                                    idx,
                                    latency_ms,
                                    chunk_samples,
                                    overlap_cutoff_secs,
                                    words,
                                    words,
                                    0,
                                    &format!(
                                        "(no-word-timestamps-fallback-full) {}",
                                        &retry_text.chars().take(100).collect::<String>()
                                    ),
                                );
                                tel_worker.log_chunk_text_stage(
                                    session_id,
                                    idx,
                                    "fallback_full_chunk_text",
                                    &retry_text,
                                );
                                retry_text
                            }
                        } else {
                            // First chunk (cutoff = 0.0) or non-Parakeet engine:
                            // return verbatim — deduplicate_boundary handles assembly.
                            let words = output.text.split_whitespace().count();
                            tel_worker.log_chunk_result(
                                session_id,
                                idx,
                                latency_ms,
                                chunk_samples,
                                overlap_cutoff_secs,
                                words,
                                words,
                                0,
                                &output.text.chars().take(120).collect::<String>(),
                            );
                            tel_worker.log_chunk_text_stage(
                                session_id,
                                idx,
                                "unchanged_chunk_text",
                                &output.text,
                            );
                            output.text
                        };
                        // Language-context retry: two triggers —
                        // 1. Short chunk (≤3 s) with no target-language accent chars →
                        //    `is_likely_language_switched_short_chunk` (fast, no whichlang).
                        // 2. Any chunk where whichlang detects the output as a different
                        //    language than the session → `has_language_drift`.  Covers
                        //    long chunks where the overlap from English content (e.g. book
                        //    titles) pushed the model into English mode mid-session.
                        // In both cases: prepend 2 s of the previous chunk's French/Spanish/…
                        // audio so the model has enough context to stay in the right language.
                        let lang_ctx_retry_reason: Option<&'static str> =
                            if is_parakeet_v3_w && !is_final_chunk && !prev_chunk_tail.is_empty() {
                                if is_likely_language_switched_short_chunk(
                                &text,
                                &selected_language_w,
                                chunk_samples,
                            ) {
                                Some("language_context")
                            } else if crate::managers::transcription::inference::has_language_drift(
                                &text,
                                &selected_language_w,
                            ) {
                                Some("language_context_drift")
                            } else {
                                None
                            }
                            } else {
                                None
                            };
                        let text = if let Some(retry_reason) = lang_ctx_retry_reason {
                            if let Some(ref orig_audio) = audio_for_retry {
                                let context_samples = prev_chunk_tail.len().min(2 * 16_000);
                                let tail_start = prev_chunk_tail.len() - context_samples;
                                let mut extended: Vec<f32> =
                                    Vec::with_capacity(context_samples + orig_audio.len());
                                extended.extend_from_slice(&prev_chunk_tail[tail_start..]);
                                extended.extend_from_slice(orig_audio);
                                let extended_len = extended.len();
                                let context_cutoff_secs = context_samples as f32 / 16_000.0;
                                match tm_s.transcribe_detailed_request(TranscriptionRequest {
                                    audio: extended,
                                    app_context: chunk_app_context.clone(),
                                }) {
                                    Ok(retry_out) => {
                                        let retry_text = if let Some(segs) = &retry_out.segments {
                                            let mut out = String::new();
                                            for seg in segs
                                                .iter()
                                                .filter(|s| s.start >= context_cutoff_secs)
                                            {
                                                let is_punct = seg.text.len() == 1
                                                    && seg.text.chars().all(|c| {
                                                        matches!(
                                                            c,
                                                            '.' | ',' | '!' | '?' | ';' | ':' | ')'
                                                        )
                                                    });
                                                if !out.is_empty() && !is_punct {
                                                    out.push(' ');
                                                }
                                                out.push_str(&seg.text);
                                            }
                                            out
                                        } else {
                                            retry_out.text
                                        };
                                        // For drift-triggered retries: only accept the
                                        // result if the new output doesn't still drift.
                                        // For short-chunk retries: accept any non-empty change.
                                        let still_drifts = retry_reason
                                            == "language_context_drift"
                                            && crate::managers::transcription::inference::has_language_drift(
                                                &retry_text,
                                                &selected_language_w,
                                            );
                                        let improved = !retry_text.is_empty()
                                            && retry_text != text
                                            && !still_drifts;
                                        tel_worker.log_chunk_retry(
                                            session_id,
                                            idx,
                                            retry_reason,
                                            if improved {
                                                "language_context_improved"
                                            } else if still_drifts {
                                                "language_context_still_drifts"
                                            } else {
                                                "language_context_no_change"
                                            },
                                            orig_audio.len(),
                                            extended_len,
                                            improved,
                                        );
                                        if let Ok(mut counters) = counters_worker.lock() {
                                            counters.retry_chunks += 1;
                                        }
                                        if improved {
                                            tel_worker.log_chunk_text_stage(
                                                session_id,
                                                idx,
                                                "after_language_context_retry",
                                                &retry_text,
                                            );
                                            retry_text
                                        } else if still_drifts {
                                            // Retry also drifted → emit empty rather
                                            // than outputting garbage English.
                                            tel_worker.log_chunk_text_stage(
                                                session_id,
                                                idx,
                                                "drift_retry_failed_dropped",
                                                &retry_text,
                                            );
                                            String::new()
                                        } else {
                                            text
                                        }
                                    }
                                    Err(_) => text,
                                }
                            } else {
                                text
                            }
                        } else {
                            text
                        };

                        // Update the tail for the next chunk's potential retry.
                        if let Some(ref orig_audio) = audio_for_retry {
                            let tail_samples = (2 * 16_000).min(orig_audio.len());
                            prev_chunk_tail =
                                orig_audio[orig_audio.len() - tail_samples..].to_vec();
                        }

                        // Hallucination filter: Parakeet invents English filler words
                        // (e.g. "So", "Yeah.", "Leave.") when a short chunk contains
                        // mostly silence. Discard single-word results from chunks that
                        // are too short to reliably contain real speech.
                        let pre_filter_text = text.clone();
                        let word_count = text.split_whitespace().count();
                        // Known English filler words Parakeet hallucinates on near-silence.
                        const HALLUCINATION_BLOCKLIST: &[&str] = &[
                            "yeah", "but", "so", "we", "leave", "thanks", "hey", "hi", "bye",
                            "the", "this", "that", "sure", "right", "okay", "ok", "mm", "uh",
                            "hmm", "mhm", "hm", "and", "et", "mais", "donc", "alors",
                        ];
                        let bare = text
                            .trim()
                            .trim_end_matches('.')
                            .trim_end_matches(',')
                            .to_lowercase();
                        let is_known_hallucination =
                            HALLUCINATION_BLOCKLIST.contains(&bare.as_str());
                        // Two discard conditions:
                        // 1. Background chunk (not final): single word, short, idx>0 or blocklisted.
                        // 2. Final chunk: single word, blocklisted, short, and session already has
                        //    prior content (idx > 0) — catches trailing hallucinations like "Yeah."
                        //    on the silence after the user releases the key.
                        let is_trailing_hallucination = is_parakeet_v3_w
                            && word_count <= 1
                            && !text.is_empty()
                            && is_final_chunk
                            && is_known_hallucination
                            && idx > 0
                            && chunk_samples < PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD;
                        let is_background_hallucination = is_parakeet_v3_w
                            && word_count <= 1
                            && !text.is_empty()
                            && !is_final_chunk
                            && chunk_samples < PARAKEET_MIN_SAMPLES_FOR_SINGLE_WORD
                            && (idx > 0 || is_known_hallucination);
                        let text = if is_trailing_hallucination || is_background_hallucination {
                            tel_worker.log_chunk_filtered(
                                session_id,
                                idx,
                                "hallucination_blocklist",
                                &preview_text(&text, 120),
                                word_count,
                                chunk_samples,
                                is_final_chunk,
                                if is_trailing_hallucination {
                                    "single_word_short_final_chunk_blocklisted"
                                } else {
                                    "single_word_short_background_chunk_blocklisted"
                                },
                            );
                            debug!(
                                "Chunk {}: discarding likely hallucination (words={}, samples={}, final={})",
                                idx, word_count, chunk_samples, is_final_chunk
                            );
                            String::new()
                        } else {
                            text
                        };

                        if is_parakeet_v3_w
                            && is_final_chunk
                            && text.trim().is_empty()
                            && is_viable_final_recovery_candidate(&pre_filter_text)
                            && !is_trailing_hallucination
                        {
                            *final_recovery_worker
                                .lock()
                                .unwrap_or_else(|e| e.into_inner()) = Some((idx, pre_filter_text));
                        }

                        if is_parakeet_v3_w {
                            if let Ok(mut counters) = counters_worker.lock() {
                                counters.total_chunks += 1;
                                let text_words = text.split_whitespace().count();
                                counters.output_words += text_words;
                                if is_final_chunk {
                                    counters.final_chunk_words = text_words;
                                    counters.final_chunk_samples = chunk_samples;
                                }
                                counters.trimmed_words_total += if used_word_timestamps {
                                    word_count.saturating_sub(text_words)
                                } else {
                                    0
                                };
                                if text.trim().is_empty() {
                                    counters.empty_chunks += 1;
                                    if !is_final_chunk {
                                        counters.empty_nonfinal_chunks += 1;
                                    }
                                }
                                if !used_word_timestamps {
                                    counters.chunks_without_word_timestamps += 1;
                                }
                                if is_trailing_hallucination || is_background_hallucination {
                                    counters.filtered_chunks += 1;
                                }
                            }
                        }

                        let live_preview = {
                            let mut guard = results_w.lock().unwrap_or_else(|e| e.into_inner());
                            guard.push((idx, text));
                            build_live_preview(&guard, 240)
                        };
                        if !live_preview.is_empty() {
                            emit_transcription_preview(
                                &ah_w,
                                operation_id_w,
                                "recording",
                                &live_preview,
                                true,
                            );
                        }
                    }
                    Err(err) => {
                        failed_chunks_w.fetch_add(1, Ordering::Relaxed);
                        tel_worker.log_chunk_error(session_id, idx, &err.to_string());
                        warn!("Chunk transcription failed for chunk {}: {}", idx, err);
                    }
                }
                pending_w.fetch_sub(1, Ordering::Relaxed);
            }
            info!("[worker] thread exited cleanly");
        });

        if let Some(ch) = app.try_state::<ActiveChunkingHandle>() {
            // Also store a clone of the cancel_flag in a separate state so
            // cancel_current_operation can still reach it after the handle
            // is taken by stop_transcription_action.
            if let Some(flag_state) =
                app.try_state::<crate::runtime::chunking::ActiveWorkerCancelFlag>()
            {
                *flag_state.0.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(Arc::clone(&cancel_flag));
            }
            *ch.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(ChunkingHandle {
                sampler_handle,
                worker_handle,
                chunk_tx,
                shared_state,
                results,
                pending_chunks,
                failed_chunks,
                parakeet_counters: Arc::clone(&quality_counters),
                final_recovery_candidate: Arc::clone(&final_recovery_candidate),
                chunk_overlap_samples: chunking_profile.overlap_samples,
                is_parakeet_v3,
                session_id,
                tel,
            });
        }
    } else if let Some(info) = current_model_info {
        debug!(
            "Skipping background chunking for model '{}' ({}) to preserve full-context transcription",
            info.name,
            info.id
        );
    }

    debug!(
        "TranscribeAction::start completed in {:?}",
        start_time.elapsed()
    );
}

pub(crate) fn stop_transcription_action(app: &AppHandle, binding_id: &str, post_process: bool) {
    crate::shortcut::handler::reset_cancel_confirmation();
    shortcut::unregister_cancel_shortcut(app);
    shortcut::unregister_pause_shortcut(app);
    shortcut::unregister_action_shortcuts(app);

    let stop_time = Instant::now();
    info!("stop_transcription_action called binding={}", binding_id);

    let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() else {
        error!("TranscriptionCoordinator not initialized");
        return;
    };
    let Some(operation_id) = coordinator.active_operation_id() else {
        debug!(
            "Ignoring stop for '{}' without active operation",
            binding_id
        );
        return;
    };
    if coordinator.active_binding_id().as_deref() != Some(binding_id) {
        warn!(
            "stop_transcription_action: binding_id mismatch — received='{}' active={:?}; stop signal dropped (diagnostic)",
            binding_id,
            coordinator.active_binding_id()
        );
        return;
    }
    let _ = coordinator.mark_stopping(app, operation_id);

    let ah = app.clone();
    let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
    let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
    let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());
    let is_basic_plan = crate::license::current_plan(app).as_deref() == Some("basic");
    rm.remove_mute();

    let binding_id = binding_id.to_string();
    let active_app_context = if get_settings(app).app_context_enabled {
        if let Some(state) = app.try_state::<ActiveAppContextState>() {
            if let Ok(snapshot) = state.0.lock() {
                snapshot.active_context_for_binding(&binding_id)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let selected_action_key = coordinator.selected_action(operation_id);
    let settings = get_settings(app);
    let auto_pause_media = settings.auto_pause_media;

    let llm_auto_mode = settings.llm_auto_mode;

    let chunking_handle = app
        .try_state::<ActiveChunkingHandle>()
        .and_then(|s| match s.0.lock() {
            Ok(mut guard) => guard.take(),
            Err(poisoned) => {
                error!("ActiveChunkingHandle mutex poisoned, recovering");
                poisoned.into_inner().take()
            }
        });

    tauri::async_runtime::spawn(async move {
        let _guard = FinishGuard {
            app: ah.clone(),
            binding_id: binding_id.clone(),
            operation_id,
        };
        let profiler = Arc::new(Mutex::new(PipelineProfiler::new(
            binding_id.clone(),
            if chunking_handle.is_some() {
                "chunked"
            } else {
                "single-shot"
            },
            tm.get_current_model(),
            tm.get_current_model_name(),
        )));
        debug!(
            "Starting async transcription task for binding: {}, action: {:?}",
            binding_id, selected_action_key
        );

        let stop_recording_time = Instant::now();
        let result: Option<TranscriptionResult> = if let Some(ch) = chunking_handle {
            let all_samples = match rm.stop_recording(&binding_id) {
                Some(s) => s,
                None => {
                    let reason = format!(
                        "No samples returned when stopping recording for binding '{}' (chunked path)",
                        binding_id
                    );
                    warn!("{}", reason);
                    emit_runtime_error_with_context(
                        &ah,
                        "CAPTURE_NO_SAMPLES",
                        RuntimeErrorStage::Capture,
                        reason,
                        true,
                        Some(operation_id),
                        get_settings(&ah).selected_microphone.clone(),
                        tm.get_current_model(),
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.mark_error("CAPTURE_NO_SAMPLES");
                        p.push_step_since(
                            "stop_recording",
                            stop_recording_time,
                            Some("chunked-path".to_string()),
                        );
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                        let _ = c.fail_operation(&ah, operation_id, "capture-no-samples");
                    }
                    return;
                }
            };
            play_feedback_sound(&ah, SoundType::Stop);
            if auto_pause_media {
                crate::platform::media_control::resume_media();
            }
            if let Ok(mut p) = profiler.lock() {
                p.set_audio_duration_samples(all_samples.len());
                p.push_step_since(
                    "stop_recording",
                    stop_recording_time,
                    Some("chunked-path".to_string()),
                );
            }
            debug!(
                "Recording stopped in {:?}, {} samples total",
                stop_recording_time.elapsed(),
                all_samples.len()
            );
            if !is_operation_active(&ah, operation_id) {
                return;
            }
            if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                let _ = c.mark_transcribing(&ah, operation_id);
            }
            change_tray_icon(&ah, TrayIconState::Transcribing);
            show_transcribing_overlay(&ah);

            let chunk_finalize_started = Instant::now();
            let tel_assembly = Arc::clone(&ch.tel);
            let tel_quality = Arc::clone(&ch.tel);
            let session_id = ch.session_id;
            let (mut assembled, chunk_count, failed_chunk_count, all_samples, mut parakeet_summary) =
                tokio::task::spawn_blocking(move || {
                    let _ = ch.sampler_handle.join();

                    let (last_committed, next_idx) = {
                        let s = ch.shared_state.lock().unwrap_or_else(|e| e.into_inner());
                        (s.last_committed_idx, s.next_chunk_idx)
                    };

                    // For Parakeet V3: send only the truly new audio (from last_committed
                    // onward, no overlap prefix). The overlap zone is already covered by
                    // the last background chunk via timestamp-based trimming, so including
                    // it again would force another timestamp filter — or, if Words mode fell
                    // back to Sentences, risk a non-deterministic duplicate.
                    // For every other engine: keep the overlap so deduplicate_boundary has
                    // enough context to find the boundary.
                    let (remaining, final_cutoff_secs) = if ch.is_parakeet_v3 {
                        (all_samples[last_committed..].to_vec(), 0.0_f32)
                    } else {
                        let actual_overlap = last_committed.min(ch.chunk_overlap_samples);
                        let overlap_start = last_committed - actual_overlap;
                        (
                            all_samples[overlap_start..].to_vec(),
                            actual_overlap as f32 / 16_000.0,
                        )
                    };
                    // Skip the final chunk if it's mostly silence tail (< 0.5 s).
                    // After the user stops speaking the remaining audio is near-silent;
                    // sending it causes Parakeet to hallucinate English filler words.
                    let sent_final = remaining.len() >= MIN_FINAL_CHUNK_SAMPLES;
                    if sent_final {
                        let final_signal = summarize_audio_signal(&remaining);
                        tel_assembly.log_chunk_sent(
                            session_id,
                            next_idx,
                            "final",
                            remaining.len(),
                            all_samples.len(),
                            -1.0,
                            final_signal.rms,
                            final_signal.peak,
                            (final_cutoff_secs * 16_000.0) as usize,
                            final_cutoff_secs,
                        );
                        ch.pending_chunks.fetch_add(1, Ordering::Relaxed);
                        if ch
                            .chunk_tx
                            .send(Some((remaining, next_idx, final_cutoff_secs, true)))
                            .is_err()
                        {
                            ch.pending_chunks.fetch_sub(1, Ordering::Relaxed);
                        }
                    }
                    let _ = ch.chunk_tx.send(None);

                    let _ = ch.worker_handle.join();

                    let mut results = ch.results.lock().unwrap_or_else(|e| e.into_inner());
                    results.sort_by_key(|r| r.0);

                    let chunk_count = results.len();
                    let failed_chunk_count = ch.failed_chunks.load(Ordering::Relaxed);
                    let mut assembled = if results.is_empty() {
                        String::new()
                    } else if results.len() == 1 {
                        results[0].1.clone()
                    } else if ch.is_parakeet_v3 {
                        // Parakeet V3: chunks are already perfectly stitched.
                        // Background chunks are trimmed by word-level timestamp filter;
                        // the final chunk starts exactly at last_committed with no overlap.
                        // deduplicate_boundary must NOT run here — it creates false positives
                        // when a word that legitimately starts the final chunk also happened
                        // to appear at the end of the previous chunk (e.g. "avait … avait
                        // 47 personnes"), silently dropping real words.
                        //
                        // Capitalisation fix: Parakeet capitalises the first word of every
                        // chunk because it treats "start of audio = start of sentence".
                        // When joining, lowercase that first letter unless the previous
                        // chunk actually ended a sentence (.  !  ?  …).
                        let non_empty: Vec<&str> = results
                            .iter()
                            .map(|(_, t)| t.as_str())
                            .filter(|t| !t.is_empty())
                            .collect();
                        let mut out = String::new();
                        for (i, chunk) in non_empty.iter().enumerate() {
                            if i == 0 {
                                // Capitalize the first word of the assembled text — Parakeet
                                // sometimes returns a lowercase start when it treats the audio
                                // as a continuation. The assembled result is always sentence-start.
                                let mut chars = chunk.chars();
                                if let Some(first) = chars.next() {
                                    for uc in first.to_uppercase() {
                                        out.push(uc);
                                    }
                                    out.push_str(chars.as_str());
                                }
                            } else {
                                // Apply a light dedup pass (max 3 words) to catch residual
                                // duplicates from fallback-full chunks that lacked per-word
                                // timestamps. Word-level trimmed chunks rarely need this, but
                                // the small window avoids false positives.
                                let deduped = deduplicate_boundary_n(&out, chunk, 3);
                                let original_words = chunk.split_whitespace().count();
                                let deduped_words = deduped.split_whitespace().count();
                                if original_words > deduped_words {
                                    tel_assembly.log_assembly_event(
                                        session_id,
                                        "deduplicate_boundary",
                                        i - 1,
                                        i,
                                        original_words - deduped_words,
                                        "boundary_overlap_detected",
                                    );
                                }
                                let chunk_to_join = if deduped.is_empty() {
                                    // whole chunk was duplicate — skip
                                    continue;
                                } else {
                                    deduped
                                };
                                // Check BEFORE pushing the space — otherwise last() returns ' '.
                                // Only treat '!' / '?' / '…' as reliable sentence endings.
                                // Parakeet appends '.' to every chunk (even mid-sentence VAD
                                // splits), so using '.' here causes false capitalisation like
                                // "Tu es. Le meilleur." when the user said one sentence.
                                let prev_ends_sentence =
                                    crate::parakeet_text::parakeet_chunk_ends_sentence(
                                        &out,
                                        &chunk_to_join,
                                    );
                                out.push(' ');
                                let mut chars = chunk_to_join.chars();
                                if let Some(first) = chars.next() {
                                    if prev_ends_sentence {
                                        for uc in first.to_uppercase() {
                                            out.push(uc);
                                        }
                                    } else {
                                        for lc in first.to_lowercase() {
                                            out.push(lc);
                                        }
                                    }
                                    out.push_str(chars.as_str());
                                }
                            }
                        }
                        out
                    } else {
                        let mut parts = vec![results[0].1.clone()];
                        for i in 1..results.len() {
                            let d = deduplicate_boundary(&results[i - 1].1, &results[i].1);
                            if !d.is_empty() {
                                parts.push(d);
                            }
                        }
                        parts.join(" ")
                    };

                    if ch.is_parakeet_v3 {
                        let recovery_candidate = ch
                            .final_recovery_candidate
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        if let Some((recovery_idx, recovery_text)) = recovery_candidate {
                            let recovered =
                                append_recovered_final_chunk(&assembled, &recovery_text);
                            if recovered != assembled {
                                tel_assembly.log_finalization_recovery(
                                    session_id,
                                    recovery_idx,
                                    "promote_final_chunk_candidate",
                                    recovery_text.split_whitespace().count(),
                                    &preview_text(&recovery_text, 120),
                                );
                                if let Ok(mut counters) = ch.parakeet_counters.lock() {
                                    counters.finalization_recoveries += 1;
                                    counters.output_words = recovered.split_whitespace().count();
                                }
                                assembled = recovered;
                            }
                        }
                    }

                    tel_assembly.log_session_text_stage(session_id, "assembled_chunks", &assembled);

                    tel_assembly.log_session_end(
                        session_id,
                        chunk_count,
                        failed_chunk_count,
                        all_samples.len(),
                        assembled.split_whitespace().count(),
                        &assembled.chars().take(200).collect::<String>(),
                    );

                    let parakeet_summary = if ch.is_parakeet_v3 {
                        let mut summary = ch
                            .parakeet_counters
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        summary.output_words = assembled.split_whitespace().count();
                        Some(summary)
                    } else {
                        None
                    };

                    (
                        assembled,
                        chunk_count,
                        failed_chunk_count,
                        all_samples,
                        parakeet_summary,
                    )
                })
                .await
                .unwrap_or_else(|_| (String::new(), 0, 0, Vec::new(), None));
            if is_operation_active(&ah, operation_id) {
                if let Some(summary) = parakeet_summary.as_mut() {
                    if should_attempt_full_audio_recovery(summary, all_samples.len(), &assembled) {
                        let recovery_started = Instant::now();
                        // Add 0.25s of silence so the model can cleanly decode the last word
                        let mut recovery_audio = all_samples.clone();
                        recovery_audio.extend(std::iter::repeat(0.0f32).take(4_000));
                        match tm.transcribe_detailed_request(TranscriptionRequest {
                            audio: recovery_audio,
                            app_context: active_app_context.clone(),
                        }) {
                            Ok(recovery_output)
                                if should_promote_full_audio_recovery(
                                    &assembled,
                                    &recovery_output.text,
                                    all_samples.len(),
                                ) =>
                            {
                                let before_recovery = assembled.clone();
                                info!(
                                    "Promoting Parakeet full-audio recovery after empty chunk: {} -> {} words",
                                    assembled.split_whitespace().count(),
                                    recovery_output.text.split_whitespace().count()
                                );
                                summary.finalization_recoveries += 1;
                                summary.output_words =
                                    recovery_output.text.split_whitespace().count();
                                assembled = recovery_output.text;
                                tel_quality.log_text_transform(
                                    session_id,
                                    "full_audio_recovery",
                                    &before_recovery,
                                    &assembled,
                                );
                                tel_quality.log_session_text_stage(
                                    session_id,
                                    "after_full_audio_recovery",
                                    &assembled,
                                );
                                if let Ok(mut p) = profiler.lock() {
                                    p.push_step_since(
                                        "parakeet_full_audio_recovery",
                                        recovery_started,
                                        Some("promoted".to_string()),
                                    );
                                }
                            }
                            Ok(_) => {
                                if let Ok(mut p) = profiler.lock() {
                                    p.push_step_since(
                                        "parakeet_full_audio_recovery",
                                        recovery_started,
                                        Some("rejected".to_string()),
                                    );
                                }
                            }
                            Err(err) => {
                                warn!("Parakeet full-audio recovery failed: {}", err);
                                if let Ok(mut p) = profiler.lock() {
                                    p.push_step_since(
                                        "parakeet_full_audio_recovery",
                                        recovery_started,
                                        Some("failed".to_string()),
                                    );
                                }
                            }
                        }
                    }
                }
            }
            if let Ok(mut p) = profiler.lock() {
                p.push_step_since(
                    "chunk_finalize_and_assemble",
                    chunk_finalize_started,
                    Some(format!(
                        "chunks={} failed_chunks={}",
                        chunk_count, failed_chunk_count
                    )),
                );
            }
            let _is_parakeet_chunked = parakeet_summary.is_some();
            if let Some(summary) = parakeet_summary {
                if let Some(state) = ah.try_state::<ParakeetDiagnosticsState>() {
                    if let Some(snapshot) =
                        state.finish_session(session_id, summary, all_samples.len(), &assembled)
                    {
                        tel_quality.log_session_quality_summary(&snapshot);
                    }
                }
            }
            if !is_operation_active(&ah, operation_id) {
                return;
            }

            debug!(
                "Chunked assembly done: {} chunks, chars={}, words={}",
                chunk_count,
                assembled.chars().count(),
                assembled.split_whitespace().count()
            );

            let transcription = assembled;
            emit_transcription_preview(&ah, operation_id, "processing", &transcription, true);

            Some(TranscriptionResult {
                session_id,
                samples: all_samples,
                transcription,
                confidence_payload: None,
                chunk_count,
                status: if failed_chunk_count > 0 {
                    TranscriptionStatus::Partial
                } else if chunk_count == 0 {
                    TranscriptionStatus::NoSpeech
                } else {
                    TranscriptionStatus::Success
                },
                failed_chunk_count,
            })
        } else {
            let samples = match rm.stop_recording(&binding_id) {
                Some(s) => s,
                None => {
                    let reason = format!(
                        "No samples returned when stopping recording for binding '{}'",
                        binding_id
                    );
                    warn!("{}", reason);
                    emit_runtime_error_with_context(
                        &ah,
                        "CAPTURE_NO_SAMPLES",
                        RuntimeErrorStage::Capture,
                        reason,
                        true,
                        Some(operation_id),
                        get_settings(&ah).selected_microphone.clone(),
                        tm.get_current_model(),
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.mark_error("CAPTURE_NO_SAMPLES");
                        p.push_step_since(
                            "stop_recording",
                            stop_recording_time,
                            Some("single-shot-path".to_string()),
                        );
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                        let _ = c.fail_operation(&ah, operation_id, "capture-no-samples");
                    }
                    return;
                }
            };
            play_feedback_sound(&ah, SoundType::Stop);
            if auto_pause_media {
                crate::platform::media_control::resume_media();
            }
            if let Ok(mut p) = profiler.lock() {
                p.set_audio_duration_samples(samples.len());
                p.push_step_since(
                    "stop_recording",
                    stop_recording_time,
                    Some("single-shot-path".to_string()),
                );
            }
            debug!(
                "Recording stopped in {:?}, {} samples",
                stop_recording_time.elapsed(),
                samples.len()
            );
            if !is_operation_active(&ah, operation_id) {
                return;
            }
            if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                let _ = c.mark_transcribing(&ah, operation_id);
            }
            change_tray_icon(&ah, TrayIconState::Transcribing);
            show_transcribing_overlay(&ah);

            let duration_seconds = samples.len() as f32 / 16_000.0;
            let settings_for_model = get_settings(&ah);
            let original_model = tm.get_current_model();
            let mut switched_model = false;
            let model_manager = ah.state::<Arc<ModelManager>>();
            let selected_model_info = original_model
                .as_deref()
                .and_then(|model_id| model_manager.get_model_info(model_id));

            if let Some((fallback_model, reason)) = resolve_runtime_model_override(
                selected_model_info.as_ref(),
                &model_manager,
                &settings_for_model,
            ) {
                if original_model.as_deref() != Some(fallback_model.id.as_str()) {
                    let model_switch_started = Instant::now();
                    info!(
                        "{}. Temporarily switching from Parakeet V3 to '{}' ({})",
                        reason, fallback_model.name, fallback_model.id
                    );
                    if let Err(err) = tm.load_model(&fallback_model.id) {
                        warn!(
                            "Failed to load fallback model '{}' after Parakeet V3 compatibility check: {}",
                            fallback_model.id,
                            err
                        );
                    } else {
                        switched_model = true;
                        if let Ok(mut p) = profiler.lock() {
                            p.set_model(
                                Some(fallback_model.id.clone()),
                                Some(fallback_model.name.clone()),
                            );
                            p.push_step_since(
                                "model_switch_runtime_override",
                                model_switch_started,
                                Some(reason),
                            );
                        }
                    }
                }
            } else if let Some(info) = selected_model_info.as_ref() {
                if is_parakeet_v3_model_id(&info.id)
                    && settings_for_model.selected_language != "auto"
                    && !model_supports_selected_language(info, &settings_for_model)
                {
                    warn!(
                        "Parakeet V3 is being used with unsupported language '{}', and no downloaded fallback model was available.",
                        settings_for_model.selected_language
                    );
                }
            }

            if should_switch_to_long_audio_model(
                duration_seconds,
                settings_for_model.long_audio_threshold_seconds,
                original_model.as_deref(),
                settings_for_model.long_audio_model.as_deref(),
            ) {
                if let Some(ref long_model_id) = settings_for_model.long_audio_model {
                    let long_model_switch_started = Instant::now();
                    debug!(
                        "Audio {:.1}s > threshold {:.1}s, switching to long model: {}",
                        duration_seconds,
                        settings_for_model.long_audio_threshold_seconds,
                        long_model_id
                    );
                    if let Err(e) = tm.load_model(long_model_id) {
                        warn!("Failed to load long audio model: {}", e);
                    } else {
                        switched_model = true;
                        if let Ok(mut p) = profiler.lock() {
                            p.set_model(Some(long_model_id.clone()), tm.get_current_model_name());
                            p.push_step_since(
                                "model_switch_long_audio",
                                long_model_switch_started,
                                Some(format!(
                                    "{:.1}s>{:.1}s",
                                    duration_seconds,
                                    settings_for_model.long_audio_threshold_seconds
                                )),
                            );
                        }
                    }
                }
            }

            let transcription_time = Instant::now();
            let samples_clone_fb = samples.clone();
            let transcription_output = match tm.transcribe_detailed_request(TranscriptionRequest {
                audio: samples.clone(),
                app_context: active_app_context.clone(),
            }) {
                Ok(mut output) => {
                    if let Ok(mut p) = profiler.lock() {
                        for step in output.timings.drain(..) {
                            p.push_recorded_step(step);
                        }
                        p.push_step_since(
                            "transcribe_primary",
                            transcription_time,
                            Some(format!(
                                "chars={}, duration_s={:.2}",
                                output.text.chars().count(),
                                duration_seconds
                            )),
                        );
                    }
                    debug!(
                        "Transcription in {:?}: '{}'",
                        transcription_time.elapsed(),
                        output.text
                    );
                    if output.text.is_empty() && duration_seconds > 1.0 && !switched_model {
                        if let Some(ref long_model_id) = settings_for_model.long_audio_model {
                            if original_model.as_deref() != Some(long_model_id.as_str()) {
                                let retry_started = Instant::now();
                                info!(
                                    "Empty result for {:.1}s audio, retrying with long model",
                                    duration_seconds
                                );
                                if tm.load_model(long_model_id).is_ok() {
                                    if let Ok(retry) =
                                        tm.transcribe_detailed_request(TranscriptionRequest {
                                            audio: samples_clone_fb,
                                            app_context: active_app_context.clone(),
                                        })
                                    {
                                        if !retry.text.is_empty() {
                                            output = retry;
                                        }
                                    }
                                    if let Ok(mut p) = profiler.lock() {
                                        p.set_model(
                                            Some(long_model_id.clone()),
                                            tm.get_current_model_name(),
                                        );
                                        p.push_step_since(
                                            "transcribe_retry_long_model",
                                            retry_started,
                                            Some(format!("chars={}", output.text.chars().count())),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    output
                }
                Err(err) => {
                    let reason = format!("Transcription error: {}", err);
                    error!("{}", reason);
                    emit_runtime_error_with_context(
                        &ah,
                        "TRANSCRIPTION_FAILED",
                        RuntimeErrorStage::Transcription,
                        reason,
                        true,
                        Some(operation_id),
                        get_settings(&ah).selected_microphone.clone(),
                        tm.get_current_model(),
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.mark_error("TRANSCRIPTION_FAILED");
                        p.push_step_since(
                            "transcribe_primary",
                            transcription_time,
                            Some("error".to_string()),
                        );
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                        let _ = c.fail_operation(&ah, operation_id, "transcription-failed");
                    }
                    if switched_model {
                        if let Some(ref orig_id) = original_model {
                            let _ = tm.load_model(orig_id);
                        }
                    }
                    return;
                }
            };

            if switched_model {
                if let Some(ref orig_id) = original_model {
                    let restore_started = Instant::now();
                    if let Err(e) = tm.load_model(orig_id) {
                        warn!("Failed to restore original model: {}", e);
                    } else if let Ok(mut p) = profiler.lock() {
                        p.push_step_since(
                            "restore_original_model",
                            restore_started,
                            Some(orig_id.clone()),
                        );
                        p.set_model(original_model.clone(), tm.get_current_model_name());
                    }
                }
            }

            emit_transcription_preview(
                &ah,
                operation_id,
                "processing",
                &transcription_output.text,
                true,
            );
            Some(TranscriptionResult {
                session_id: operation_id,
                samples,
                transcription: transcription_output.text,
                confidence_payload: transcription_output.confidence_payload,
                chunk_count: 1,
                status: TranscriptionStatus::Success,
                failed_chunk_count: 0,
            })
        };

        if let Some(TranscriptionResult {
            session_id,
            samples,
            transcription,
            confidence_payload,
            status,
            failed_chunk_count,
            ..
        }) = result
        {
            if !is_operation_active(&ah, operation_id) {
                return;
            }
            if let Some(context) = active_app_context.clone() {
                if let Some(state) = ah.try_state::<ActiveAppContextState>() {
                    if let Ok(mut snapshot) = state.0.lock() {
                        snapshot.set_last_transcription_context(context);
                    }
                }
            }

            let duration_seconds = samples.len() as f32 / 16_000.0;
            let samples_clone = samples.clone();
            let preview_rescue = ah
                .try_state::<TranscriptionCoordinator>()
                .and_then(|c| c.latest_live_preview(operation_id))
                .filter(|text| is_viable_preview_rescue_candidate(text));
            let mut transcription = transcription;
            let mut effective_status = status;

            // Detect language drift on the final transcription (covers both
            // single-chunk and chunked paths). Used to inject a language-correction
            // instruction into the LLM prompt when drift is found.
            let language_correction: Option<String> = {
                let drifted = crate::managers::transcription::inference::has_language_drift(
                    &transcription,
                    &settings.selected_language,
                );
                if drifted {
                    let lang_name = crate::processing::post_processing::language_code_to_name(
                        &settings.selected_language,
                    );
                    if lang_name != "Unknown" {
                        debug!(
                            "[drift] language drift on final transcription — forcing LLM correction to {}",
                            lang_name
                        );
                        Some(lang_name.to_string())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            match effective_status {
                TranscriptionStatus::Partial => {
                    if transcription.trim().is_empty() {
                        if let Some(preview) = preview_rescue.clone() {
                            transcription = preview;
                            effective_status = TranscriptionStatus::Success;
                        }
                    }
                    if matches!(effective_status, TranscriptionStatus::Success) {
                        if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                            c.mark_partial_result(true);
                        }
                        if let Ok(mut p) = profiler.lock() {
                            p.push_step(
                                "finalize_with_preview_rescue",
                                Duration::from_millis(0),
                                Some(format!(
                                    "source=partial failed_chunks={} chars={}",
                                    failed_chunk_count,
                                    transcription.chars().count()
                                )),
                            );
                        }
                        emit_transcription_preview(
                            &ah,
                            operation_id,
                            "processing",
                            &transcription,
                            true,
                        );
                        emit_runtime_error_with_context(
                            &ah,
                            "TRANSCRIPTION_PARTIAL_RECOVERED",
                            RuntimeErrorStage::Transcription,
                            format!(
                                "Recovered from partial transcription using latest live preview (failed_chunks={})",
                                failed_chunk_count
                            ),
                            true,
                            Some(operation_id),
                            get_settings(&ah).selected_microphone.clone(),
                            tm.get_current_model(),
                        );
                    } else {
                        if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                            c.mark_partial_result(true);
                        }
                        emit_runtime_error_with_context(
                            &ah,
                            "TRANSCRIPTION_PARTIAL",
                            RuntimeErrorStage::Transcription,
                            format!(
                                "One or more chunks failed during transcription (failed_chunks={})",
                                failed_chunk_count
                            ),
                            true,
                            Some(operation_id),
                            get_settings(&ah).selected_microphone.clone(),
                            tm.get_current_model(),
                        );
                        if let Ok(mut p) = profiler.lock() {
                            p.mark_error("TRANSCRIPTION_PARTIAL");
                            p.emit(&ah);
                        }
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                        if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                            let _ =
                                c.complete_operation(&ah, operation_id, "partial-result-skipped");
                        }
                        return;
                    }
                }
                TranscriptionStatus::NoSpeech => {
                    if let Some(preview) = preview_rescue.clone() {
                        transcription = preview;
                        effective_status = TranscriptionStatus::Success;
                        if let Ok(mut p) = profiler.lock() {
                            p.push_step(
                                "finalize_with_preview_rescue",
                                Duration::from_millis(0),
                                Some(format!(
                                    "source=no_speech chars={}",
                                    transcription.chars().count()
                                )),
                            );
                        }
                        emit_transcription_preview(
                            &ah,
                            operation_id,
                            "processing",
                            &transcription,
                            true,
                        );
                        emit_runtime_error_with_context(
                            &ah,
                            "NO_SPEECH_RECOVERED_FROM_PREVIEW",
                            RuntimeErrorStage::Transcription,
                            "Recovered a viable final transcript from the latest live preview",
                            true,
                            Some(operation_id),
                            get_settings(&ah).selected_microphone.clone(),
                            tm.get_current_model(),
                        );
                    } else {
                        let (error_code, error_message, completion_detail) =
                            empty_transcription_error(&samples);
                        emit_runtime_error_with_context(
                            &ah,
                            error_code,
                            RuntimeErrorStage::Transcription,
                            error_message,
                            true,
                            Some(operation_id),
                            get_settings(&ah).selected_microphone.clone(),
                            tm.get_current_model(),
                        );
                        if let Ok(mut p) = profiler.lock() {
                            p.mark_error(error_code);
                            p.emit(&ah);
                        }
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                        if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                            let _ = c.complete_operation(&ah, operation_id, completion_detail);
                        }
                        return;
                    }
                }
                TranscriptionStatus::Success => {}
            }

            // Agent mode: route to AI overlay instead of pasting
            if binding_id == "agent_key" {
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
                super::agent::run_agent_mode(&ah, operation_id, &transcription).await;
                if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                    let _ = c.complete_operation(&ah, operation_id, "agent-completed");
                }
                return;
            }

            // Meeting mode: append transcription segment to the active meeting
            if binding_id == "meeting_key" {
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
                super::meeting::handle_meeting_segment(&ah, operation_id, &transcription);
                if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                    let _ = c.complete_operation(&ah, operation_id, "meeting-segment");
                }
                return;
            }

            if binding_id == "note_key" {
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
                super::note::handle_note_segment(&ah, operation_id, &transcription);
                if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                    let _ = c.complete_operation(&ah, operation_id, "note-segment");
                }
                return;
            }

            if should_auto_paste(effective_status) && !transcription.is_empty() {
                let effective_post_process = post_process
                    || language_correction.is_some()
                    || (llm_auto_mode && auto_llm_should_trigger(&ah, &transcription));
                let outcome = process_transcription_text(
                    &ah,
                    session_id,
                    operation_id,
                    &transcription,
                    active_app_context.as_ref(),
                    selected_action_key,
                    effective_post_process,
                    language_correction.clone(),
                    &samples,
                    &profiler,
                )
                .await;
                if !is_operation_active(&ah, operation_id) {
                    return;
                }

                dispatch_text_insertion(
                    &ah,
                    operation_id,
                    outcome.final_text.clone(),
                    is_basic_plan,
                    Arc::clone(&profiler),
                    if !transcription.is_empty() || duration_seconds > 1.0 {
                        let hm_clone = Arc::clone(&hm);
                        let samples_for_history = samples_clone.clone();
                        let transcription_for_history = transcription.clone();
                        let confidence_for_history = confidence_payload.clone();
                        let post_processed_text = outcome.post_processed_text.clone();
                        let post_process_prompt = outcome.post_process_prompt.clone();
                        let model_name_for_history = tm.get_current_model_name();
                        let action_key_for_history = if outcome.post_processed_text.is_some() {
                            selected_action_key
                        } else {
                            None
                        };
                        if let Ok(mut p) = profiler.lock() {
                            p.push_step(
                                "history_enqueue_ready",
                                Duration::from_millis(0),
                                Some(format!(
                                    "chars={}, post_processed={}",
                                    transcription_for_history.chars().count(),
                                    post_processed_text.is_some()
                                )),
                            );
                        }
                        Some(Box::new(move || {
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = hm_clone
                                    .save_transcription(
                                        samples_for_history,
                                        transcription_for_history,
                                        confidence_for_history,
                                        post_processed_text,
                                        post_process_prompt,
                                        action_key_for_history,
                                        model_name_for_history,
                                    )
                                    .await
                                {
                                    error!("Failed to save transcription to history: {}", e);
                                }
                            });
                        })
                            as Box<dyn FnOnce() + Send + 'static>)
                    } else {
                        None
                    },
                );
            } else if let Some(preview) = preview_rescue {
                transcription = preview;
                if let Ok(mut p) = profiler.lock() {
                    p.push_step(
                        "finalize_with_preview_rescue",
                        Duration::from_millis(0),
                        Some(format!(
                            "source=empty chars={}",
                            transcription.chars().count()
                        )),
                    );
                }
                emit_transcription_preview(&ah, operation_id, "processing", &transcription, true);
                let effective_post_process = post_process
                    || language_correction.is_some()
                    || (llm_auto_mode && auto_llm_should_trigger(&ah, &transcription));
                let outcome = process_transcription_text(
                    &ah,
                    session_id,
                    operation_id,
                    &transcription,
                    active_app_context.as_ref(),
                    selected_action_key,
                    effective_post_process,
                    language_correction.clone(),
                    &samples,
                    &profiler,
                )
                .await;
                if !is_operation_active(&ah, operation_id) {
                    return;
                }

                dispatch_text_insertion(
                    &ah,
                    operation_id,
                    outcome.final_text.clone(),
                    is_basic_plan,
                    Arc::clone(&profiler),
                    if duration_seconds > 1.0 {
                        let hm_clone = Arc::clone(&hm);
                        let samples_for_history = samples_clone.clone();
                        let transcription_for_history = transcription.clone();
                        let confidence_for_history = confidence_payload.clone();
                        let post_processed_text = outcome.post_processed_text.clone();
                        let post_process_prompt = outcome.post_process_prompt.clone();
                        let model_name_for_history = tm.get_current_model_name();
                        let action_key_for_history = if outcome.post_processed_text.is_some() {
                            selected_action_key
                        } else {
                            None
                        };
                        Some(Box::new(move || {
                            tauri::async_runtime::spawn(async move {
                                let _ = hm_clone
                                    .save_transcription(
                                        samples_for_history,
                                        transcription_for_history,
                                        confidence_for_history,
                                        post_processed_text,
                                        post_process_prompt,
                                        action_key_for_history,
                                        model_name_for_history,
                                    )
                                    .await;
                            });
                        })
                            as Box<dyn FnOnce() + Send + 'static>)
                    } else {
                        None
                    },
                );
            } else {
                warn!("Empty transcription result; skipping automatic paste");
                let (error_code, error_message, completion_detail) =
                    empty_transcription_error(&samples);
                emit_runtime_error_with_context(
                    &ah,
                    error_code,
                    RuntimeErrorStage::Transcription,
                    error_message,
                    true,
                    Some(operation_id),
                    get_settings(&ah).selected_microphone.clone(),
                    tm.get_current_model(),
                );
                if let Ok(mut p) = profiler.lock() {
                    p.set_transcription_chars("");
                    p.mark_error(error_code);
                    p.emit(&ah);
                }
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
                if let Some(c) = ah.try_state::<TranscriptionCoordinator>() {
                    let _ = c.complete_operation(&ah, operation_id, completion_detail);
                }
            }
        }
    });

    debug!(
        "TranscribeAction::stop completed in {:?}",
        stop_time.elapsed()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_audio_switch_requires_threshold_and_different_model() {
        assert!(should_switch_to_long_audio_model(
            31.0,
            30.0,
            Some("small"),
            Some("large")
        ));
        assert!(!should_switch_to_long_audio_model(
            29.0,
            30.0,
            Some("small"),
            Some("large")
        ));
        assert!(!should_switch_to_long_audio_model(
            31.0,
            30.0,
            Some("large"),
            Some("large")
        ));
    }

    #[test]
    fn auto_paste_only_runs_for_successful_transcription() {
        assert!(should_auto_paste(TranscriptionStatus::Success));
        assert!(!should_auto_paste(TranscriptionStatus::NoSpeech));
        assert!(!should_auto_paste(TranscriptionStatus::Partial));
    }

    #[test]
    fn timestamp_trim_falls_back_when_it_would_drop_a_real_chunk() {
        assert!(should_fallback_from_timestamp_trim(
            "La vegetale je mets ca gratuit c'est ma cite",
            1,
            0
        ));
        assert!(should_fallback_from_timestamp_trim(
            "commande j'ai a peu pres 2300 h",
            1,
            1
        ));
        assert!(!should_fallback_from_timestamp_trim("okay", 1, 0));
    }

    #[test]
    fn low_signal_vad_gate_skips_only_dead_silent_chunks() {
        // Truly dead (below 1e-9 energy) — should skip
        let dead_silent = vec![0.0_f32; 3 * 16_000];
        // Quiet but real speech (rms ~0.0002) — should NOT skip
        let quiet_speech = vec![0.0002_f32; 3 * 16_000];
        let voiced = vec![0.01_f32; 3 * 16_000];

        assert!(should_skip_low_signal_vad_chunk(&dead_silent));
        assert!(!should_skip_low_signal_vad_chunk(&quiet_speech));
        assert!(!should_skip_low_signal_vad_chunk(&voiced));
    }

    #[test]
    fn language_switch_detector_triggers_on_accent_free_short_chunks() {
        let short = 2 * 16_000; // 2s

        // English word in French session — no accents → should trigger retry
        assert!(is_likely_language_switched_short_chunk(
            "Extremely",
            "fr",
            short
        ));
        assert!(is_likely_language_switched_short_chunk(
            "The James Clear.",
            "fr",
            short
        ));
        assert!(is_likely_language_switched_short_chunk(
            "Um co", "fr", short
        ));

        // Correctly transcribed French — accent chars → no retry
        assert!(!is_likely_language_switched_short_chunk(
            "Extrêmement",
            "fr",
            short
        ));
        assert!(!is_likely_language_switched_short_chunk(
            "De décider",
            "fr",
            short
        ));
        assert!(!is_likely_language_switched_short_chunk(
            "C'est ça",
            "fr",
            short
        ));

        // Too many words → no retry (model probably got it right)
        assert!(!is_likely_language_switched_short_chunk(
            "Alors que c'est le meilleur",
            "fr",
            short
        ));

        // English selected → never triggers
        assert!(!is_likely_language_switched_short_chunk(
            "Extremely",
            "en",
            short
        ));
        assert!(!is_likely_language_switched_short_chunk(
            "Extremely",
            "en-US",
            short
        ));

        // Auto → never triggers
        assert!(!is_likely_language_switched_short_chunk(
            "Extremely",
            "auto",
            short
        ));

        // Chunk too long (> 3s) → no retry
        assert!(!is_likely_language_switched_short_chunk(
            "Extremely",
            "fr",
            4 * 16_000
        ));
    }

    #[test]
    fn compressed_timestamp_cluster_detected() {
        fn make_seg(start: f32) -> transcribe_rs::TranscriptionSegment {
            transcribe_rs::TranscriptionSegment {
                start,
                end: start + 0.08,
                text: "word".to_string(),
                confidence: None,
                words: None,
            }
        }

        let long_chunk = 7 * 16_000; // 7 s
        let short_chunk = 2 * 16_000; // 2 s (below 3 s guard)

        // 5 words all at the same timestamp → compressed
        let all_same: Vec<_> = (0..5).map(|_| make_seg(5.0)).collect();
        assert!(is_timestamp_cluster_compressed(&all_same, 5, long_chunk));

        // 8 words clustered in 0.1 s window — impossible spread for 8 frames
        let tight: Vec<_> = (0..8).map(|i| make_seg(5.0 + i as f32 * 0.01)).collect();
        assert!(is_timestamp_cluster_compressed(&tight, 8, long_chunk));

        // 5 words spread across 0.8 s — legitimate
        let spread: Vec<_> = (0..5).map(|i| make_seg(i as f32 * 0.20)).collect();
        assert!(!is_timestamp_cluster_compressed(&spread, 5, long_chunk));

        // < 5 words → never fires regardless of clustering
        let tiny: Vec<_> = (0..4).map(|_| make_seg(5.0)).collect();
        assert!(!is_timestamp_cluster_compressed(&tiny, 4, long_chunk));

        // Short chunk (≤ 3 s) → guard prevents false positive
        let all_same_short: Vec<_> = (0..5).map(|_| make_seg(0.5)).collect();
        assert!(!is_timestamp_cluster_compressed(
            &all_same_short,
            5,
            short_chunk
        ));
    }

    #[test]
    fn microphone_start_error_classification_is_stable() {
        assert_eq!(
            classify_microphone_start_error("Selected microphone 'USB' is no longer available"),
            "MIC_NOT_FOUND"
        );
        assert_eq!(
            classify_microphone_start_error("No input device found"),
            "MIC_NOT_FOUND"
        );
        assert_eq!(
            classify_microphone_start_error("Microphone permission denied by system"),
            "MIC_PERMISSION_DENIED"
        );
        assert_eq!(
            classify_microphone_start_error("Failed to open recorder"),
            "MIC_OPEN_FAILED"
        );
    }

    #[test]
    fn empty_transcription_error_distinguishes_silence_from_captured_audio() {
        let silence = vec![0.0; 16_000];
        let captured_signal = vec![0.01; 16_000];

        let (silent_code, _, silent_detail) = empty_transcription_error(&silence);
        let (signal_code, _, signal_detail) = empty_transcription_error(&captured_signal);

        assert_eq!(silent_code, "NO_SPEECH_DETECTED");
        assert_eq!(silent_detail, "no-speech");
        assert_eq!(signal_code, "AUDIO_CAPTURED_EMPTY_TRANSCRIPT");
        assert_eq!(signal_detail, "audio-captured-empty-transcription");
    }

    #[test]
    fn short_audio_is_not_classified_as_model_empty_output() {
        let short_burst = vec![0.2; 8_000];

        let (code, _, detail) = empty_transcription_error(&short_burst);

        assert_eq!(code, "NO_SPEECH_DETECTED");
        assert_eq!(detail, "no-speech");
    }

    #[test]
    fn final_recovery_candidate_requires_real_content() {
        assert!(!is_viable_final_recovery_candidate("yeah"));
        assert!(!is_viable_final_recovery_candidate("ok"));
        assert!(is_viable_final_recovery_candidate(
            "this should recover the real ending"
        ));
    }

    #[test]
    fn recovered_final_chunk_avoids_readding_duplicate_boundary() {
        let assembled = "I want to explain the issue with the microphone";
        let recovered =
            append_recovered_final_chunk(assembled, "the microphone keeps dropping the ending");
        assert_eq!(
            recovered,
            "I want to explain the issue with the microphone keeps dropping the ending"
        );
    }
}

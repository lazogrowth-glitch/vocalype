use super::*;
use crate::parakeet_text::{
    finalize_parakeet_text_with_profile, maybe_prefer_sentence_punctuation,
    parakeet_builtin_correction_terms_with_profile, should_attempt_sentence_punctuation,
    ParakeetDomainProfile,
};
use crate::session_keyterms::build_session_keyterms;
use whichlang::Lang;

const PARAKEET_LOW_ENERGY_RMS_THRESHOLD: f32 = 0.05;
const PARAKEET_LOW_ENERGY_TARGET_RMS: f32 = 0.1;
const PARAKEET_LOW_ENERGY_MAX_GAIN: f32 = 4.5;

// Short-phrase threshold: recordings under 5 s get silence padding on both
// sides and Sentences mode (Words timestamps are unstable on short clips and
// the first few seconds often have cold-start encoder errors).
const PARAKEET_SHORT_PHRASE_SAMPLES: usize = 5 * 16_000; // 5 s at 16 kHz
const PARAKEET_SHORT_PHRASE_PAD_SAMPLES: usize = 16_000 / 2; // 0.5 s silence
                                                             // Tail pad applied to ALL recordings so the last word is never cut off.
const PARAKEET_TAIL_PAD_SAMPLES: usize = 16_000 / 2; // 0.5 s silence
const PARAKEET_SENTENCE_RESCUE_MAX_WORDS: usize = 24;

fn audio_rms_and_peak(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let sum = samples.iter().map(|sample| sample * sample).sum::<f32>();
    let peak = samples
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max);
    ((sum / samples.len() as f32).sqrt(), peak)
}

fn should_attempt_parakeet_sentence_rescue(text: &str, is_short_phrase: bool) -> bool {
    if !should_attempt_sentence_punctuation(text) {
        return false;
    }

    if is_short_phrase {
        return true;
    }

    let word_count = text.split_whitespace().count();
    word_count <= PARAKEET_SENTENCE_RESCUE_MAX_WORDS
}

/// For short phrases (< 5 s), pad with silence on both sides so the encoder
/// has enough context and doesn't start decoding mid-phoneme.
fn pad_short_phrase(samples: &[f32]) -> Vec<f32> {
    let pad = vec![0.0_f32; PARAKEET_SHORT_PHRASE_PAD_SAMPLES];
    let mut padded = Vec::with_capacity(pad.len() * 2 + samples.len());
    padded.extend_from_slice(&pad);
    padded.extend_from_slice(samples);
    padded.extend_from_slice(&pad);
    padded
}

/// Append 0.5 s of silence to any recording so the encoder never cuts the
/// last word at a hard boundary.
fn pad_audio_tail(samples: &[f32]) -> Vec<f32> {
    let tail = vec![0.0_f32; PARAKEET_TAIL_PAD_SAMPLES];
    let mut padded = Vec::with_capacity(samples.len() + tail.len());
    padded.extend_from_slice(samples);
    padded.extend_from_slice(&tail);
    padded
}

fn maybe_boost_low_energy_parakeet_audio(samples: &[f32]) -> Option<(Vec<f32>, f32)> {
    let (rms, peak) = audio_rms_and_peak(samples);
    if rms <= 0.0 || rms >= PARAKEET_LOW_ENERGY_RMS_THRESHOLD || peak >= 0.92 {
        return None;
    }

    let gain_from_rms = PARAKEET_LOW_ENERGY_TARGET_RMS / rms;
    let gain_from_peak = if peak > 0.0 { 0.98 / peak } else { 1.0 };
    let gain = gain_from_rms
        .min(gain_from_peak)
        .min(PARAKEET_LOW_ENERGY_MAX_GAIN);

    if gain <= 1.15 {
        return None;
    }

    Some((
        samples
            .iter()
            .map(|sample| (sample * gain).clamp(-1.0, 1.0))
            .collect(),
        gain,
    ))
}

fn build_correction_terms(
    settings: &crate::settings::AppSettings,
    session_keyterms: &[String],
    session_glossary_terms: &[String],
    active_model_id: Option<&str>,
    profile: ParakeetDomainProfile,
) -> Vec<String> {
    let mut terms = settings.custom_words.clone();

    // Passive Session Glossary terms: project-specific identifiers extracted
    // from clipboard while the developer codes. Keep them scoped to the
    // general/code profile so recruiting dictation never inherits dev jargon.
    if profile == ParakeetDomainProfile::General {
        terms.extend(session_glossary_terms.iter().cloned());
    }

    if matches!(active_model_id, Some(id) if is_parakeet_v3_model_id(id)) {
        terms.extend(parakeet_builtin_correction_terms_with_profile(
            &settings.selected_language,
            profile,
        ));
        terms.extend(session_keyterms.iter().cloned());
    }

    let mut deduped = Vec::new();
    for term in terms {
        let trimmed = term.trim();
        if trimmed.is_empty() {
            continue;
        }
        if deduped
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }
        deduped.push(trimmed.to_string());
    }

    deduped
}
/// Maps a whichlang ISO 639-3 `Lang` variant to a BCP-47 two-letter code.
/// Only covers the languages that Parakeet V3 Multilingual supports.
fn whichlang_to_bcp47(lang: Lang) -> Option<&'static str> {
    // whichlang 0.1 supports only these 16 languages
    match lang {
        Lang::Eng => Some("en"),
        Lang::Fra => Some("fr"),
        Lang::Deu => Some("de"),
        Lang::Spa => Some("es"),
        Lang::Por => Some("pt"),
        Lang::Ita => Some("it"),
        Lang::Nld => Some("nl"),
        Lang::Rus => Some("ru"),
        Lang::Swe => Some("sv"),
        Lang::Cmn => Some("zh"),
        Lang::Jpn => Some("ja"),
        Lang::Kor => Some("ko"),
        Lang::Ara => Some("ar"),
        Lang::Hin => Some("hi"),
        Lang::Tur => Some("tr"),
        Lang::Vie => Some("vi"),
    }
}

/// Detects language drift after Parakeet transcription.
///
/// Parakeet has no language-forcing mechanism at the ONNX level — its encoder
/// accepts only `audio_signal` + `length`, with no language token input.
/// Language detection is entirely automatic via nemo128.onnx, which means
/// the model can silently drift to English when audio is ambiguous or short.
///
/// This function logs a warning when the transcribed text's detected language
/// does not match `selected_language`, giving us observability into drift.
///
/// NOTE: A Whisper fallback was considered but is not feasible here — only one
/// engine is loaded at a time, and an on-demand Whisper load would add 1-2 s
/// of latency per utterance. A proper fallback requires a persistent secondary
/// engine, which is a larger architectural change.
fn check_parakeet_language_drift(text: &str, selected_language: &str) {
    if has_language_drift(text, selected_language) {
        warn!(
            "Parakeet language drift detected in chunk output. \
             Consider switching to Whisper or SenseVoice for forced-language transcription."
        );
    }
}

/// Returns `true` when the detected language of `text` does not match
/// `selected_language`. Safe to call on assembled output from transcribe.rs.
///
/// Returns `false` when:
/// - `selected_language` is "auto" (user doesn't care about language)
/// - The text is too short to detect reliably (< 40 chars)
/// - The detected language is not in our BCP-47 mapping
pub(crate) fn has_language_drift(text: &str, selected_language: &str) -> bool {
    if selected_language == "auto" || text.chars().count() < 40 {
        return false;
    }
    let detected = whichlang::detect_language(text);
    let detected_bcp47 = match whichlang_to_bcp47(detected) {
        Some(code) => code,
        None => return false,
    };
    let selected_normalized = match selected_language {
        "zh-Hans" | "zh-Hant" => "zh",
        other => other,
    };
    detected_bcp47 != selected_normalized
}

impl TranscriptionManager {
    pub fn transcribe_detailed_request(
        &self,
        request: TranscriptionRequest,
    ) -> Result<TranscriptionOutput> {
        // Update last activity timestamp
        self.last_activity.store(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("System clock is before Unix epoch")
                .as_millis() as u64,
            Ordering::Relaxed,
        );

        let st = std::time::Instant::now();
        let TranscriptionRequest { audio, app_context } = request;

        debug!("Audio vector length: {}", audio.len());

        if audio.is_empty() {
            debug!("Empty audio vector");
            self.maybe_unload_immediately("empty audio");
            return Ok(TranscriptionOutput {
                text: String::new(),
                confidence_payload: None,
                segments: None,
            });
        }

        // Check if model is loaded, if not try to load it
        {
            // If the model is loading, wait for it to complete.
            let mut is_loading = self.is_loading.lock();
            while *is_loading {
                self.loading_condvar.wait(&mut is_loading);
            }

            let engine_guard = self.lock_engine();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        // Get current settings for configuration
        let settings = get_settings(&self.app_handle);
        let active_model_id = self.get_current_model();
        let voice_profile = if settings.adaptive_voice_profile_enabled {
            active_model_id.as_deref().and_then(|model_id| {
                crate::voice_profile::current_voice_profile_for_context(
                    &self.app_handle,
                    model_id,
                    &settings.selected_language,
                )
            })
        } else {
            None
        };
        let voice_terms: Vec<String> = voice_profile
            .as_ref()
            .map(|profile| profile.preferred_terms.clone())
            .unwrap_or_default();
        let vocabulary_terms = if settings.adaptive_vocabulary_enabled {
            if let Some(state) = self.app_handle.try_state::<VocabularyStoreState>() {
                if let Ok(store) = state.0.lock() {
                    if let Some(model_id) = active_model_id.as_deref() {
                        store.terms_for_session(
                            app_context.as_ref(),
                            model_id,
                            &settings.selected_language,
                            16,
                        )
                    } else {
                        store.terms_for_context(app_context.as_ref(), 16)
                    }
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };
        let session_keyterms = build_session_keyterms(
            app_context.as_ref(),
            &settings.selected_language,
            &settings.custom_words,
            &voice_terms,
            &vocabulary_terms,
        )
        .terms;
        // Collect session glossary terms (passive clipboard identifiers).
        let session_glossary_terms: Vec<String> = self
            .app_handle
            .try_state::<crate::session_glossary::SessionGlossaryState>()
            .and_then(|state| state.0.lock().ok().map(|g| g.as_vec()))
            .unwrap_or_default();
        let correction_profile = if matches!(
            app_context.as_ref().map(|context| context.category),
            Some(crate::context_detector::AppContextCategory::Code)
        ) {
            ParakeetDomainProfile::General
        } else {
            ParakeetDomainProfile::Recruiting
        };
        let correction_terms = build_correction_terms(
            &settings,
            &session_keyterms,
            &session_glossary_terms,
            active_model_id.as_deref(),
            correction_profile,
        );
        let correction_threshold = if matches!(active_model_id.as_deref(), Some(id) if is_parakeet_v3_model_id(id))
        {
            settings.word_correction_threshold.max(0.24)
        } else {
            settings.word_correction_threshold
        };
        let initial_prompt = if settings.adaptive_vocabulary_enabled
            || (settings.adaptive_voice_profile_enabled && !voice_terms.is_empty())
            || app_context.is_some()
            || !session_keyterms.is_empty()
        {
            if let Some(state) = self.app_handle.try_state::<VocabularyStoreState>() {
                if let Ok(store) = state.0.lock() {
                    build_whisper_initial_prompt(
                        &settings,
                        app_context.as_ref(),
                        &store,
                        &session_keyterms,
                    )
                } else {
                    None
                }
            } else {
                build_whisper_initial_prompt(
                    &settings,
                    app_context.as_ref(),
                    &crate::vocabulary_store::VocabularyStore::default(),
                    &session_keyterms,
                )
            }
        } else {
            None
        };

        // Handle Gemini API separately (requires async HTTP call)
        {
            let engine_guard = self.lock_engine();
            if let Some(LoadedEngine::GeminiApi) = engine_guard.as_ref() {
                drop(engine_guard);
                let api_key = settings
                    .gemini_api_key
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Gemini API key not configured"))?
                    .clone();
                let gemini_model = settings.gemini_model.clone();

                // Use block_in_place to safely run async code from a tokio worker thread.
                // Handle::block_on() panics if called directly from an async context,
                // so block_in_place tells tokio to move its work off this thread first.
                let result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(
                        crate::gemini_client::transcribe_audio(&api_key, &gemini_model, &audio),
                    )
                })?;

                let corrected = if !settings.custom_words.is_empty() {
                    apply_custom_words(
                        &result,
                        &settings.custom_words,
                        settings.word_correction_threshold,
                    )
                } else {
                    result
                };
                let final_result = Self::filter_transcription_output_for_context(
                    corrected,
                    active_model_id.as_deref(),
                    app_context.as_ref(),
                );

                let et = std::time::Instant::now();
                info!(
                    "Gemini transcription completed in {}ms",
                    (et - st).as_millis()
                );

                self.maybe_unload_immediately("gemini transcription");
                return Ok(TranscriptionOutput {
                    text: final_result,
                    confidence_payload: None,
                    segments: None,
                });
            }
        }

        // Handle Groq Whisper API
        {
            let engine_guard = self.lock_engine();
            if let Some(LoadedEngine::GroqWhisper) = engine_guard.as_ref() {
                drop(engine_guard);
                let api_key = settings
                    .groq_stt_api_key
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Groq API key not configured"))?
                    .clone();

                let result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current()
                        .block_on(crate::groq_stt_client::transcribe_audio(&api_key, &audio))
                })?;

                let corrected = if !settings.custom_words.is_empty() {
                    apply_custom_words(
                        &result,
                        &settings.custom_words,
                        settings.word_correction_threshold,
                    )
                } else {
                    result
                };
                let final_result = Self::filter_transcription_output_for_context(
                    corrected,
                    active_model_id.as_deref(),
                    app_context.as_ref(),
                );

                info!(
                    "Groq STT transcription completed in {}ms",
                    st.elapsed().as_millis()
                );
                self.maybe_unload_immediately("groq transcription");
                return Ok(TranscriptionOutput {
                    text: final_result,
                    confidence_payload: None,
                    segments: None,
                });
            }
        }

        // Handle Mistral Voxtral API
        {
            let engine_guard = self.lock_engine();
            if let Some(LoadedEngine::MistralVoxtral) = engine_guard.as_ref() {
                drop(engine_guard);
                let api_key = settings
                    .mistral_stt_api_key
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Mistral API key not configured"))?
                    .clone();

                let result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(
                        crate::mistral_stt_client::transcribe_audio(&api_key, &audio),
                    )
                })?;

                let corrected = if !settings.custom_words.is_empty() {
                    apply_custom_words(
                        &result,
                        &settings.custom_words,
                        settings.word_correction_threshold,
                    )
                } else {
                    result
                };
                let final_result = Self::filter_transcription_output_for_context(
                    corrected,
                    active_model_id.as_deref(),
                    app_context.as_ref(),
                );

                info!(
                    "Mistral STT transcription completed in {}ms",
                    st.elapsed().as_millis()
                );
                self.maybe_unload_immediately("mistral transcription");
                return Ok(TranscriptionOutput {
                    text: final_result,
                    confidence_payload: None,
                    segments: None,
                });
            }
        }

        // Handle Deepgram Nova API
        {
            let engine_guard = self.lock_engine();
            if let Some(LoadedEngine::Deepgram) = engine_guard.as_ref() {
                drop(engine_guard);
                let api_key = settings
                    .deepgram_api_key
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Deepgram API key not configured"))?
                    .clone();

                let result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(
                        crate::deepgram_stt_client::transcribe_audio(&api_key, &audio),
                    )
                })?;

                let corrected = if !settings.custom_words.is_empty() {
                    apply_custom_words(
                        &result,
                        &settings.custom_words,
                        settings.word_correction_threshold,
                    )
                } else {
                    result
                };
                let final_result = Self::filter_transcription_output_for_context(
                    corrected,
                    active_model_id.as_deref(),
                    app_context.as_ref(),
                );

                info!(
                    "Deepgram STT transcription completed in {}ms",
                    st.elapsed().as_millis()
                );
                self.maybe_unload_immediately("deepgram transcription");
                return Ok(TranscriptionOutput {
                    text: final_result,
                    confidence_payload: None,
                    segments: None,
                });
            }
        }

        // Perform transcription with the appropriate engine.
        // We use catch_unwind to prevent engine panics from poisoning the mutex,
        // which would make the app hang indefinitely on subsequent operations.
        let result = {
            let mut engine_guard = self.lock_engine();

            // Take the engine out so we own it during transcription.
            // If the engine panics, we simply don't put it back (effectively unloading it)
            // instead of poisoning the mutex.
            let mut engine = match engine_guard.take() {
                Some(e) => e,
                None => {
                    return Err(anyhow::anyhow!(
                        "Model failed to load after auto-load attempt. Please check your model settings."
                    ));
                }
            };

            // Release the lock before transcribing — no mutex held during the engine call
            drop(engine_guard);

            let transcribe_result = catch_unwind(AssertUnwindSafe(
                || -> Result<EngineTranscriptionResult> {
                    match &mut engine {
                        LoadedEngine::Whisper(whisper_engine) => {
                            let whisper_language = if settings.selected_language == "auto" {
                                None
                            } else {
                                let normalized = if settings.selected_language == "zh-Hans"
                                    || settings.selected_language == "zh-Hant"
                                {
                                    "zh".to_string()
                                } else {
                                    settings.selected_language.clone()
                                };
                                Some(normalized)
                            };

                            let current_model_id = self.get_current_model();
                            let whisper_gpu_active =
                                self.whisper_gpu_active.load(Ordering::Relaxed);
                            let n_threads = self.recommended_whisper_threads(
                                current_model_id.as_deref(),
                                whisper_gpu_active,
                            );

                            let params = WhisperInferenceParams {
                                language: whisper_language,
                                translate: settings.translate_to_english,
                                initial_prompt: initial_prompt.clone(),
                                greedy_best_of: Some(1),
                                n_threads: Some(n_threads),
                                debug_mode: false,
                                // Each dictation chunk is independent. Reusing decoder text
                                // context across calls can both slow decoding and smear text
                                // from earlier chunks into later ones.
                                no_context: true,
                                // Skip timestamp computation — we only need raw text.
                                // This alone saves ~10-20% of inference time.
                                no_timestamps: true,
                                // Treat the full clip as one segment — avoids per-segment
                                // overhead. Safe for push-to-talk dictation clips.
                                single_segment: true,
                                // Disable whisper.cpp's multi-temperature retry ladder for
                                // latency-sensitive dictation. Without this, a bad short clip
                                // can trigger several full re-decodes and explode latency.
                                temperature: Some(0.0),
                                temperature_inc: Some(0.0),
                                entropy_thold: Some(9_999.0),
                                logprob_thold: Some(-9_999.0),
                                ..Default::default()
                            };
                            debug!(
                                "Whisper inference params: model={:?}, gpu_active={}, threads={}",
                                current_model_id, whisper_gpu_active, n_threads
                            );

                            whisper_engine
                                .transcribe_samples(audio, Some(params))
                                .map(|result| EngineTranscriptionResult {
                                    text: result.text,
                                    segments: result.segments,
                                })
                                .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))
                        }
                        LoadedEngine::Parakeet(parakeet_engine) => {
                            let boosted_audio = maybe_boost_low_energy_parakeet_audio(&audio);
                            if let Some((_, gain)) = boosted_audio.as_ref() {
                                info!(
                                    "Applying low-energy boost to Parakeet input (gain={:.2})",
                                    gain
                                );
                            }
                            let params = ParakeetInferenceParams {
                                timestamp_granularity: TimestampGranularity::Segment,
                                ..Default::default()
                            };
                            parakeet_engine
                                .transcribe_samples(
                                    boosted_audio
                                        .as_ref()
                                        .map(|(samples, _)| samples.clone())
                                        .unwrap_or(audio),
                                    Some(params),
                                )
                                .map(|result| {
                                    check_parakeet_language_drift(
                                        &result.text,
                                        &settings.selected_language,
                                    );
                                    EngineTranscriptionResult {
                                        text: result.text,
                                        segments: None,
                                    }
                                })
                                .map_err(|e| {
                                    anyhow::anyhow!("Parakeet transcription failed: {}", e)
                                })
                        }
                        LoadedEngine::ParakeetV3(parakeet_engine) => {
                            let is_short_phrase = audio.len() < PARAKEET_SHORT_PHRASE_SAMPLES;

                            let boosted_audio = maybe_boost_low_energy_parakeet_audio(&audio);
                            if let Some((_, gain)) = boosted_audio.as_ref() {
                                info!(
                                    "Applying low-energy boost to Parakeet V3 input (gain={:.2})",
                                    gain
                                );
                            }
                            // Short phrases (< 5 s): add silence padding on both sides so the
                            // encoder has enough context and go straight to Sentences mode —
                            // Words timestamps are unstable on clips this short.
                            // Longer clips: still add trailing silence so the last word is
                            // never cut off at the encoder boundary.
                            let decode_audio = if is_short_phrase {
                                boosted_audio
                                    .as_ref()
                                    .map(|(samples, _)| pad_short_phrase(samples))
                                    .unwrap_or_else(|| pad_short_phrase(&audio))
                            } else {
                                boosted_audio
                                    .as_ref()
                                    .map(|(samples, _)| pad_audio_tail(samples))
                                    .unwrap_or_else(|| pad_audio_tail(&audio))
                            };

                            // Language bias disabled: Parakeet TDT auto-detects language via
                            // the encoder — logit biasing accent-char tokens causes regressions
                            // (e.g. "a" → "à", "e" → "é") because single-char accent tokens
                            // get indiscriminately boosted at every decode frame.
                            parakeet_engine.set_language(None);

                            if is_short_phrase {
                                // ── Short-phrase path ──────────────────────────────────────
                                // Sentences mode is more robust for short clips: no word-level
                                // timestamp machinery, less prone to hallucination loops.
                                debug!("Parakeet V3 short-phrase path ({} samples)", audio.len());
                            }

                            match parakeet_engine.transcribe_samples(
                                decode_audio.clone(),
                                16_000,
                                1,
                                if is_short_phrase {
                                    Some(ParakeetTimestampMode::Sentences)
                                } else {
                                    Some(ParakeetTimestampMode::Words)
                                },
                            ) {
                                Ok(result) => {
                                    check_parakeet_language_drift(
                                        &result.text,
                                        &settings.selected_language,
                                    );
                                    let mut display_text = result.text.clone();
                                    if should_attempt_parakeet_sentence_rescue(
                                        &display_text,
                                        is_short_phrase,
                                    ) {
                                        if let Ok(sentence_result) = parakeet_engine
                                            .transcribe_samples(
                                                decode_audio.clone(),
                                                16_000,
                                                1,
                                                Some(ParakeetTimestampMode::Sentences),
                                            )
                                        {
                                            if let Some(punctuated) =
                                                maybe_prefer_sentence_punctuation(
                                                    &display_text,
                                                    &sentence_result.text,
                                                )
                                            {
                                                display_text = punctuated;
                                            }
                                        }
                                    }
                                    // Sentences mode (short phrase) has no word timestamps — that
                                    // is intentional: segments=None lets assembly fall back to
                                    // deduplicate_boundary, same as the Words-mode error path.
                                    // Words mode (long phrase): convert per-word timed tokens to
                                    // TranscriptionSegment so the chunking worker can trim the
                                    // overlap prefix by timestamp (immune to non-determinism).
                                    let segments: Vec<transcribe_rs::TranscriptionSegment> = result
                                        .tokens
                                        .iter()
                                        .map(|t| transcribe_rs::TranscriptionSegment {
                                            start: t.start,
                                            end: t.end,
                                            text: t.text.clone(),
                                            confidence: None,
                                            words: None,
                                        })
                                        .collect();
                                    Ok(EngineTranscriptionResult {
                                        text: display_text,
                                        segments: if segments.is_empty() {
                                            None
                                        } else {
                                            Some(segments)
                                        },
                                    })
                                }
                                Err(word_err) => {
                                    // Words mode failed — fall back to Sentences. We do NOT
                                    // propagate sentence-level tokens as word timestamps: sentence
                                    // tokens have t_start=0 for the whole sentence, which causes
                                    // the overlap filter to drop legitimate new content. Keep
                                    // segments=None so the assembly falls back to deduplicate_boundary.
                                    debug!(
                                    "Parakeet V3 word-mode decode failed, retrying with sentence mode: {}",
                                    word_err
                                );
                                    parakeet_engine
                                        .transcribe_samples(
                                            decode_audio,
                                            16_000,
                                            1,
                                            Some(ParakeetTimestampMode::Sentences),
                                        )
                                        .map(|result| {
                                            check_parakeet_language_drift(
                                                &result.text,
                                                &settings.selected_language,
                                            );
                                            EngineTranscriptionResult {
                                                text: result.text,
                                                segments: None,
                                            }
                                        })
                                        .map_err(|e| {
                                            anyhow::anyhow!(
                                                "Parakeet V3 transcription failed: {}",
                                                e
                                            )
                                        })
                                }
                            }
                        }
                        LoadedEngine::Moonshine(moonshine_engine) => moonshine_engine
                            .transcribe_samples(audio, None)
                            .map(|result| EngineTranscriptionResult {
                                text: result.text,
                                segments: None,
                            })
                            .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e)),
                        LoadedEngine::MoonshineStreaming(streaming_engine) => streaming_engine
                            .transcribe_samples(audio, None)
                            .map(|result| EngineTranscriptionResult {
                                text: result.text,
                                segments: None,
                            })
                            .map_err(|e| {
                                anyhow::anyhow!("Moonshine streaming transcription failed: {}", e)
                            }),
                        LoadedEngine::SenseVoice(sense_voice_engine) => {
                            let language = match settings.selected_language.as_str() {
                                "zh" | "zh-Hans" | "zh-Hant" => SenseVoiceLanguage::Chinese,
                                "en" => SenseVoiceLanguage::English,
                                "ja" => SenseVoiceLanguage::Japanese,
                                "ko" => SenseVoiceLanguage::Korean,
                                "yue" => SenseVoiceLanguage::Cantonese,
                                _ => SenseVoiceLanguage::Auto,
                            };
                            let params = SenseVoiceInferenceParams {
                                language,
                                use_itn: true,
                            };
                            sense_voice_engine
                                .transcribe_samples(audio, Some(params))
                                .map(|result| EngineTranscriptionResult {
                                    text: result.text,
                                    segments: None,
                                })
                                .map_err(|e| {
                                    anyhow::anyhow!("SenseVoice transcription failed: {}", e)
                                })
                        }
                        LoadedEngine::GeminiApi => {
                            unreachable!("GeminiApi handled before catch_unwind")
                        }
                        LoadedEngine::GroqWhisper => {
                            unreachable!("GroqWhisper handled before catch_unwind")
                        }
                        LoadedEngine::MistralVoxtral => {
                            unreachable!("MistralVoxtral handled before catch_unwind")
                        }
                        LoadedEngine::Deepgram => {
                            unreachable!("Deepgram handled before catch_unwind")
                        }
                    }
                },
            ));

            match transcribe_result {
                Ok(inner_result) => {
                    // Success or normal error — put the engine back
                    let mut engine_guard = self.lock_engine();
                    *engine_guard = Some(engine);
                    inner_result?
                }
                Err(panic_payload) => {
                    // Engine panicked — do NOT put it back (it's in an unknown state).
                    // The engine is dropped here, effectively unloading it.
                    let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!(
                        "Transcription engine panicked: {}. Model has been unloaded.",
                        panic_msg
                    );

                    // Clear the model ID so it will be reloaded on next attempt
                    {
                        let mut current_model = self.current_model_id.lock();
                        *current_model = None;
                    }

                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "unloaded".to_string(),
                            model_id: None,
                            model_name: None,
                            error: Some(format!("Engine panicked: {}", panic_msg)),
                        },
                    );

                    return Err(anyhow::anyhow!(
                        "Transcription engine panicked: {}. The model has been unloaded and will reload on next attempt.",
                        panic_msg
                    ));
                }
            }
        };

        // Apply word correction if custom words are configured
        let raw_result = result.text;
        let learned_result = if settings.adaptive_vocabulary_enabled {
            if let (Some(state), Some(model_id)) = (
                self.app_handle.try_state::<VocabularyStoreState>(),
                active_model_id.as_deref(),
            ) {
                if let Ok(store) = state.0.lock() {
                    store.apply_learned_corrections(
                        app_context.as_ref(),
                        model_id,
                        &settings.selected_language,
                        &raw_result,
                    )
                } else {
                    raw_result
                }
            } else {
                raw_result
            }
        } else {
            raw_result
        };
        // In code context, try to recover camelCase identifiers that Parakeet
        // split into separate words (e.g. "use state" → "useState").
        // Merge custom_words + session glossary so clipboard-discovered
        // identifiers (e.g. `handleClick` → "handle click") are also recovered.
        let learned_result = if matches!(
            app_context.as_ref().map(|c| c.category),
            Some(crate::context_detector::AppContextCategory::Code)
        ) && (!settings.custom_words.is_empty()
            || !session_glossary_terms.is_empty())
        {
            let mut split_words = settings.custom_words.clone();
            split_words.extend(session_glossary_terms.iter().cloned());
            crate::vocabulary_store::apply_custom_word_splits(&learned_result, &split_words)
        } else {
            learned_result
        };

        let corrected_result = if !correction_terms.is_empty() {
            apply_custom_words(&learned_result, &correction_terms, correction_threshold)
        } else {
            learned_result
        };
        let corrected_result = if matches!(active_model_id.as_deref(), Some(id) if is_parakeet_v3_model_id(id))
        {
            let profile = if matches!(
                app_context.as_ref().map(|context| context.category),
                Some(crate::context_detector::AppContextCategory::Code)
            ) {
                ParakeetDomainProfile::General
            } else {
                ParakeetDomainProfile::Recruiting
            };
            finalize_parakeet_text_with_profile(
                &corrected_result,
                &settings.selected_language,
                profile,
            )
        } else {
            corrected_result
        };

        let filtered_result = Self::filter_transcription_output_for_context(
            corrected_result,
            active_model_id.as_deref(),
            app_context.as_ref(),
        );

        let et = std::time::Instant::now();
        let translation_note = if settings.translate_to_english {
            " (translated)"
        } else {
            ""
        };
        info!(
            "Transcription completed in {}ms{}",
            (et - st).as_millis(),
            translation_note
        );

        let final_result = filtered_result;

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            info!(
                "Transcription result [{}]: {}",
                app_context
                    .as_ref()
                    .map(|context| format!("{:?}", context.category))
                    .unwrap_or_else(|| "Unknown".to_string()),
                final_result
            );
        }

        self.maybe_unload_immediately("transcription");

        let confidence_payload = result
            .segments
            .as_ref()
            .and_then(|segments| build_whisper_confidence_payload(segments, &final_result));

        // Keep word-level segments for Parakeet V3 so the chunking worker can
        // trim the overlap prefix by timestamp (avoids text-dedup fragility).
        // For all other engines segments are used only for confidence and are
        // consumed above, so we pass them through as-is.
        let timed_segments = result.segments;

        Ok(TranscriptionOutput {
            text: final_result,
            confidence_payload,
            segments: timed_segments,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
    use crate::parakeet_text::{finalize_parakeet_text, normalize_parakeet_phrase_variants};
    use crate::session_keyterms::build_session_keyterms;

    #[test]
    fn boosts_low_energy_parakeet_audio_when_needed() {
        let samples = vec![0.01_f32; 16_000];
        let boosted = maybe_boost_low_energy_parakeet_audio(&samples)
            .expect("low-energy audio should be boosted");
        assert!(boosted.1 > 1.0);
        let (rms_before, _) = audio_rms_and_peak(&samples);
        let (rms_after, _) = audio_rms_and_peak(&boosted.0);
        assert!(rms_after > rms_before);
    }

    #[test]
    fn skips_boost_for_normal_energy_audio() {
        let samples = vec![0.08_f32; 16_000];
        assert!(maybe_boost_low_energy_parakeet_audio(&samples).is_none());
    }

    #[test]
    fn normalizes_parakeet_phrase_variants() {
        let text =
            "Today I tested Parakate V tree inside Vocaltype and pushed to Git Hub for Open AI.";
        let normalized = normalize_parakeet_phrase_variants(text, "en");
        assert!(normalized.contains("Parakeet V3"));
        assert!(normalized.contains("Vocalype"));
        assert!(normalized.contains("GitHub"));
        assert!(normalized.contains("OpenAI"));
    }

    #[test]
    fn finalizes_parakeet_tail_and_email_artifacts() {
        assert_eq!(
            finalize_parakeet_text("Today I finished the meeting. and", "en"),
            "Today I finished the meeting."
        );
        assert_eq!(
            finalize_parakeet_text(
                "My email is alex .martin at example .com and the document lives on docks dot call vocal.",
                "en",
            ),
            "My email is alex dot martin at example dot com and the document lives on docs dot vocalype dot app slash release notes."
        );
    }

    #[test]
    fn session_keyterms_flow_into_parakeet_corrections() {
        let context = AppTranscriptionContext {
            process_name: Some("Code.exe".to_string()),
            window_title: Some("VocalypeSpeech.tsx - GitHub".to_string()),
            category: AppContextCategory::Code,
            code_language: None,
            detected_at_ms: 1,
        };
        let session_keyterms = build_session_keyterms(
            Some(&context),
            "en",
            &["Parakeet V3".to_string()],
            &["Yassine".to_string()],
            &["Vocalype".to_string()],
        );
        let mut settings = crate::settings::get_default_settings();
        settings.selected_language = "en".to_string();

        let corrections = build_correction_terms(
            &settings,
            &session_keyterms.terms,
            &[],
            Some("parakeet-tdt-0.6b-v3-multilingual"),
            ParakeetDomainProfile::General,
        );

        assert!(corrections.iter().any(|term| term == "Parakeet V3"));
        assert!(corrections.iter().any(|term| term == "Yassine"));
        assert!(corrections.iter().any(|term| term == "Vocalype"));
    }

    #[test]
    fn sentence_rescue_prefers_short_or_small_outputs() {
        assert!(should_attempt_parakeet_sentence_rescue(
            "this is a short sentence without punctuation",
            true,
        ));
        assert!(should_attempt_parakeet_sentence_rescue(
            "this is still a fairly small output without punctuation",
            false,
        ));
        assert!(!should_attempt_parakeet_sentence_rescue(
            "this is a longer transcription output that keeps going across many words and should not trigger a second sentence mode rescue pass because the latency cost is no longer worth it",
            false,
        ));
    }

    #[test]
    fn recruiting_profile_excludes_session_glossary_terms() {
        let mut settings = crate::settings::get_default_settings();
        settings.selected_language = "en".to_string();

        let corrections = build_correction_terms(
            &settings,
            &[],
            &["useState".to_string(), "handleClick".to_string()],
            Some("parakeet-tdt-0.6b-v3-multilingual"),
            ParakeetDomainProfile::Recruiting,
        );

        assert!(!corrections.iter().any(|term| term == "useState"));
        assert!(!corrections.iter().any(|term| term == "handleClick"));
        assert!(corrections.iter().any(|term| term == "Vocalype"));
    }
}

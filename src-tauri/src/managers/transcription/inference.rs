use super::*;

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
            current_voice_profile(&self.app_handle)
        } else {
            None
        };
        let voice_terms: Vec<String> = voice_profile
            .as_ref()
            .map(|profile: &VoiceProfile| profile.preferred_terms.clone())
            .unwrap_or_default();
        let initial_prompt = if settings.adaptive_vocabulary_enabled
            || (settings.adaptive_voice_profile_enabled && !voice_terms.is_empty())
        {
            if let Some(state) = self.app_handle.try_state::<VocabularyStoreState>() {
                if let Ok(store) = state.0.lock() {
                    build_whisper_initial_prompt(
                        &settings,
                        app_context.as_ref(),
                        &store,
                        &voice_terms,
                    )
                } else {
                    None
                }
            } else {
                build_whisper_initial_prompt(
                    &settings,
                    app_context.as_ref(),
                    &crate::vocabulary_store::VocabularyStore::default(),
                    &voice_terms,
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
                        let params = ParakeetInferenceParams {
                            timestamp_granularity: TimestampGranularity::Segment,
                            ..Default::default()
                        };
                        parakeet_engine
                            .transcribe_samples(audio, Some(params))
                            .map(|result| EngineTranscriptionResult {
                                text: result.text,
                                segments: None,
                            })
                            .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))
                    }
                    LoadedEngine::ParakeetV3(parakeet_engine) => parakeet_engine
                        .transcribe_samples(
                            audio.clone(),
                            16_000,
                            1,
                            Some(ParakeetTimestampMode::Sentences),
                        )
                        .or_else(|sentence_err| {
                            debug!(
                                "Parakeet V3 sentence-mode decode failed, retrying with word mode: {}",
                                sentence_err
                            );
                            parakeet_engine.transcribe_samples(
                                audio,
                                16_000,
                                1,
                                Some(ParakeetTimestampMode::Words),
                            )
                        })
                        .map(|result| EngineTranscriptionResult {
                            text: result.text,
                            segments: None,
                        })
                        .map_err(|e| anyhow::anyhow!("Parakeet V3 transcription failed: {}", e)),
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
                            .map_err(|e| anyhow::anyhow!("SenseVoice transcription failed: {}", e))
                    }
                    LoadedEngine::GeminiApi => {
                        unreachable!("GeminiApi handled before catch_unwind")
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
        let corrected_result = if !settings.custom_words.is_empty() {
            apply_custom_words(
                &raw_result,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            raw_result
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

        Ok(TranscriptionOutput {
            text: final_result,
            confidence_payload,
        })
    }
}

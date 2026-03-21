use super::*;

impl TranscriptionManager {
    pub fn load_model(&self, model_id: &str) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        if self.get_current_model().as_deref() == Some(model_id) && self.is_model_loaded() {
            debug!("Model {} is already loaded, skipping reload", model_id);
            return Ok(());
        }

        if self.is_model_loaded() {
            self.unload_model()?;
        }

        // Emit loading started event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_started".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: None,
                error: None,
            },
        );

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            let error_msg = "Model not downloaded";
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: "loading_failed".to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error: Some(error_msg.to_string()),
                },
            );
            return Err(anyhow::anyhow!(error_msg));
        }

        let model_path = if matches!(model_info.engine_type, EngineType::GeminiApi) {
            std::path::PathBuf::new()
        } else {
            self.model_manager.get_model_path(model_id)?
        };

        // Create appropriate engine based on model type
        let loaded_engine = match model_info.engine_type {
            EngineType::Whisper => {
                let mut engine = WhisperEngine::new();
                let model_params = self.whisper_model_params(model_id);
                let use_gpu = model_params.use_gpu;
                let preferred_backend = if use_gpu {
                    #[cfg(target_os = "windows")]
                    {
                        "Vulkan"
                    }
                    #[cfg(target_os = "macos")]
                    {
                        "Metal"
                    }
                    #[cfg(target_os = "linux")]
                    {
                        "Vulkan"
                    }
                    #[cfg(not(any(
                        target_os = "windows",
                        target_os = "macos",
                        target_os = "linux"
                    )))]
                    {
                        "CPU"
                    }
                } else {
                    "CPU"
                };
                info!(
                    "Loading Whisper model '{}' — preferred backend: {} (use_gpu={})",
                    model_id, preferred_backend, model_params.use_gpu
                );
                let load_result = engine.load_model_with_params(&model_path, model_params);
                match load_result {
                    Ok(()) => {
                        self.whisper_gpu_active.store(use_gpu, Ordering::Relaxed);
                        set_active_whisper_backend(
                            &self.app_handle,
                            model_id,
                            if use_gpu {
                                WhisperBackendPreference::Gpu
                            } else {
                                WhisperBackendPreference::Cpu
                            },
                            Some(format!("loaded on preferred {} backend", preferred_backend)),
                        );
                    }
                    Err(ref e) if use_gpu => {
                        warn!(
                            "Preferred Whisper backend ({}) init failed for '{}': {}. Retrying with CPU fallback.",
                            preferred_backend, model_id, e
                        );
                        let cpu_params = WhisperModelParams {
                            use_gpu: false,
                            flash_attn: false,
                        };
                        engine
                            .load_model_with_params(&model_path, cpu_params)
                            .map_err(|e2| {
                                let error_msg =
                                    format!("Failed to load whisper model {}: {}", model_id, e2);
                                let _ = self.app_handle.emit(
                                    "model-state-changed",
                                    ModelStateEvent {
                                        event_type: "loading_failed".to_string(),
                                        model_id: Some(model_id.to_string()),
                                        model_name: Some(model_info.name.clone()),
                                        error: Some(error_msg.clone()),
                                    },
                                );
                                anyhow::anyhow!(error_msg)
                            })?;
                        let _ = self
                            .app_handle
                            .emit("whisper-gpu-unavailable", model_id.to_string());
                        self.whisper_gpu_active.store(false, Ordering::Relaxed);
                        record_whisper_backend_failure(
                            &self.app_handle,
                            model_id,
                            WhisperBackendPreference::Gpu,
                            format!("gpu backend init failed: {}", e),
                            7 * 24 * 60 * 60 * 1000,
                        );
                        set_active_whisper_backend(
                            &self.app_handle,
                            model_id,
                            WhisperBackendPreference::Cpu,
                            Some("gpu backend failed; cpu fallback applied".to_string()),
                        );
                        warn!(
                            "Whisper '{}' loaded on CPU — transcription will be slow. Consider switching to Parakeet V3.",
                            model_id
                        );
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to load whisper model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        return Err(anyhow::anyhow!(error_msg));
                    }
                }
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                if is_parakeet_v3_model_id(model_id) {
                    let provider_candidates = parakeet_v3_provider_candidates(&self.app_handle);
                    let mut last_error = None;
                    let mut loaded_engine = None;

                    for provider in provider_candidates {
                        let provider_label = parakeet_provider_label(provider);
                        info!(
                            "Attempting to load Parakeet V3 '{}' with provider {}",
                            model_id, provider_label
                        );

                        match ParakeetTDT::from_pretrained(
                            &model_path,
                            Some(parakeet_v3_execution_config(provider)),
                        ) {
                            Ok(engine) => {
                                info!(
                                    "Loaded Parakeet V3 '{}' with provider {}",
                                    model_id, provider_label
                                );
                                loaded_engine = Some(engine);
                                break;
                            }
                            Err(err) => {
                                warn!(
                                    "Parakeet V3 provider {} failed for '{}': {}",
                                    provider_label, model_id, err
                                );
                                last_error =
                                    Some(format!("provider {} failed: {}", provider_label, err));
                            }
                        }
                    }

                    let engine = loaded_engine.ok_or_else(|| {
                        let error_msg = format!(
                            "Failed to load Parakeet V3 model {}: {}",
                            model_id,
                            last_error.unwrap_or_else(|| "no provider succeeded".to_string())
                        );
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                    LoadedEngine::ParakeetV3(engine)
                } else {
                    let mut engine = TranscribeParakeetEngine::new();
                    engine
                        .load_model_with_params(&model_path, ParakeetModelParams::int8())
                        .map_err(|e| {
                            let error_msg =
                                format!("Failed to load parakeet model {}: {}", model_id, e);
                            let _ = self.app_handle.emit(
                                "model-state-changed",
                                ModelStateEvent {
                                    event_type: "loading_failed".to_string(),
                                    model_id: Some(model_id.to_string()),
                                    model_name: Some(model_info.name.clone()),
                                    error: Some(error_msg.clone()),
                                },
                            );
                            anyhow::anyhow!(error_msg)
                        })?;
                    LoadedEngine::Parakeet(engine)
                }
            }
            EngineType::Moonshine => {
                let mut engine = MoonshineEngine::new();
                engine
                    .load_model_with_params(
                        &model_path,
                        MoonshineModelParams::variant(ModelVariant::Base),
                    )
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load moonshine model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::MoonshineStreaming => {
                let mut engine = MoonshineStreamingEngine::new();
                engine
                    .load_model_with_params(&model_path, StreamingModelParams::default())
                    .map_err(|e| {
                        let error_msg = format!(
                            "Failed to load moonshine streaming model {}: {}",
                            model_id, e
                        );
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::MoonshineStreaming(engine)
            }
            EngineType::SenseVoice => {
                let mut engine = SenseVoiceEngine::new();
                engine
                    .load_model_with_params(&model_path, SenseVoiceModelParams::int8())
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load SenseVoice model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::SenseVoice(engine)
            }
            EngineType::GeminiApi => {
                let settings = get_settings(&self.app_handle);
                if settings.gemini_api_key.is_none()
                    || settings
                        .gemini_api_key
                        .as_ref()
                        .map_or(true, |k| k.is_empty())
                {
                    let error_msg = "Gemini API key not configured";
                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(model_id.to_string()),
                            model_name: Some(model_info.name.clone()),
                            error: Some(error_msg.to_string()),
                        },
                    );
                    return Err(anyhow::anyhow!(error_msg));
                }
                LoadedEngine::GeminiApi
            }
        };

        // Update the current engine and model ID
        {
            let mut engine = self.lock_engine();
            *engine = Some(loaded_engine);
        }
        {
            let mut current_model = self.current_model_id.lock();
            *current_model = Some(model_id.to_string());
        }
        set_active_runtime_model(&self.app_handle, Some(model_id.to_string()));

        // Emit loading completed event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_completed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }
}

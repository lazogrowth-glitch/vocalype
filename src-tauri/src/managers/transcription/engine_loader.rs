use super::*;
use crate::managers::model::ModelInfo;

impl TranscriptionManager {
    fn local_parakeet_backbone_candidates(
        &self,
        model_id: &str,
    ) -> Vec<(&'static str, std::path::PathBuf)> {
        if !is_parakeet_v3_model_id(model_id) {
            return Vec::new();
        }

        let settings = get_settings(&self.app_handle);
        let language = settings.selected_language.trim().to_ascii_lowercase();
        let root = std::path::PathBuf::from(r"C:\developer\sas");
        let default_backbone = root
            .join("quant-sweeps")
            .join("encoder-quint8-attn-proj-outonly-late12");
        let english_backbone = root
            .join("quant-sweeps")
            .join("encoder-quint8-attn-proj-perchannel");
        match language.as_str() {
            "en" => vec![
                ("english-perchannel", english_backbone),
                ("default-late12", default_backbone),
            ],
            "fr" | "es" | "auto" => vec![("default-late12", default_backbone)],
            _ => vec![("default-late12", default_backbone)],
        }
    }

    fn parakeet_backbone_is_usable(path: &std::path::Path) -> bool {
        [
            "decoder_joint-model.int8.onnx",
            "encoder-model.onnx",
            "nemo128.onnx",
            "vocab.txt",
        ]
        .iter()
        .all(|name| path.join(name).exists())
    }

    fn resolve_runtime_model_path(
        &self,
        model_id: &str,
        _model_info: &ModelInfo,
    ) -> Result<(std::path::PathBuf, Option<String>)> {
        if is_parakeet_v3_model_id(model_id) {
            for (label, candidate) in self.local_parakeet_backbone_candidates(model_id) {
                if Self::parakeet_backbone_is_usable(&candidate) {
                    return Ok((candidate, Some(label.to_string())));
                }
            }
        }

        Ok((self.model_manager.get_model_path(model_id)?, None))
    }

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

        let (model_path, backbone_label) =
            self.resolve_runtime_model_path(model_id, &model_info)?;
        if let Some(label) = backbone_label.as_deref() {
            info!(
                "Routing Parakeet V3 '{}' to backbone '{}' at {}",
                model_id,
                label,
                model_path.display()
            );
        }

        // Create appropriate engine based on model type
        let loaded_engine = match model_info.engine_type {
            EngineType::Parakeet => {
                if is_parakeet_v3_model_id(model_id) {
                    let provider_candidates = parakeet_v3_provider_candidates(&self.app_handle);
                    let mut last_error = None;
                    let mut loaded_engine = None;

                    // Cache pre-optimized ONNX sessions in AppData to skip the
                    // Level3 graph optimization on subsequent launches (~2-3s → ~300ms).
                    let ort_cache_dir = self
                        .app_handle
                        .path()
                        .app_data_dir()
                        .ok()
                        .map(|d| d.join("cache").join("parakeet").join(model_id));

                    for provider in provider_candidates {
                        let provider_label = parakeet_provider_label(provider);
                        info!(
                            "Attempting to load Parakeet V3 '{}' with provider {}",
                            model_id, provider_label
                        );

                        match ParakeetTDT::from_pretrained_with_cache(
                            &model_path,
                            Some(parakeet_v3_execution_config(provider)),
                            ort_cache_dir.as_deref(),
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

use super::*;
use crate::managers::model::ModelInfo;
use std::path::{Path, PathBuf};

const PARAKEET_STATEFUL_EXPERIMENT_ENABLED: bool = false;

fn parakeet_stateful_required_files_present(path: &Path) -> bool {
    path.join("encoder.onnx").exists()
        && path.join("decoder_joint.onnx").exists()
        && path.join("tokenizer.json").exists()
}

fn parakeet_stateful_candidate_paths(model_path: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![model_path.to_path_buf(), model_path.join("eou")];

    if let Some(parent) = model_path.parent() {
        candidates.push(parent.join("parakeet-eou"));
        candidates.push(parent.join("parakeet-realtime-eou"));
        candidates.push(parent.join("parakeet-rnnt-eou"));
    }

    candidates.dedup();
    candidates
}

fn find_parakeet_stateful_model_path(model_path: &Path) -> Option<PathBuf> {
    parakeet_stateful_candidate_paths(model_path)
        .into_iter()
        .find(|candidate| parakeet_stateful_required_files_present(candidate))
}

fn load_parakeet_stateful_runtime(
    app_handle: &AppHandle,
    model_path: &Path,
    providers: &[ParakeetExecutionProvider],
) -> (Option<ParakeetStatefulRuntime>, ParakeetStatefulStatus) {
    if !PARAKEET_STATEFUL_EXPERIMENT_ENABLED {
        return (None, ParakeetStatefulStatus::Disabled);
    }

    let settings = get_settings(app_handle);
    if !settings.experimental_enabled || !settings.parakeet_stateful_streaming_enabled {
        return (None, ParakeetStatefulStatus::Disabled);
    }

    let Some(stateful_path) = find_parakeet_stateful_model_path(model_path) else {
        info!(
            "[parakeet-stateful] experimental path enabled but no EOU model files were found near {}",
            model_path.display()
        );
        return (None, ParakeetStatefulStatus::MissingModelFiles);
    };

    let mut last_error = None;
    for provider in providers {
        let provider_label = parakeet_provider_label(*provider);
        info!(
            "[parakeet-stateful] attempting EOU runtime at {} with provider {}",
            stateful_path.display(),
            provider_label
        );

        match ParakeetEOU::from_pretrained(
            &stateful_path,
            Some(parakeet_v3_execution_config(*provider)),
        ) {
            Ok(engine) => {
                info!(
                    "[parakeet-stateful] loaded EOU runtime with provider {}",
                    provider_label
                );
                return (
                    Some(ParakeetStatefulRuntime::new(engine)),
                    ParakeetStatefulStatus::Ready {
                        model_path: stateful_path,
                    },
                );
            }
            Err(err) => {
                warn!(
                    "[parakeet-stateful] provider {} failed for EOU runtime: {}",
                    provider_label, err
                );
                last_error = Some(format!("provider {} failed: {}", provider_label, err));
            }
        }
    }

    (
        None,
        ParakeetStatefulStatus::LoadFailed(
            last_error.unwrap_or_else(|| "no provider succeeded".to_string()),
        ),
    )
}

impl TranscriptionManager {
    fn resolve_runtime_model_path(
        &self,
        model_id: &str,
        _model_info: &ModelInfo,
    ) -> Result<(std::path::PathBuf, Option<String>)> {
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

                for provider in provider_candidates.iter().copied() {
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
                let (stateful, stateful_status) = load_parakeet_stateful_runtime(
                    &self.app_handle,
                    &model_path,
                    &provider_candidates,
                );

                LoadedEngine::ParakeetV3(ParakeetV3Runtime::new(engine, stateful, stateful_status))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detects_complete_stateful_model_files() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("encoder.onnx"), b"encoder").unwrap();
        fs::write(temp.path().join("decoder_joint.onnx"), b"decoder").unwrap();
        fs::write(temp.path().join("tokenizer.json"), b"{}").unwrap();

        assert!(parakeet_stateful_required_files_present(temp.path()));
    }

    #[test]
    fn rejects_incomplete_stateful_model_files() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("encoder.onnx"), b"encoder").unwrap();
        fs::write(temp.path().join("decoder_joint.onnx"), b"decoder").unwrap();

        assert!(!parakeet_stateful_required_files_present(temp.path()));
    }

    #[test]
    fn searches_sibling_stateful_model_directories() {
        let temp = tempfile::tempdir().unwrap();
        let tdt_path = temp.path().join("parakeet-tdt-0.6b-v3-int8");
        let eou_path = temp.path().join("parakeet-eou");
        fs::create_dir_all(&tdt_path).unwrap();
        fs::create_dir_all(&eou_path).unwrap();
        fs::write(eou_path.join("encoder.onnx"), b"encoder").unwrap();
        fs::write(eou_path.join("decoder_joint.onnx"), b"decoder").unwrap();
        fs::write(eou_path.join("tokenizer.json"), b"{}").unwrap();

        assert_eq!(find_parakeet_stateful_model_path(&tdt_path), Some(eou_path));
    }
}

use crate::managers::model_catalog;
use crate::model_ids::{
    PARAKEET_V3_ENGLISH_ID, PARAKEET_V3_LEGACY_ID, PARAKEET_V3_MULTILINGUAL_ID,
};
use crate::settings::{get_settings, write_settings};
use anyhow::Result;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};

const SEALED_MODEL_EXTENSION: &str = ".vtenc";
const SEALED_ARCHIVE_EXTENSION: &str = ".vtbundle";
const PARAKEET_V3_REQUIRED_FILES: &[(&str, u64)] = &[
    ("encoder-model.int8.onnx", 100_000_000),
    ("decoder_joint-model.int8.onnx", 1_000_000),
    ("nemo128.onnx", 10_000),
    ("vocab.txt", 10_000),
    ("config.json", 10),
];

fn is_parakeet_v3_family(model_id: &str) -> bool {
    matches!(
        model_id,
        PARAKEET_V3_LEGACY_ID | PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_MULTILINGUAL_ID
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum EngineType {
    Whisper,
    Parakeet,
    Moonshine,
    MoonshineStreaming,
    SenseVoice,
    GeminiApi,
    GroqWhisper,
    MistralVoxtral,
    Deepgram,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub filename: String,
    pub url: Option<String>,
    pub expected_etag: Option<String>,
    pub size_mb: u64,
    pub is_downloaded: bool,
    pub is_downloading: bool,
    pub partial_size: u64,
    pub is_directory: bool,
    pub engine_type: EngineType,
    pub accuracy_score: f32,        // 0.0 to 1.0, higher is more accurate
    pub speed_score: f32,           // 0.0 to 1.0, higher is faster
    pub supports_translation: bool, // Whether the model supports translating to English
    pub is_recommended: bool,       // Whether this is the recommended model for new users
    pub supported_languages: Vec<String>, // Languages this model can transcribe
    pub is_custom: bool,            // Whether this is a user-provided custom model
    pub requires_license_key: bool, // Whether model bytes are sealed at rest behind premium license
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

pub struct ModelManager {
    app_handle: AppHandle,
    models_dir: PathBuf,
    runtime_cache_dir: PathBuf,
    available_models: Mutex<HashMap<String, ModelInfo>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    extracting_models: Arc<Mutex<HashSet<String>>>,
}

impl ModelManager {
    fn sealed_path_for_model(&self, model_info: &ModelInfo) -> PathBuf {
        let suffix = if model_info.is_directory {
            SEALED_ARCHIVE_EXTENSION
        } else {
            SEALED_MODEL_EXTENSION
        };
        self.models_dir
            .join(format!("{}{}", &model_info.filename, suffix))
    }

    fn runtime_cache_path_for_model(&self, model_info: &ModelInfo) -> PathBuf {
        self.runtime_cache_dir.join(&model_info.filename)
    }

    fn model_requires_sealing(model_info: &ModelInfo) -> bool {
        model_info.requires_license_key
            && !model_info.is_custom
            && !matches!(model_info.engine_type, EngineType::GeminiApi)
    }

    fn verify_response_etag(model_info: &ModelInfo, response: &reqwest::Response) -> Result<()> {
        let Some(expected_etag) = model_info.expected_etag.as_deref() else {
            return Ok(());
        };

        let actual_etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| anyhow::anyhow!("Missing ETag header for {}", model_info.id))?;

        if actual_etag.trim() != expected_etag {
            anyhow::bail!(
                "ETag mismatch for {}: expected {}, got {}",
                model_info.id,
                expected_etag,
                actual_etag
            );
        }

        Ok(())
    }

    fn extract_archive_safely(
        archive: &mut Archive<GzDecoder<File>>,
        destination: &Path,
    ) -> Result<()> {
        for entry_result in archive.entries()? {
            let mut entry = entry_result?;
            let entry_path = entry.path()?.into_owned();

            if entry_path.as_os_str().is_empty() {
                continue;
            }

            if !entry_path
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
            {
                anyhow::bail!("archive contains an unsafe path '{}'", entry_path.display());
            }

            let entry_type = entry.header().entry_type();
            if entry_type.is_symlink() || entry_type.is_hard_link() {
                anyhow::bail!(
                    "archive contains unsupported link entry '{}'",
                    entry_path.display()
                );
            }

            if !entry.unpack_in(destination)? {
                anyhow::bail!(
                    "archive entry escaped extraction directory '{}'",
                    entry_path.display()
                );
            }
        }

        Ok(())
    }

    fn recommended_model_ids_from_settings(settings: &crate::settings::AppSettings) -> Vec<String> {
        let mut ids = Vec::new();
        if let Some(profile) = settings.adaptive_machine_profile.as_ref() {
            ids.push(profile.recommended_model_id.clone());
            if let Some(secondary) = profile.secondary_model_id.as_ref() {
                ids.push(secondary.clone());
            }
        }
        ids
    }

    fn required_files_for_directory_model(
        model_id: &str,
    ) -> Option<&'static [(&'static str, u64)]> {
        if is_parakeet_v3_family(model_id) {
            Some(PARAKEET_V3_REQUIRED_FILES)
        } else {
            None
        }
    }

    fn validate_directory_model_contents(&self, model_id: &str, model_dir: &Path) -> Result<()> {
        if !model_dir.exists() || !model_dir.is_dir() {
            anyhow::bail!("model directory does not exist: {}", model_dir.display());
        }

        if let Some(required_files) = Self::required_files_for_directory_model(model_id) {
            for (file_name, min_bytes) in required_files {
                let file_path = model_dir.join(file_name);
                if !file_path.exists() {
                    anyhow::bail!(
                        "missing required file '{}' in {}",
                        file_name,
                        model_dir.display()
                    );
                }

                let metadata = fs::metadata(&file_path)?;
                if !metadata.is_file() {
                    anyhow::bail!(
                        "required path '{}' is not a file in {}",
                        file_name,
                        model_dir.display()
                    );
                }

                if metadata.len() < *min_bytes {
                    anyhow::bail!(
                        "file '{}' is too small ({} bytes, expected at least {} bytes)",
                        file_name,
                        metadata.len(),
                        min_bytes
                    );
                }
            }
        }

        Ok(())
    }

    fn set_downloading_state_for_filename(&self, filename: &str, is_downloading: bool) {
        let mut models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for model in models.values_mut().filter(|m| m.filename == filename) {
            model.is_downloading = is_downloading;
        }
    }

    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create models directory in app data
        let models_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?
            .join("models");
        let runtime_cache_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?
            .join("model-runtime-cache");

        if !models_dir.exists() {
            fs::create_dir_all(&models_dir)?;
        }
        if runtime_cache_dir.exists() {
            let _ = fs::remove_dir_all(&runtime_cache_dir);
        }
        fs::create_dir_all(&runtime_cache_dir)?;

        let mut available_models = model_catalog::load_catalog(app_handle)?;

        // Auto-discover custom Whisper models (.bin files) in the models directory
        if let Err(e) = Self::discover_custom_whisper_models(&models_dir, &mut available_models) {
            warn!("Failed to discover custom models: {}", e);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            models_dir,
            runtime_cache_dir,
            available_models: Mutex::new(available_models),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            extracting_models: Arc::new(Mutex::new(HashSet::new())),
        };

        // Migrate any bundled models to user directory
        manager.migrate_bundled_models()?;

        // Check which models are already downloaded
        manager.update_download_status()?;

        // Auto-select a model if none is currently selected
        manager.auto_select_model_if_needed()?;

        Ok(manager)
    }

    pub fn get_available_models(&self) -> Vec<ModelInfo> {
        let settings = get_settings(&self.app_handle);
        let recommended_ids = Self::recommended_model_ids_from_settings(&settings);
        let models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        models
            .values()
            .filter(|m| m.id != PARAKEET_V3_LEGACY_ID)
            .cloned()
            .map(|mut model| {
                model.is_recommended = recommended_ids.iter().any(|id| id == &model.id);
                model
            })
            .collect()
    }

    pub fn get_model_info(&self, model_id: &str) -> Option<ModelInfo> {
        let models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        models.get(model_id).cloned()
    }

    fn migrate_bundled_models(&self) -> Result<()> {
        // Check for bundled models and copy them to user directory
        let bundled_models = ["ggml-small.bin"]; // Add other bundled models here if any

        for filename in &bundled_models {
            let bundled_path = self.app_handle.path().resolve(
                &format!("resources/models/{}", filename),
                tauri::path::BaseDirectory::Resource,
            );

            if let Ok(bundled_path) = bundled_path {
                if bundled_path.exists() {
                    let user_path = self.models_dir.join(filename);

                    // Only copy if user doesn't already have the model
                    if !user_path.exists() {
                        info!("Migrating bundled model {} to user directory", filename);
                        fs::copy(&bundled_path, &user_path)?;
                        info!("Successfully migrated {}", filename);
                    }
                }
            }
        }

        Ok(())
    }

    fn update_download_status(&self) -> Result<()> {
        let mut models = self
            .available_models
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        for model in models.values_mut() {
            if matches!(model.engine_type, EngineType::GeminiApi) {
                continue;
            }
            let sealed_path = self.sealed_path_for_model(model);
            if model.is_directory {
                // For directory-based models, check if the directory exists
                let model_path = self.models_dir.join(&model.filename);
                let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));
                let extracting_path = self
                    .models_dir
                    .join(format!("{}.extracting", &model.filename));

                // Clean up any leftover .extracting directories from interrupted extractions
                // But only if this model is NOT currently being extracted
                let is_currently_extracting = {
                    let extracting = self
                        .extracting_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    extracting.contains(&model.id)
                };
                if extracting_path.exists() && !is_currently_extracting {
                    warn!("Cleaning up interrupted extraction for model: {}", model.id);
                    let _ = fs::remove_dir_all(&extracting_path);
                }

                model.is_downloaded = if Self::model_requires_sealing(model) {
                    sealed_path.exists()
                        || (model_path.exists()
                            && model_path.is_dir()
                            && self
                                .validate_directory_model_contents(&model.id, &model_path)
                                .is_ok())
                } else {
                    model_path.exists()
                        && model_path.is_dir()
                        && self
                            .validate_directory_model_contents(&model.id, &model_path)
                            .is_ok()
                };
                model.is_downloading = false;

                // Get partial file size if it exists (for the .tar.gz being downloaded)
                if partial_path.exists() {
                    model.partial_size = partial_path.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    model.partial_size = 0;
                }
            } else {
                // For file-based models (existing logic)
                let model_path = self.models_dir.join(&model.filename);
                let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));

                model.is_downloaded = if Self::model_requires_sealing(model) {
                    sealed_path.exists() || model_path.exists()
                } else {
                    model_path.exists()
                };
                model.is_downloading = false;

                // Get partial file size if it exists
                if partial_path.exists() {
                    model.partial_size = partial_path.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    model.partial_size = 0;
                }
            }
        }

        Ok(())
    }

    fn write_directory_archive(&self, src_dir: &Path, archive_path: &Path) -> Result<()> {
        let archive_file = File::create(archive_path)?;
        let encoder = flate2::write::GzEncoder::new(archive_file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        builder.append_dir_all("payload", src_dir)?;
        let encoder = builder.into_inner()?;
        encoder.finish()?;
        Ok(())
    }

    fn seal_model_if_needed(&self, model_id: &str, model_info: &ModelInfo) -> Result<()> {
        if !Self::model_requires_sealing(model_info) {
            return Ok(());
        }

        let plain_path = self.models_dir.join(&model_info.filename);
        let sealed_path = self.sealed_path_for_model(model_info);
        if !plain_path.exists() || sealed_path.exists() {
            return Ok(());
        }

        let unlock_key =
            crate::license::current_model_unlock_key(&self.app_handle).map_err(|err| {
                anyhow::anyhow!("Cannot seal model without valid license key: {}", err)
            })?;
        let temp_sealed_path = sealed_path.with_extension("tmpseal");

        if model_info.is_directory {
            self.validate_directory_model_contents(model_id, &plain_path)?;
            let temp_archive_path = self
                .models_dir
                .join(format!("{}.seal.tar.gz", &model_info.filename));
            self.write_directory_archive(&plain_path, &temp_archive_path)?;
            crate::model_crypto::encrypt_file(&unlock_key, &temp_archive_path, &temp_sealed_path)?;
            let _ = fs::remove_file(&temp_archive_path);
            fs::rename(&temp_sealed_path, &sealed_path)?;
            fs::remove_dir_all(&plain_path)?;
        } else {
            crate::model_crypto::encrypt_file(&unlock_key, &plain_path, &temp_sealed_path)?;
            fs::rename(&temp_sealed_path, &sealed_path)?;
            fs::remove_file(&plain_path)?;
        }

        Ok(())
    }

    fn prepare_runtime_model_path(
        &self,
        model_id: &str,
        model_info: &ModelInfo,
    ) -> Result<PathBuf> {
        if !Self::model_requires_sealing(model_info) {
            let model_path = self.models_dir.join(&model_info.filename);
            if model_info.is_directory {
                self.validate_directory_model_contents(model_id, &model_path)?;
            }
            return Ok(model_path);
        }

        let plain_path = self.models_dir.join(&model_info.filename);
        if plain_path.exists() {
            self.seal_model_if_needed(model_id, model_info)?;
        }

        let sealed_path = self.sealed_path_for_model(model_info);
        if !sealed_path.exists() {
            anyhow::bail!("Protected model artifact not found for {}", model_id);
        }

        let unlock_key = crate::license::current_model_unlock_key(&self.app_handle)
            .map_err(|err| anyhow::anyhow!("Premium license required to unlock model: {}", err))?;
        let runtime_path = self.runtime_cache_path_for_model(model_info);

        if runtime_path.exists() {
            if model_info.is_directory {
                if self
                    .validate_directory_model_contents(model_id, &runtime_path)
                    .is_ok()
                {
                    return Ok(runtime_path);
                }
                let _ = fs::remove_dir_all(&runtime_path);
            } else {
                return Ok(runtime_path);
            }
        }

        if let Some(parent) = runtime_path.parent() {
            fs::create_dir_all(parent)?;
        }

        if model_info.is_directory {
            let temp_archive_path = self
                .runtime_cache_dir
                .join(format!("{}.runtime.tar.gz", &model_info.filename));
            crate::model_crypto::decrypt_file(&unlock_key, &sealed_path, &temp_archive_path)?;
            let temp_extract_root = self
                .runtime_cache_dir
                .join(format!("{}.runtime_extracting", &model_info.filename));
            if temp_extract_root.exists() {
                let _ = fs::remove_dir_all(&temp_extract_root);
            }
            fs::create_dir_all(&temp_extract_root)?;
            let tar_gz = File::open(&temp_archive_path)?;
            let tar = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(tar);
            Self::extract_archive_safely(&mut archive, &temp_extract_root)?;
            let _ = fs::remove_file(&temp_archive_path);
            let extracted_dirs: Vec<_> = fs::read_dir(&temp_extract_root)?
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                .collect();
            if extracted_dirs.len() == 1 {
                fs::rename(extracted_dirs[0].path(), &runtime_path)?;
                let _ = fs::remove_dir_all(&temp_extract_root);
            } else {
                fs::rename(&temp_extract_root, &runtime_path)?;
            }
            self.validate_directory_model_contents(model_id, &runtime_path)?;
        } else {
            crate::model_crypto::decrypt_file(&unlock_key, &sealed_path, &runtime_path)?;
        }

        Ok(runtime_path)
    }

    pub fn clear_runtime_cache_for_model(&self, model_id: &str) -> Result<()> {
        let Some(model_info) = self.get_model_info(model_id) else {
            return Ok(());
        };
        let runtime_path = self.runtime_cache_path_for_model(&model_info);
        if runtime_path.exists() {
            if model_info.is_directory {
                fs::remove_dir_all(&runtime_path)?;
            } else {
                fs::remove_file(&runtime_path)?;
            }
        }
        Ok(())
    }

    fn auto_select_model_if_needed(&self) -> Result<()> {
        let mut settings = get_settings(&self.app_handle);
        let mut settings_changed = false;

        if settings.selected_model == PARAKEET_V3_LEGACY_ID {
            settings.selected_model = PARAKEET_V3_MULTILINGUAL_ID.to_string();
            settings_changed = true;
        }

        if settings.long_audio_model.as_deref() == Some(PARAKEET_V3_LEGACY_ID) {
            settings.long_audio_model = Some(PARAKEET_V3_MULTILINGUAL_ID.to_string());
            settings_changed = true;
        }

        if settings_changed {
            write_settings(&self.app_handle, settings.clone());
        }

        // Clear stale selection: selected model is set but doesn't exist
        // in available_models (e.g. deleted custom model file)
        if !settings.selected_model.is_empty() {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let exists = models.contains_key(&settings.selected_model);
            drop(models);

            if !exists {
                info!(
                    "Selected model '{}' not found in available models, clearing selection",
                    settings.selected_model
                );
                settings.selected_model = String::new();
                write_settings(&self.app_handle, settings.clone());
            }
        }

        // If no model is selected, pick the first downloaded local model.
        // Gemini is cloud-only and should not be auto-selected.
        if settings.selected_model.is_empty() {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let recommended_ids = Self::recommended_model_ids_from_settings(&settings);
            let available_model = recommended_ids
                .iter()
                .find_map(|id| models.get(id))
                .filter(|model| model.is_downloaded)
                .or_else(|| {
                    models.values().find(|model| {
                        model.id != PARAKEET_V3_LEGACY_ID
                            && model.is_downloaded
                            && !matches!(model.engine_type, EngineType::GeminiApi)
                    })
                });

            if let Some(available_model) = available_model {
                info!(
                    "Auto-selecting model: {} ({})",
                    available_model.id, available_model.name
                );

                // Update settings with the selected model
                let mut updated_settings = settings;
                updated_settings.selected_model = available_model.id.clone();
                write_settings(&self.app_handle, updated_settings);

                info!("Successfully auto-selected model: {}", available_model.id);
            }
        }

        Ok(())
    }

    /// Discover custom Whisper models (.bin files) in the models directory.
    /// Skips files that match predefined model filenames.
    fn discover_custom_whisper_models(
        models_dir: &Path,
        available_models: &mut HashMap<String, ModelInfo>,
    ) -> Result<()> {
        if !models_dir.exists() {
            return Ok(());
        }

        // Collect filenames of predefined Whisper file-based models to skip
        let predefined_filenames: HashSet<String> = available_models
            .values()
            .filter(|m| matches!(m.engine_type, EngineType::Whisper) && !m.is_directory)
            .map(|m| m.filename.clone())
            .collect();

        // Scan models directory for .bin files
        for entry in fs::read_dir(models_dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    warn!("Failed to read directory entry: {}", e);
                    continue;
                }
            };

            let path = entry.path();

            // Only process .bin files (not directories)
            if !path.is_file() {
                continue;
            }

            let filename = match path.file_name().and_then(|s| s.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            // Skip hidden files
            if filename.starts_with('.') {
                continue;
            }

            // Only process .bin files (Whisper GGML format).
            // This also excludes .partial downloads (e.g., "model.bin.partial").
            // If we add discovery for other formats, add a .partial check before this filter.
            if !filename.ends_with(".bin") {
                continue;
            }

            // Skip predefined model files
            if predefined_filenames.contains(&filename) {
                continue;
            }

            // Generate model ID from filename (remove .bin extension)
            let model_id = filename.trim_end_matches(".bin").to_string();

            // Skip if model ID already exists (shouldn't happen, but be safe)
            if available_models.contains_key(&model_id) {
                continue;
            }

            // Generate display name: replace - and _ with space, capitalize words
            let display_name = model_id
                .replace(['-', '_'], " ")
                .split_whitespace()
                .map(|word| {
                    let mut chars = word.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");

            // Get file size in MB
            let size_mb = match path.metadata() {
                Ok(meta) => meta.len() / (1024 * 1024),
                Err(e) => {
                    warn!("Failed to get metadata for {}: {}", filename, e);
                    0
                }
            };

            info!(
                "Discovered custom Whisper model: {} ({}, {} MB)",
                model_id, filename, size_mb
            );

            available_models.insert(
                model_id.clone(),
                ModelInfo {
                    id: model_id,
                    name: display_name,
                    description: "Not officially supported".to_string(),
                    filename,
                    url: None, // Custom models have no download URL
                    expected_etag: None,
                    size_mb,
                    is_downloaded: true, // Already present on disk
                    is_downloading: false,
                    partial_size: 0,
                    is_directory: false,
                    engine_type: EngineType::Whisper,
                    accuracy_score: 0.0, // Sentinel: UI hides score bars when both are 0
                    speed_score: 0.0,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![],
                    is_custom: true,
                    requires_license_key: false,
                },
            );
        }

        Ok(())
    }

    pub async fn download_model(&self, model_id: &str) -> Result<()> {
        let model_info = {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if matches!(model_info.engine_type, EngineType::GeminiApi) {
            return Ok(());
        }

        let url = model_info
            .url
            .clone()
            .ok_or_else(|| anyhow::anyhow!("No download URL for model"))?;
        let model_path = self.models_dir.join(&model_info.filename);
        let sealed_path = self.sealed_path_for_model(&model_info);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        // Don't download if a complete and valid version already exists
        if sealed_path.exists() {
            if partial_path.exists() {
                let _ = fs::remove_file(&partial_path);
            }
            self.update_download_status()?;
            return Ok(());
        }

        if model_path.exists() {
            let existing_is_valid = if model_info.is_directory {
                self.validate_directory_model_contents(model_id, &model_path)
                    .is_ok()
            } else {
                true
            };

            if !existing_is_valid {
                warn!(
                    "Existing model files are invalid for '{}', removing and re-downloading",
                    model_id
                );
                if model_info.is_directory {
                    let _ = fs::remove_dir_all(&model_path);
                } else {
                    let _ = fs::remove_file(&model_path);
                }
            } else {
                // Clean up any partial file that might exist
                if partial_path.exists() {
                    let _ = fs::remove_file(&partial_path);
                }
                self.update_download_status()?;
                return Ok(());
            }

            // Clean up any partial file that might exist
            if partial_path.exists() {
                let _ = fs::remove_file(&partial_path);
            }
        }

        // Check if we have a partial download to resume
        let mut resume_from = if partial_path.exists() {
            let size = partial_path.metadata()?.len();
            info!("Resuming download of model {} from byte {}", model_id, size);
            size
        } else {
            info!("Starting fresh download of model {} from {}", model_id, url);
            0
        };

        // Mark all profile aliases sharing these files as downloading.
        self.set_downloading_state_for_filename(&model_info.filename, true);

        // Create cancellation flag for this download
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            flags.insert(model_id.to_string(), cancel_flag.clone());
        }

        // Create HTTP client with range request for resuming
        let client = reqwest::Client::new();
        let mut request = client.get(&url);

        if resume_from > 0 {
            request = request.header("Range", format!("bytes={}-", resume_from));
        }

        let mut response = request.send().await?;
        if let Err(err) = Self::verify_response_etag(&model_info, &response) {
            self.set_downloading_state_for_filename(&model_info.filename, false);
            let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            flags.remove(model_id);
            return Err(err);
        }

        // If we tried to resume but server returned 200 (not 206 Partial Content),
        // the server doesn't support range requests. Delete partial file and restart
        // fresh to avoid file corruption (appending full file to partial).
        if resume_from > 0 && response.status() == reqwest::StatusCode::OK {
            warn!(
                "Server doesn't support range requests for model {}, restarting download",
                model_id
            );
            drop(response);
            let _ = fs::remove_file(&partial_path);

            // Reset resume_from since we're starting fresh
            resume_from = 0;

            // Restart download without range header
            response = client.get(&url).send().await?;
            if let Err(err) = Self::verify_response_etag(&model_info, &response) {
                self.set_downloading_state_for_filename(&model_info.filename, false);
                let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
                flags.remove(model_id);
                return Err(err);
            }
        }

        // Check for success or partial content status
        if !response.status().is_success()
            && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        {
            // Mark as not downloading on error
            self.set_downloading_state_for_filename(&model_info.filename, false);
            return Err(anyhow::anyhow!(
                "Failed to download model: HTTP {}",
                response.status()
            ));
        }

        let total_size = if resume_from > 0 {
            // For resumed downloads, add the resume point to content length
            resume_from + response.content_length().unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };

        let mut downloaded = resume_from;
        let mut stream = response.bytes_stream();

        // Open file for appending if resuming, or create new if starting fresh
        let mut file = if resume_from > 0 {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&partial_path)?
        } else {
            std::fs::File::create(&partial_path)?
        };

        // Emit initial progress
        let initial_progress = DownloadProgress {
            model_id: model_id.to_string(),
            downloaded,
            total: total_size,
            percentage: if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            },
        };
        let _ = self
            .app_handle
            .emit("model-download-progress", &initial_progress);

        // Throttle progress events to max 10/sec (100ms intervals)
        let mut last_emit = Instant::now();
        let throttle_duration = Duration::from_millis(100);

        // Download with progress
        while let Some(chunk) = stream.next().await {
            // Check if download was cancelled
            if cancel_flag.load(Ordering::Relaxed) {
                // Close the file before returning
                drop(file);
                info!("Download cancelled for: {}", model_id);

                // Update state to mark as not downloading
                self.set_downloading_state_for_filename(&model_info.filename, false);

                // Remove cancel flag
                {
                    let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
                    flags.remove(model_id);
                }

                // Keep partial file for resume functionality
                return Ok(());
            }

            let chunk = chunk.map_err(|e| {
                // Mark as not downloading on error
                self.set_downloading_state_for_filename(&model_info.filename, false);
                e
            })?;

            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;

            let percentage = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };

            // Emit progress event (throttled to avoid UI freeze)
            if last_emit.elapsed() >= throttle_duration {
                let progress = DownloadProgress {
                    model_id: model_id.to_string(),
                    downloaded,
                    total: total_size,
                    percentage,
                };
                let _ = self.app_handle.emit("model-download-progress", &progress);
                last_emit = Instant::now();
            }
        }

        // Emit final progress to ensure 100% is shown
        let final_progress = DownloadProgress {
            model_id: model_id.to_string(),
            downloaded,
            total: total_size,
            percentage: if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                100.0
            },
        };
        let _ = self
            .app_handle
            .emit("model-download-progress", &final_progress);

        file.flush()?;
        drop(file); // Ensure file is closed before moving

        // Verify downloaded file size matches expected size
        if total_size > 0 {
            let actual_size = partial_path.metadata()?.len();
            if actual_size != total_size {
                // Download is incomplete/corrupted - delete partial and return error
                let _ = fs::remove_file(&partial_path);
                self.set_downloading_state_for_filename(&model_info.filename, false);
                return Err(anyhow::anyhow!(
                    "Download incomplete: expected {} bytes, got {} bytes",
                    total_size,
                    actual_size
                ));
            }
        }

        // Handle directory-based models (extract tar.gz) vs file-based models
        if model_info.is_directory {
            // Track that this model is being extracted
            {
                let mut extracting = self
                    .extracting_models
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                extracting.insert(model_id.to_string());
            }

            // Emit extraction started event
            let _ = self.app_handle.emit("model-extraction-started", model_id);
            info!("Extracting archive for directory-based model: {}", model_id);

            // Use a temporary extraction directory to ensure atomic operations
            let temp_extract_dir = self
                .models_dir
                .join(format!("{}.extracting", &model_info.filename));
            let final_model_dir = self.models_dir.join(&model_info.filename);

            // Clean up any previous incomplete extraction
            if temp_extract_dir.exists() {
                let _ = fs::remove_dir_all(&temp_extract_dir);
            }

            // Create temporary extraction directory
            fs::create_dir_all(&temp_extract_dir)?;

            // Open the downloaded tar.gz file
            let tar_gz = File::open(&partial_path)?;
            let tar = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(tar);

            // Extract to the temporary directory first
            Self::extract_archive_safely(&mut archive, &temp_extract_dir).map_err(|e| {
                let error_msg = format!("Failed to extract archive: {}", e);
                // Clean up failed extraction
                let _ = fs::remove_dir_all(&temp_extract_dir);
                self.set_downloading_state_for_filename(&model_info.filename, false);
                // Remove from extracting set
                {
                    let mut extracting = self
                        .extracting_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    extracting.remove(model_id);
                }
                let _ = self.app_handle.emit(
                    "model-extraction-failed",
                    &serde_json::json!({
                        "model_id": model_id,
                        "error": error_msg
                    }),
                );
                anyhow::anyhow!(error_msg)
            })?;

            // Find the actual extracted directory (archive might have a nested structure)
            let extracted_dirs: Vec<_> = fs::read_dir(&temp_extract_dir)?
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                .collect();

            if extracted_dirs.len() == 1 {
                // Single directory extracted, move it to the final location
                let source_dir = extracted_dirs[0].path();
                if final_model_dir.exists() {
                    fs::remove_dir_all(&final_model_dir)?;
                }
                fs::rename(&source_dir, &final_model_dir)?;
                // Clean up temp directory
                let _ = fs::remove_dir_all(&temp_extract_dir);
            } else {
                // Multiple items or no directories, rename the temp directory itself
                if final_model_dir.exists() {
                    fs::remove_dir_all(&final_model_dir)?;
                }
                fs::rename(&temp_extract_dir, &final_model_dir)?;
            }

            if let Err(e) = self.validate_directory_model_contents(model_id, &final_model_dir) {
                let error_msg = format!(
                    "Extracted model files are invalid for '{}': {}",
                    model_id, e
                );
                warn!("{}", error_msg);
                let _ = fs::remove_dir_all(&final_model_dir);
                let _ = fs::remove_dir_all(&temp_extract_dir);
                self.set_downloading_state_for_filename(&model_info.filename, false);
                {
                    let mut extracting = self
                        .extracting_models
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    extracting.remove(model_id);
                }
                let _ = self.app_handle.emit(
                    "model-extraction-failed",
                    &serde_json::json!({
                        "model_id": model_id,
                        "error": error_msg
                    }),
                );
                return Err(anyhow::anyhow!(error_msg));
            }

            info!("Successfully extracted archive for model: {}", model_id);
            // Remove from extracting set
            {
                let mut extracting = self
                    .extracting_models
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                extracting.remove(model_id);
            }
            // Emit extraction completed event
            let _ = self.app_handle.emit("model-extraction-completed", model_id);

            // Remove the downloaded tar.gz file
            let _ = fs::remove_file(&partial_path);
        } else {
            // Move partial file to final location for file-based models
            fs::rename(&partial_path, &model_path)?;
        }

        if Self::model_requires_sealing(&model_info) {
            self.seal_model_if_needed(model_id, &model_info)?;
        }

        // Refresh status for all models so profile aliases sharing the same
        // underlying files (e.g. Parakeet V3 English/Multilingual) stay in sync.
        self.update_download_status()?;

        // Remove cancel flag on successful completion
        {
            let mut flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            flags.remove(model_id);
        }

        // Emit completion event
        let _ = self.app_handle.emit("model-download-complete", model_id);

        info!(
            "Successfully downloaded model {} to {:?}",
            model_id, model_path
        );

        Ok(())
    }

    pub fn delete_model(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: delete_model called for: {}", model_id);

        let model_info = {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if matches!(model_info.engine_type, EngineType::GeminiApi) {
            return Err(anyhow::anyhow!("Cannot delete cloud model"));
        }

        debug!("ModelManager: Found model info: {:?}", model_info);

        let model_path = self.models_dir.join(&model_info.filename);
        let sealed_path = self.sealed_path_for_model(&model_info);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));
        debug!("ModelManager: Model path: {:?}", model_path);
        debug!("ModelManager: Partial path: {:?}", partial_path);

        let mut deleted_something = false;

        if model_info.is_directory {
            // Delete complete model directory if it exists
            if model_path.exists() && model_path.is_dir() {
                info!("Deleting model directory at: {:?}", model_path);
                fs::remove_dir_all(&model_path)?;
                info!("Model directory deleted successfully");
                deleted_something = true;
            }
        } else {
            // Delete complete model file if it exists
            if model_path.exists() {
                info!("Deleting model file at: {:?}", model_path);
                fs::remove_file(&model_path)?;
                info!("Model file deleted successfully");
                deleted_something = true;
            }
        }

        if sealed_path.exists() {
            info!("Deleting sealed model artifact at: {:?}", sealed_path);
            fs::remove_file(&sealed_path)?;
            deleted_something = true;
        }

        // Delete partial file if it exists (same for both types)
        if partial_path.exists() {
            info!("Deleting partial file at: {:?}", partial_path);
            fs::remove_file(&partial_path)?;
            info!("Partial file deleted successfully");
            deleted_something = true;
        }

        if !deleted_something {
            return Err(anyhow::anyhow!("No model files found to delete"));
        }

        let _ = self.clear_runtime_cache_for_model(model_id);

        // Custom models should be removed from the list entirely since they
        // have no download URL and can't be re-downloaded
        if model_info.is_custom {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.remove(model_id);
            debug!("ModelManager: removed custom model from available models");
        } else {
            // Update download status (marks predefined models as not downloaded)
            self.update_download_status()?;
            debug!("ModelManager: download status updated");
        }

        // Emit event to notify UI
        let _ = self.app_handle.emit("model-deleted", model_id);

        Ok(())
    }

    pub fn get_model_path(&self, model_id: &str) -> Result<PathBuf> {
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if matches!(model_info.engine_type, EngineType::GeminiApi) {
            return Err(anyhow::anyhow!(
                "Cloud model has no local path: {}",
                model_id
            ));
        }

        if !model_info.is_downloaded {
            return Err(anyhow::anyhow!("Model not available: {}", model_id));
        }

        // Ensure we don't return partial files/directories
        if model_info.is_downloading {
            return Err(anyhow::anyhow!(
                "Model is currently downloading: {}",
                model_id
            ));
        }

        let model_path = self.models_dir.join(&model_info.filename);
        let sealed_path = self.sealed_path_for_model(&model_info);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        if Self::model_requires_sealing(&model_info) {
            if sealed_path.exists() || model_path.exists() {
                return self.prepare_runtime_model_path(model_id, &model_info);
            }
        }

        if model_info.is_directory {
            // For directory-based models, ensure the directory exists and is complete
            if model_path.exists() && model_path.is_dir() && !partial_path.exists() {
                self.validate_directory_model_contents(model_id, &model_path)
                    .map_err(|e| anyhow::anyhow!("Model directory is incomplete: {}", e))?;
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model directory not found: {}",
                    model_id
                ))
            }
        } else {
            // For file-based models (existing logic)
            if model_path.exists() && !partial_path.exists() {
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model file not found: {}",
                    model_id
                ))
            }
        }
    }

    pub fn cancel_download(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: cancel_download called for: {}", model_id);
        let filename = {
            let models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            models.get(model_id).map(|m| m.filename.clone())
        };

        // Set the cancellation flag to stop the download loop
        {
            let flags = self.cancel_flags.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(flag) = flags.get(model_id) {
                flag.store(true, Ordering::Relaxed);
                info!("Cancellation flag set for: {}", model_id);
            } else {
                warn!("No active download found for: {}", model_id);
            }
        }

        // Update state immediately for UI responsiveness
        if let Some(filename) = filename {
            self.set_downloading_state_for_filename(&filename, false);
        } else {
            let mut models = self
                .available_models
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
            }
        }

        // Update download status to reflect current state
        self.update_download_status()?;

        // Emit cancellation event so all UI components can clear their state
        let _ = self.app_handle.emit("model-download-cancelled", model_id);

        info!("Download cancellation initiated for: {}", model_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::Write;
    use tar::Builder;
    use tempfile::TempDir;

    #[test]
    fn test_discover_custom_whisper_models() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().to_path_buf();

        // Create test .bin files
        let mut custom_file = File::create(models_dir.join("my-custom-model.bin")).unwrap();
        custom_file.write_all(b"fake model data").unwrap();

        let mut another_file = File::create(models_dir.join("whisper_medical_v2.bin")).unwrap();
        another_file.write_all(b"another fake model").unwrap();

        // Create files that should be ignored
        File::create(models_dir.join(".hidden-model.bin")).unwrap(); // Hidden file
        File::create(models_dir.join("readme.txt")).unwrap(); // Non-.bin file
        File::create(models_dir.join("ggml-small.bin")).unwrap(); // Predefined filename
        fs::create_dir(models_dir.join("some-directory.bin")).unwrap(); // Directory

        // Set up available_models with a predefined Whisper model
        let mut models = HashMap::new();
        models.insert(
            "small".to_string(),
            ModelInfo {
                id: "small".to_string(),
                name: "Whisper Small".to_string(),
                description: "Test".to_string(),
                filename: "ggml-small.bin".to_string(),
                url: Some("https://example.com".to_string()),
                expected_etag: None,
                size_mb: 100,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                is_directory: false,
                engine_type: EngineType::Whisper,
                accuracy_score: 0.5,
                speed_score: 0.5,
                supports_translation: true,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                is_custom: false,
                requires_license_key: true,
            },
        );

        // Discover custom models
        ModelManager::discover_custom_whisper_models(&models_dir, &mut models).unwrap();

        // Should have discovered 2 custom models (my-custom-model and whisper_medical_v2)
        assert!(models.contains_key("my-custom-model"));
        assert!(models.contains_key("whisper_medical_v2"));

        // Verify custom model properties
        let custom = models.get("my-custom-model").unwrap();
        assert_eq!(custom.name, "My Custom Model");
        assert_eq!(custom.filename, "my-custom-model.bin");
        assert!(custom.url.is_none()); // Custom models have no URL
        assert!(custom.is_downloaded);
        assert!(custom.is_custom);
        assert_eq!(custom.accuracy_score, 0.0);
        assert_eq!(custom.speed_score, 0.0);
        assert!(custom.supported_languages.is_empty());

        // Verify underscore handling
        let medical = models.get("whisper_medical_v2").unwrap();
        assert_eq!(medical.name, "Whisper Medical V2");

        // Should NOT have discovered hidden, non-.bin, predefined, or directories
        assert!(!models.contains_key(".hidden-model"));
        assert!(!models.contains_key("readme"));
        assert!(!models.contains_key("some-directory"));
    }

    #[test]
    fn test_discover_custom_models_empty_dir() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().to_path_buf();

        let mut models = HashMap::new();
        let count_before = models.len();

        ModelManager::discover_custom_whisper_models(&models_dir, &mut models).unwrap();

        // No new models should be added
        assert_eq!(models.len(), count_before);
    }

    #[test]
    fn test_discover_custom_models_nonexistent_dir() {
        let models_dir = PathBuf::from("/nonexistent/path/that/does/not/exist");

        let mut models = HashMap::new();
        let count_before = models.len();

        // Should not error, just return Ok
        let result = ModelManager::discover_custom_whisper_models(&models_dir, &mut models);
        assert!(result.is_ok());
        assert_eq!(models.len(), count_before);
    }

    #[test]
    fn extract_archive_safely_rejects_symlink_entries() {
        let temp_dir = TempDir::new().unwrap();
        let archive_path = temp_dir.path().join("unsafe.tar.gz");
        let destination = temp_dir.path().join("extract");
        fs::create_dir_all(&destination).unwrap();

        let archive_file = File::create(&archive_path).unwrap();
        let encoder = GzEncoder::new(archive_file, Compression::default());
        let mut builder = Builder::new(encoder);

        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header.set_cksum();
        builder
            .append_link(&mut header, "model-link", "outside-target")
            .unwrap();
        let encoder = builder.into_inner().unwrap();
        encoder.finish().unwrap();

        let archive_file = File::open(&archive_path).unwrap();
        let decoder = GzDecoder::new(archive_file);
        let mut archive = Archive::new(decoder);

        let err = ModelManager::extract_archive_safely(&mut archive, &destination).unwrap_err();
        assert!(err.to_string().contains("unsupported link entry"));
        assert!(!destination.join("model-link").exists());
    }
}

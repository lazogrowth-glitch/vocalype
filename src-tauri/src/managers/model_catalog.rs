use super::model::{EngineType, ModelInfo};
use anyhow::{anyhow, bail, Result};
use log::warn;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

pub const DEFAULT_MODEL_ASSET_BASE_URL: &str = "https://assets.vocalype.com/models";
const MODEL_CATALOG_RESOURCE_PATH: &str = "resources/model_catalog.json";
const FALLBACK_MODEL_CATALOG_JSON: &str = include_str!("../../resources/model_catalog.json");

#[derive(Debug, Deserialize)]
struct RawModelCatalog {
    version: u32,
    language_sets: HashMap<String, Vec<String>>,
    models: Vec<RawModelCatalogEntry>,
}

#[derive(Debug, Deserialize)]
struct RawModelCatalogEntry {
    id: String,
    name: String,
    description: String,
    filename: String,
    asset_path: Option<String>,
    expected_etag: Option<String>,
    size_mb: u64,
    is_directory: bool,
    engine_type: EngineType,
    accuracy_score: f32,
    speed_score: f32,
    supports_translation: bool,
    is_recommended: bool,
    supported_languages: Option<Vec<String>>,
    supported_languages_ref: Option<String>,
    #[serde(default)]
    is_custom: bool,
    #[serde(default)]
    always_available: bool,
    requires_license_key: bool,
}

pub fn load_catalog(app_handle: &AppHandle) -> Result<HashMap<String, ModelInfo>> {
    let json = read_catalog_json(app_handle)?;
    parse_catalog(&json, DEFAULT_MODEL_ASSET_BASE_URL)
}

fn read_catalog_json(app_handle: &AppHandle) -> Result<String> {
    let resource_path = app_handle
        .path()
        .resolve(MODEL_CATALOG_RESOURCE_PATH, BaseDirectory::Resource)
        .map_err(|e| anyhow!("Failed to resolve model catalog resource: {}", e))?;

    match fs::read_to_string(&resource_path) {
        Ok(contents) => Ok(contents),
        Err(err) => {
            warn!(
                "Failed to read model catalog at {}: {}. Falling back to bundled catalog.",
                resource_path.display(),
                err
            );
            Ok(FALLBACK_MODEL_CATALOG_JSON.to_string())
        }
    }
}

fn parse_catalog(json: &str, asset_base_url: &str) -> Result<HashMap<String, ModelInfo>> {
    let catalog: RawModelCatalog = serde_json::from_str(json)
        .map_err(|e| anyhow!("Failed to parse model catalog JSON: {}", e))?;

    if catalog.version != 1 {
        bail!("Unsupported model catalog version: {}", catalog.version);
    }

    let mut models = HashMap::new();
    for entry in catalog.models {
        let supported_languages = resolve_supported_languages(&catalog.language_sets, &entry)?;
        let url = resolve_asset_url(asset_base_url, entry.asset_path.as_deref());
        let is_downloaded = entry.always_available
            || matches!(
                entry.engine_type,
                EngineType::GeminiApi
                    | EngineType::GroqWhisper
                    | EngineType::MistralVoxtral
                    | EngineType::Deepgram
            );

        if !matches!(
            entry.engine_type,
            EngineType::GeminiApi
                | EngineType::GroqWhisper
                | EngineType::MistralVoxtral
                | EngineType::Deepgram
        ) && url.is_none()
            && !entry.is_custom
        {
            bail!("Model '{}' is missing an asset_path", entry.id);
        }

        let model_id = entry.id.clone();
        let previous = models.insert(
            model_id.clone(),
            ModelInfo {
                id: entry.id,
                name: entry.name,
                description: entry.description,
                filename: entry.filename,
                url,
                expected_etag: entry.expected_etag,
                size_mb: entry.size_mb,
                is_downloaded,
                is_downloading: false,
                partial_size: 0,
                is_directory: entry.is_directory,
                engine_type: entry.engine_type,
                accuracy_score: entry.accuracy_score,
                speed_score: entry.speed_score,
                supports_translation: entry.supports_translation,
                is_recommended: entry.is_recommended,
                supported_languages,
                is_custom: entry.is_custom,
                requires_license_key: entry.requires_license_key,
            },
        );

        if previous.is_some() {
            bail!("Duplicate model id found in catalog: {}", model_id);
        }
    }

    Ok(models)
}

fn resolve_supported_languages(
    language_sets: &HashMap<String, Vec<String>>,
    entry: &RawModelCatalogEntry,
) -> Result<Vec<String>> {
    match (
        entry.supported_languages.as_ref(),
        entry.supported_languages_ref.as_deref(),
    ) {
        (Some(languages), None) => Ok(languages.clone()),
        (None, Some(set_name)) => language_sets
            .get(set_name)
            .cloned()
            .ok_or_else(|| anyhow!("Unknown language set '{}' for model '{}'", set_name, entry.id)),
        (None, None) => Ok(Vec::new()),
        (Some(_), Some(_)) => bail!(
            "Model '{}' must define either supported_languages or supported_languages_ref, not both",
            entry.id
        ),
    }
}

fn resolve_asset_url(asset_base_url: &str, asset_path: Option<&str>) -> Option<String> {
    asset_path.map(|path| {
        format!(
            "{}/{}",
            asset_base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_catalog_parses_successfully() {
        let models = parse_catalog(FALLBACK_MODEL_CATALOG_JSON, DEFAULT_MODEL_ASSET_BASE_URL)
            .expect("Bundled model catalog should parse");

        assert!(models.contains_key("small"));
        assert!(models.contains_key("gemini-api"));
        assert_eq!(
            models
                .get("gemini-api")
                .expect("Gemini model should be present")
                .url,
            None
        );
        assert!(models
            .get("small")
            .expect("Small model should be present")
            .url
            .as_deref()
            .expect("small should have a URL")
            .contains(DEFAULT_MODEL_ASSET_BASE_URL));
    }
}

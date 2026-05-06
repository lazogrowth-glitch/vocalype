use crate::managers::model::{ModelInfo, ModelManager};
use crate::model_ids::is_parakeet_v3_model_id;
use crate::settings::AppSettings;

pub(super) fn normalize_language_for_model_support(language: &str) -> &str {
    match language {
        "zh-Hans" | "zh-Hant" => "zh",
        other => other,
    }
}

pub(super) fn model_supports_selected_language(
    model_info: &ModelInfo,
    settings: &AppSettings,
) -> bool {
    if settings.selected_language == "auto" {
        return true;
    }

    let normalized_language = normalize_language_for_model_support(&settings.selected_language);

    model_info
        .supported_languages
        .iter()
        .any(|language| language == &settings.selected_language || language == normalized_language)
}

pub(super) fn find_best_model_fallback(
    model_manager: &ModelManager,
    settings: &AppSettings,
    require_translation: bool,
    excluded_model_id: &str,
) -> Option<ModelInfo> {
    model_manager
        .get_available_models()
        .into_iter()
        .filter(|model_info| model_info.id != excluded_model_id)
        .filter(|model_info| model_info.is_downloaded)
        .filter(|model_info| !require_translation || model_info.supports_translation)
        .filter(|model_info| model_supports_selected_language(model_info, settings))
        .max_by(|left, right| {
            left.accuracy_score
                .partial_cmp(&right.accuracy_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

pub(super) fn resolve_runtime_model_override(
    current_model_info: Option<&ModelInfo>,
    model_manager: &ModelManager,
    settings: &AppSettings,
) -> Option<(ModelInfo, String)> {
    let model_info = current_model_info?;

    if !is_parakeet_v3_model_id(&model_info.id) {
        return None;
    }

    if settings.translate_to_english && !model_info.supports_translation {
        let fallback = find_best_model_fallback(model_manager, settings, true, &model_info.id)?;
        return Some((
            fallback,
            "Parakeet V3 does not support translation-to-English in this runtime".to_string(),
        ));
    }

    if !model_supports_selected_language(model_info, settings) {
        let fallback = find_best_model_fallback(model_manager, settings, false, &model_info.id)?;
        return Some((
            fallback,
            format!(
                "Parakeet V3 does not support the selected language '{}'",
                settings.selected_language
            ),
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managers::model::EngineType;

    fn settings_with_language(language: &str) -> AppSettings {
        let mut settings = AppSettings::default();
        settings.selected_language = language.to_string();
        settings
    }

    fn model_with_languages(languages: &[&str]) -> ModelInfo {
        ModelInfo {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: String::new(),
            filename: String::new(),
            url: None,
            expected_etag: None,
            size_mb: 0,
            is_downloaded: true,
            is_downloading: false,
            partial_size: 0,
            is_directory: false,
            engine_type: EngineType::Whisper,
            accuracy_score: 0.0,
            speed_score: 0.0,
            supports_translation: false,
            is_recommended: false,
            supported_languages: languages.iter().map(|value| value.to_string()).collect(),
            is_custom: false,
            requires_license_key: false,
        }
    }

    #[test]
    fn zh_variants_fall_back_to_zh_support() {
        let settings = settings_with_language("zh-Hans");
        let model = model_with_languages(&["zh"]);
        assert!(model_supports_selected_language(&model, &settings));
    }

    #[test]
    fn auto_language_is_always_supported() {
        let settings = settings_with_language("auto");
        let model = model_with_languages(&[]);
        assert!(model_supports_selected_language(&model, &settings));
    }
}

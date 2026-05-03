pub const PARAKEET_V3_LEGACY_ID: &str = "parakeet-tdt-0.6b-v3";
pub const PARAKEET_V3_ENGLISH_ID: &str = "parakeet-tdt-0.6b-v3-english";
pub const PARAKEET_V3_MULTILINGUAL_ID: &str = "parakeet-tdt-0.6b-v3-multilingual";
pub const PARAKEET_V3_RUNTIME_FILENAME_ID: &str = "parakeet-tdt-0.6b-v3-int8";

pub fn canonical_model_id(model_id: &str) -> &str {
    match model_id.trim() {
        PARAKEET_V3_LEGACY_ID | PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_RUNTIME_FILENAME_ID => {
            PARAKEET_V3_MULTILINGUAL_ID
        }
        other => other,
    }
}

pub fn is_parakeet_v3_model_id(model_id: &str) -> bool {
    matches!(canonical_model_id(model_id), PARAKEET_V3_MULTILINGUAL_ID)
}

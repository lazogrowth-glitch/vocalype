pub const PARAKEET_V3_LEGACY_ID: &str = "parakeet-tdt-0.6b-v3";
pub const PARAKEET_V3_ENGLISH_ID: &str = "parakeet-tdt-0.6b-v3-english";
pub const PARAKEET_V3_MULTILINGUAL_ID: &str = "parakeet-tdt-0.6b-v3-multilingual";

pub fn is_parakeet_v3_model_id(model_id: &str) -> bool {
    matches!(
        model_id,
        PARAKEET_V3_LEGACY_ID | PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_MULTILINGUAL_ID
    )
}

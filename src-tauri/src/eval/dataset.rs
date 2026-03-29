use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoiseLevel {
    Quiet,
    Light,
    Moderate,
    Heavy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MicType {
    Laptop,
    Headset,
    Usb,
    BuiltInArray,
    Phone,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeechRate {
    Slow,
    Normal,
    Fast,
    VeryFast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalSample {
    pub sample_id: String,
    pub scenario: String,
    pub audio_path: String,
    pub reference_text: String,
    pub language: String,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub noise_level: Option<NoiseLevel>,
    #[serde(default)]
    pub mic_type: Option<MicType>,
    #[serde(default)]
    pub duration_bucket: Option<String>,
    #[serde(default)]
    pub speech_rate: Option<SpeechRate>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalDatasetManifest {
    pub version: u32,
    pub samples: Vec<EvalSample>,
}

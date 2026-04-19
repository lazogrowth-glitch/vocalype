use crate::config::PreprocessorConfig;
use crate::decoder::TranscriptionResult;
use crate::decoder_tdt::ParakeetTDTDecoder;
use crate::error::{Error, Result};
use crate::execution::ModelConfig as ExecutionConfig;
use crate::model_tdt::ParakeetTDTModel;
use crate::timestamps::{process_timestamps, TimestampMode};
use crate::transcriber::Transcriber;
use crate::vocab::Vocabulary;
use std::path::{Path, PathBuf};

/// Parakeet TDT model for multilingual ASR
pub struct ParakeetTDT {
    model: ParakeetTDTModel,
    decoder: ParakeetTDTDecoder,
    preprocessor_config: PreprocessorConfig,
    model_dir: PathBuf,
    /// BCP-47 language code to force (e.g. "fr", "de").
    /// `None` means auto-detect (default behaviour).
    language: Option<String>,
}

impl ParakeetTDT {
    /// Load Parakeet TDT model from path with optional configuration.
    ///
    /// # Arguments
    /// * `path` - Directory containing encoder-model.onnx, decoder_joint-model.onnx, and vocab.txt
    /// * `config` - Optional execution configuration (defaults to CPU if None)
    pub fn from_pretrained<P: AsRef<Path>>(
        path: P,
        config: Option<ExecutionConfig>,
    ) -> Result<Self> {
        Self::from_pretrained_with_cache(path, config, None)
    }

    pub fn from_pretrained_with_cache<P: AsRef<Path>>(
        path: P,
        config: Option<ExecutionConfig>,
        cache_dir: Option<&Path>,
    ) -> Result<Self> {
        let path = path.as_ref();

        if !path.is_dir() {
            return Err(Error::Config(format!(
                "TDT model path must be a directory: {}",
                path.display()
            )));
        }

        let vocab_path = path.join("vocab.txt");
        if !vocab_path.exists() {
            return Err(Error::Config(format!(
                "vocab.txt not found in {}",
                path.display()
            )));
        }

        // TDT-specific preprocessor config (128 features instead of 80)
        let preprocessor_config = PreprocessorConfig {
            feature_extractor_type: "ParakeetFeatureExtractor".to_string(),
            feature_size: 128,
            hop_length: 160,
            n_fft: 512,
            padding_side: "right".to_string(),
            padding_value: 0.0,
            preemphasis: 0.97,
            processor_class: "ParakeetProcessor".to_string(),
            return_attention_mask: true,
            sampling_rate: 16000,
            win_length: 400,
        };

        let exec_config = config.unwrap_or_default();

        // Load vocab first to get the actual vocabulary size
        let vocab = Vocabulary::from_file(&vocab_path)?;
        let vocab_size = vocab.size();

        let model = ParakeetTDTModel::from_pretrained(path, exec_config, vocab_size, cache_dir)?;
        let decoder = ParakeetTDTDecoder::from_vocab(vocab);

        Ok(Self {
            model,
            decoder,
            preprocessor_config,
            model_dir: path.to_path_buf(),
            language: None,
        })
    }

    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }

    pub fn preprocessor_config(&self) -> &PreprocessorConfig {
        &self.preprocessor_config
    }

    /// Set the language to force during decoding.
    ///
    /// Pass a BCP-47 code like `"fr"`, `"de"`, `"es"` to constrain the decoder
    /// to that language.  Pass `None` (or `"auto"`) to restore auto-detection.
    ///
    /// Internally this injects the matching `<|{lang}|>` control token as the
    /// initial context for the LSTM prediction network, biasing all subsequent
    /// token predictions towards the target language.
    pub fn set_language(&mut self, lang: Option<&str>) {
        self.language = lang.filter(|l| !l.is_empty() && *l != "auto").map(String::from);
    }
}

impl Transcriber for ParakeetTDT {
    fn transcribe_samples(
        &mut self,
        audio: Vec<f32>,
        _sample_rate: u32,
        channels: u16,
        mode: Option<TimestampMode>,
    ) -> Result<TranscriptionResult> {
        // Downmix to mono if needed (nemo128.onnx expects single-channel audio)
        let mono: Vec<f32> = if channels > 1 {
            audio
                .chunks(channels as usize)
                .map(|c| c.iter().sum::<f32>() / channels as f32)
                .collect()
        } else {
            audio
        };
        let features = self.model.extract_features(&mono, &self.preprocessor_config)?;
        // Resolve the language control token ID once per call.
        let language_token_id = self
            .language
            .as_deref()
            .and_then(|lang| self.decoder.language_token_id(lang));
        let (tokens, frame_indices, durations) =
            self.model.forward(features, language_token_id)?;

        let mut result = self.decoder.decode_with_timestamps(
            &tokens,
            &frame_indices,
            &durations,
            self.preprocessor_config.hop_length,
            self.preprocessor_config.sampling_rate,
        )?;

        // Apply timestamp mode conversion
        let mode = mode.unwrap_or(TimestampMode::Tokens);
        result.tokens = process_timestamps(&result.tokens, mode);

        // Rebuild full text from processed tokens
        result.text = if mode == TimestampMode::Tokens {
            result
                .tokens
                .iter()
                .map(|t| t.text.as_str())
                .collect::<String>()
                .trim()
                .to_string()
        } else if mode == TimestampMode::Words {
            let mut out = String::new();
            for (i, word) in result.tokens.iter().map(|t| t.text.as_str()).enumerate() {
                let is_standalone_punct = word.len() == 1
                    && word
                        .chars()
                        .all(|c| matches!(c, '.' | ',' | '!' | '?' | ';' | ':' | ')'));
                if i > 0 && !is_standalone_punct {
                    out.push(' ');
                }
                out.push_str(word);
            }
            out
        } else {
            result
                .tokens
                .iter()
                .map(|t| t.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        };

        Ok(result)
    }
}

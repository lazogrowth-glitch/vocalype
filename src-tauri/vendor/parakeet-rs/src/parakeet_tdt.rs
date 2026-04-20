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
    /// Pre-computed token IDs that receive a logit boost when a specific
    /// language is selected.  Empty = auto-detect (default).
    language_bias_tokens: Vec<usize>,
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
            language_bias_tokens: Vec::new(),
        })
    }

    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }

    pub fn preprocessor_config(&self) -> &PreprocessorConfig {
        &self.preprocessor_config
    }

    /// Set the language to bias during decoding.
    ///
    /// Pass a BCP-47 code like `"fr"`, `"de"`, `"es"` to nudge the decoder
    /// towards that language.  Pass `None` or `"auto"` to restore auto-detection.
    ///
    /// Internally this pre-computes the set of vocab token IDs that correspond
    /// to the target language (by scanning for language-specific accented
    /// characters and common function words).  At decode time, those token
    /// logits receive a +2.0 boost — ≈7× more probable before softmax.  The
    /// audio signal can still override this when the speech is unambiguous.
    ///
    /// Computation happens once here; per-frame cost is just a few hundred
    /// float additions inside the ONNX inference loop.
    pub fn set_language(&mut self, lang: Option<&str>) {
        let lang = match lang {
            Some(l) if !l.is_empty() && l != "auto" => l,
            _ => {
                self.language_bias_tokens.clear();
                return;
            }
        };
        self.language_bias_tokens =
            compute_language_bias_tokens(&self.decoder, lang);
    }
}

// ── Language bias helpers ─────────────────────────────────────────────────────

/// Characters that are unique to a given language and not normally found in
/// English text.  Any vocab token containing one of these chars gets boosted.
fn language_accent_chars(lang: &str) -> &'static str {
    match lang {
        "fr" => "éèêëàâùûüçîïôœæÉÈÊËÀÂÙÛÜÇÎÏÔŒÆ",
        "de" => "äöüßÄÖÜ",
        "es" => "ñáíóúüÑÁÍÓÚÜ¿¡",
        "pt" => "ãõçáéíóúâêôÃÕÇÁÉÍÓÚÂÊÔ",
        "it" => "àèéìíòóùúÀÈÉÌÍÒÓÙÚ",
        "ru" | "uk" | "bg" => "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
        "ja" => "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコサシスセソ",
        "zh" => "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会",
        "ar" => "ابتثجحخدذرزسشصضطظعغفقكلمنهوي",
        "ko" => "가나다라마바사아자차카타파하",
        "hi" => "अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह",
        "tr" => "çğışöüÇĞİŞÖÜ",
        "nl" => "ëïöüáéíóúàèìòùâêîôûÉÈÀÙ",
        _ => "",
    }
}

/// Common function words for a language.  These pure-ASCII tokens are
/// language-specific enough to serve as strong biasing signals.
fn language_function_words(lang: &str) -> &'static [&'static str] {
    match lang {
        "fr" => &[
            "▁le", "▁la", "▁les", "▁de", "▁du", "▁des", "▁un", "▁une",
            "▁et", "▁est", "▁je", "▁tu", "▁il", "▁elle", "▁nous", "▁vous",
            "▁que", "▁qui", "▁pas", "▁ne", "▁sur", "▁dans", "▁avec",
            "▁pour", "▁au", "▁aux", "▁ce", "▁se", "▁en",
        ],
        "de" => &[
            "▁die", "▁der", "▁das", "▁und", "▁ist", "▁ich", "▁du",
            "▁er", "▁wir", "▁sie", "▁nicht", "▁mit", "▁auf", "▁für",
            "▁ein", "▁eine", "▁den", "▁dem", "▁des", "▁im",
        ],
        "es" => &[
            "▁el", "▁la", "▁los", "▁las", "▁de", "▁del", "▁un", "▁una",
            "▁y", "▁es", "▁en", "▁que", "▁no", "▁por", "▁con", "▁al",
        ],
        "pt" => &[
            "▁o", "▁a", "▁os", "▁as", "▁de", "▁da", "▁do", "▁um",
            "▁uma", "▁e", "▁em", "▁que", "▁não", "▁por", "▁com",
        ],
        "it" => &[
            "▁il", "▁la", "▁i", "▁le", "▁di", "▁del", "▁un", "▁una",
            "▁e", "▁in", "▁che", "▁non", "▁per", "▁con", "▁si",
        ],
        "nl" => &[
            "▁de", "▁het", "▁een", "▁en", "▁van", "▁in", "▁is", "▁dat",
            "▁op", "▁te", "▁met", "▁zijn", "▁voor", "▁niet",
        ],
        _ => &[],
    }
}

/// Walk the vocabulary once and collect all token IDs that should be boosted
/// for the given language.
fn compute_language_bias_tokens(decoder: &ParakeetTDTDecoder, lang: &str) -> Vec<usize> {
    use std::collections::HashSet;
    let mut seen: HashSet<usize> = HashSet::new();
    let mut ids: Vec<usize> = Vec::new();

    let accent_chars = language_accent_chars(lang);

    // Tokens containing language-specific accented characters
    if !accent_chars.is_empty() {
        for (id, token) in decoder.vocab_tokens().enumerate() {
            if token.chars().any(|c| accent_chars.contains(c)) && seen.insert(id) {
                ids.push(id);
            }
        }
    }

    // Common function word tokens (pure ASCII — looked up by exact token text)
    for &word in language_function_words(lang) {
        if let Some(id) = decoder.language_token_id(word) {
            // re-use language_token_id — it searches by exact match
            if seen.insert(id) {
                ids.push(id);
            }
        }
    }

    ids
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
        let (tokens, frame_indices, durations) =
            self.model.forward(features, &self.language_bias_tokens)?;

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

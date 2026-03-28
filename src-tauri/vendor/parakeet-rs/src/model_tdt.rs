use crate::audio;
use crate::config::PreprocessorConfig;
use crate::error::{Error, Result};
use crate::execution::ModelConfig as ExecutionConfig;
use ndarray::{Array1, Array2, Array3};
use ort::session::Session;
use std::path::{Path, PathBuf};

/// TDT model configs
#[derive(Debug, Clone)]
pub struct TDTModelConfig {
    pub vocab_size: usize,
}

impl TDTModelConfig {
    /// Create config with specified vocab size
    pub fn new(vocab_size: usize) -> Self {
        Self { vocab_size }
    }
}

pub struct ParakeetTDTModel {
    preprocessor: Option<Session>, // nemo128.onnx — official NeMo feature extractor
    encoder: Session,
    decoder_joint: Session,
    config: TDTModelConfig,
}

impl ParakeetTDTModel {
    fn expected_decoder_encoder_dim(&self) -> Option<usize> {
        self.decoder_joint
            .inputs
            .iter()
            .find(|input| input.name == "encoder_outputs")
            .and_then(|input| input.input_type.tensor_shape())
            .and_then(|shape| shape.get(1).copied())
            .filter(|d| *d > 0)
            .map(|d| d as usize)
    }

    /// Load TDT model from directory containing encoder and decoder_joint ONNX files
    ///
    /// # Arguments
    /// * `model_dir` - Directory containing encoder and decoder_joint ONNX files
    /// * `exec_config` - Execution configuration for ONNX runtime
    /// * `vocab_size` - Vocabulary size (number of tokens including blank)
    pub fn from_pretrained<P: AsRef<Path>>(
        model_dir: P,
        exec_config: ExecutionConfig,
        vocab_size: usize,
        cache_dir: Option<&Path>,
    ) -> Result<Self> {
        let model_dir = model_dir.as_ref();

        // Find encoder and decoder_joint files
        let encoder_path = Self::find_encoder(model_dir)?;
        let decoder_joint_path = Self::find_decoder_joint(model_dir)?;

        let config = TDTModelConfig::new(vocab_size);

        // Load encoder — uses pre-optimized cache when available
        let encoder = exec_config.build_session(&encoder_path, cache_dir)?;

        // Load decoder_joint
        let decoder_joint = exec_config.build_session(&decoder_joint_path, cache_dir)?;

        // Load the official NeMo feature extractor (nemo128.onnx) if present.
        // This matches the training-time feature extraction exactly, enabling correct
        // language detection. Falls back to manual extraction if the file is missing.
        let preprocessor_path = model_dir.join("nemo128.onnx");
        let preprocessor = if preprocessor_path.exists() {
            match exec_config.build_session(&preprocessor_path, cache_dir) {
                Ok(session) => Some(session),
                Err(e) => {
                    eprintln!("[parakeet] nemo128.onnx found but failed to load ({e}), using manual feature extraction");
                    None
                }
            }
        } else {
            eprintln!("[parakeet] nemo128.onnx not found, using manual feature extraction (may affect multilingual accuracy)");
            None
        };

        Ok(Self {
            preprocessor,
            encoder,
            decoder_joint,
            config,
        })
    }
    //file names simply from: https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/tree/main
    fn find_encoder(dir: &Path) -> Result<PathBuf> {
        let candidates = [
            "encoder-model.onnx",
            "encoder.onnx",
            "encoder-model.int8.onnx",
        ];
        for candidate in &candidates {
            let path = dir.join(candidate);
            if path.exists() {
                return Ok(path);
            }
        }
        // fallback
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    if name.starts_with("encoder") && name.ends_with(".onnx") {
                        return Ok(path);
                    }
                }
            }
        }
        Err(Error::Config(format!(
            "No encoder model found in {}",
            dir.display()
        )))
    }


    fn find_decoder_joint(dir: &Path) -> Result<PathBuf> {
        let candidates = [
            "decoder_joint-model.onnx",
            "decoder_joint-model.int8.onnx",
            "decoder_joint.onnx",
            "decoder-model.onnx",
        ];
        for candidate in &candidates {
            let path = dir.join(candidate);
            if path.exists() {
                return Ok(path);
            }
        }
        Err(Error::Config(format!(
            "No decoder_joint model found in {}",
            dir.display()
        )))
    }

    /// Extract mel features from 16 kHz mono audio.
    ///
    /// Uses nemo128.onnx (the official NeMo LogMelSpectrogram extractor) when available,
    /// otherwise falls back to the manual implementation.
    /// Using nemo128.onnx ensures features match what the model was trained on,
    /// which is required for correct multilingual (e.g. French) language detection.
    pub fn extract_features(
        &mut self,
        audio: &[f32],
        fallback_config: &PreprocessorConfig,
    ) -> Result<Array2<f32>> {
        if let Some(ref mut preprocessor) = self.preprocessor {
            let audio_len = audio.len();
            let audio_tensor =
                ndarray::Array2::<f32>::from_shape_vec((1, audio_len), audio.to_vec())
                    .map_err(|e| Error::Model(format!("audio tensor reshape: {e}")))?;
            let lens_tensor = Array1::from_vec(vec![audio_len as i64]);

            let outputs = preprocessor.run(ort::inputs!(
                "waveforms" => ort::value::Value::from_array(audio_tensor)?,
                "waveforms_lens" => ort::value::Value::from_array(lens_tensor)?
            ))?;

            let (shape, data) = outputs["features"]
                .try_extract_tensor::<f32>()
                .map_err(|e| Error::Model(format!("nemo128 feature extraction: {e}")))?;

            let dims = shape.as_ref();
            // nemo128.onnx outputs [batch=1, T, F=128]
            if dims.len() < 3 {
                return Err(Error::Model(format!(
                    "unexpected nemo128 output shape: {dims:?}"
                )));
            }
            let expected_f = fallback_config.feature_size;
            let d2 = dims[dims.len() - 2] as usize;
            let d3 = dims[dims.len() - 1] as usize;

            if d3 == expected_f {
                // Layout: [B, T, F]
                let t = d2;
                let f = d3;
                let flat: Vec<f32> = data.iter().take(t * f).copied().collect();
                return ndarray::Array2::from_shape_vec((t, f), flat)
                    .map_err(|e| Error::Model(format!("feature array reshape: {e}")));
            }

            if d2 == expected_f {
                // Layout: [B, F, T] -> transpose to [T, F]
                let f = d2;
                let t = d3;
                let mut out = ndarray::Array2::<f32>::zeros((t, f));
                for ti in 0..t {
                    for fi in 0..f {
                        let idx = fi * t + ti; // first batch only
                        let v = data.get(idx).copied().ok_or_else(|| {
                            Error::Model(format!(
                                "nemo128 output too small for shape {dims:?} at idx={idx}"
                            ))
                        })?;
                        out[[ti, fi]] = v;
                    }
                }
                return Ok(out);
            }

            Err(Error::Model(format!(
                "unexpected nemo128 output shape: {dims:?} (expected one dimension to be feature_size={expected_f})"
            )))
        } else {
            audio::extract_features_raw(
                audio.to_vec(),
                fallback_config.sampling_rate as u32,
                1,
                fallback_config,
            )
        }
    }

    /// Run greedy decoding - returns (token_ids, frame_indices, durations)
    pub fn forward(
        &mut self,
        features: Array2<f32>,
    ) -> Result<(Vec<usize>, Vec<usize>, Vec<usize>)> {
        // Run encoder
        let (encoder_out, encoder_len) = self.run_encoder(&features)?;

        // Run greedy decoding with decoder_joint
        let (tokens, frame_indices, durations) = self.greedy_decode(&encoder_out, encoder_len)?;

        Ok((tokens, frame_indices, durations))
    }

    fn run_encoder(&mut self, features: &Array2<f32>) -> Result<(Array3<f32>, i64)> {
        let batch_size = 1;
        let time_steps = features.shape()[0];
        let feature_size = features.shape()[1];
        let expected_decoder_dim = self.expected_decoder_encoder_dim();

        // TDT encoder expects (batch, features, time) not (batch, time, features)
        let input = features
            .t()
            .to_shape((batch_size, feature_size, time_steps))
            .map_err(|e| Error::Model(format!("Failed to reshape encoder input: {e}")))?
            .to_owned();

        let input_length = Array1::from_vec(vec![time_steps as i64]);

        let input_value = ort::value::Value::from_array(input)?;
        let length_value = ort::value::Value::from_array(input_length)?;

        let outputs = self.encoder.run(ort::inputs!(
            "audio_signal" => input_value,
            "length" => length_value
        ))?;

        let encoder_out = &outputs["outputs"];
        let encoder_lens = &outputs["encoded_lengths"];

        let (shape, data) = encoder_out
            .try_extract_tensor::<f32>()
            .map_err(|e| Error::Model(format!("Failed to extract encoder output: {e}")))?;

        let (_, lens_data) = encoder_lens
            .try_extract_tensor::<i64>()
            .map_err(|e| Error::Model(format!("Failed to extract encoder lengths: {e}")))?;

        let shape_dims = shape.as_ref();
        if shape_dims.len() != 3 {
            return Err(Error::Model(format!(
                "Expected 3D encoder output, got shape: {shape_dims:?}"
            )));
        }

        let b = shape_dims[0] as usize;
        let d2 = shape_dims[1] as usize;
        let d3 = shape_dims[2] as usize;

        let raw = Array3::from_shape_vec((b, d2, d3), data.to_vec())
            .map_err(|e| Error::Model(format!("Failed to create encoder array: {e}")))?;

        // Some exports return [B, T, D], others [B, D, T].
        // Normalize to [B, T, D] expected by greedy_decode.
        let encoder_array = if let Some(expected_dim) = expected_decoder_dim {
            if d3 == expected_dim {
                raw
            } else if d2 == expected_dim {
                raw.permuted_axes((0, 2, 1)).to_owned()
            } else {
                return Err(Error::Model(format!(
                    "unexpected encoder output shape {shape_dims:?}; decoder expects encoder dim {expected_dim}"
                )));
            }
        } else {
            // Conservative fallback if input metadata is unavailable.
            if d2 >= d3 {
                raw.permuted_axes((0, 2, 1)).to_owned()
            } else {
                raw
            }
        };

        Ok((encoder_array, lens_data[0]))
    }

    fn greedy_decode(
        &mut self,
        encoder_out: &Array3<f32>,
        encoder_len: i64,
    ) -> Result<(Vec<usize>, Vec<usize>, Vec<usize>)> {
        // encoder_out shape: [batch, time, encoder_dim]
        let time_steps = encoder_out.shape()[1];
        let encoder_dim = encoder_out.shape()[2];
        // Use encoder_len to skip padding frames (encoder may pad to fixed length)
        let time_steps = (encoder_len as usize).min(time_steps);
        let vocab_size = self.config.vocab_size;
        let max_tokens_per_step = 10;
        let blank_id = vocab_size - 1;

        // States: (num_layers=2, batch=1, hidden_dim=640)
        let mut state_h = Array3::<f32>::zeros((2, 1, 640));
        let mut state_c = Array3::<f32>::zeros((2, 1, 640));

        let mut tokens = Vec::new();
        let mut frame_indices = Vec::new();
        let mut durations = Vec::new();

        let mut t = 0;
        let mut emitted_tokens = 0;
        let mut last_emitted_token = blank_id as i32;

        // Frame-by-frame RNN-T/TDT greedy decoding
        while t < time_steps {
            // Get single encoder frame: slice [batch=0, time=t, :] → shape [encoder_dim]
            // then reshape to [1, encoder_dim, 1] as expected by decoder_joint
            let frame = encoder_out.slice(ndarray::s![0, t, ..]).to_owned();
            let frame_reshaped = frame
                .to_shape((1, encoder_dim, 1))
                .map_err(|e| Error::Model(format!("Failed to reshape frame: {e}")))?
                .to_owned();

            // Current token for prediction network
            let targets = Array2::from_shape_vec((1, 1), vec![last_emitted_token])
                .map_err(|e| Error::Model(format!("Failed to create targets: {e}")))?;

            // Run decoder_joint
            let outputs = self.decoder_joint.run(ort::inputs!(
                "encoder_outputs" => ort::value::Value::from_array(frame_reshaped)?,
                "targets" => ort::value::Value::from_array(targets)?,
                "target_length" => ort::value::Value::from_array(Array1::from_vec(vec![1i32]))?,
                "input_states_1" => ort::value::Value::from_array(state_h.clone())?,
                "input_states_2" => ort::value::Value::from_array(state_c.clone())?
            ))?;

            // Extract logits
            let (_, logits_data) = outputs["outputs"]
                .try_extract_tensor::<f32>()
                .map_err(|e| Error::Model(format!("Failed to extract logits: {e}")))?;

            // TDT outputs vocab_size + 5 durations
            let vocab_logits: Vec<f32> = logits_data.iter().take(vocab_size).copied().collect();
            let duration_logits: Vec<f32> = logits_data.iter().skip(vocab_size).copied().collect();

            let token_id = vocab_logits
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(idx, _)| idx)
                .unwrap_or(blank_id);

            let duration_step = if !duration_logits.is_empty() {
                duration_logits
                    .iter()
                    .enumerate()
                    .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(idx, _)| idx)
                    .unwrap_or(0)
            } else {
                0
            };

            // Check if blank token
            if token_id != blank_id {
                // Update states when we emit a token
                if let Ok((h_shape, h_data)) =
                    outputs["output_states_1"].try_extract_tensor::<f32>()
                {
                    let dims = h_shape.as_ref();
                    state_h = Array3::from_shape_vec(
                        (dims[0] as usize, dims[1] as usize, dims[2] as usize),
                        h_data.to_vec(),
                    )
                    .map_err(|e| Error::Model(format!("Failed to update state_h: {e}")))?;
                }
                if let Ok((c_shape, c_data)) =
                    outputs["output_states_2"].try_extract_tensor::<f32>()
                {
                    let dims = c_shape.as_ref();
                    state_c = Array3::from_shape_vec(
                        (dims[0] as usize, dims[1] as usize, dims[2] as usize),
                        c_data.to_vec(),
                    )
                    .map_err(|e| Error::Model(format!("Failed to update state_c: {e}")))?;
                }

                tokens.push(token_id);
                frame_indices.push(t);
                durations.push(duration_step);
                last_emitted_token = token_id as i32;
                emitted_tokens += 1;
            }

            // TDT fix: duration must be applied at every step (blank or not),
            // not only on blank tokens. In the original buggy version, duration
            // was ignored for non-blank tokens, causing wrong frame alignment and
            // language instability on multilingual audio.
            if duration_step > 0 {
                t += duration_step;
                emitted_tokens = 0;
            } else if token_id == blank_id || emitted_tokens >= max_tokens_per_step {
                t += 1;
                emitted_tokens = 0;
            }
        }

        Ok((tokens, frame_indices, durations))
    }
}

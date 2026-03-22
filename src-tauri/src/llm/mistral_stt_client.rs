//! Mistral Voxtral API — cloud speech-to-text client.
//!
//! Uses the `/v1/audio/transcriptions` endpoint.
//! Audio is encoded as a 16 kHz 16-bit mono WAV file and uploaded as multipart/form-data.

use anyhow::Result;
use hound::{WavSpec, WavWriter};
use log::debug;
use reqwest::multipart;
use serde::Deserialize;
use std::io::Cursor;
use std::time::Duration;

const MISTRAL_API_BASE: &str = "https://api.mistral.ai/v1";
const MISTRAL_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MISTRAL_VOXTRAL_MODEL: &str = "voxtral-mini-latest";

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

fn encode_samples_to_wav(samples: &[f32]) -> Result<Vec<u8>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buffer = Vec::new();
    {
        let cursor = Cursor::new(&mut buffer);
        let mut writer = WavWriter::new(cursor, spec)?;
        for sample in samples {
            writer.write_sample((sample * i16::MAX as f32) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(buffer)
}

pub async fn transcribe_audio(api_key: &str, audio_samples: &[f32]) -> Result<String> {
    let wav_bytes = encode_samples_to_wav(audio_samples)?;
    debug!(
        "Mistral STT: {} samples → {} bytes WAV",
        audio_samples.len(),
        wav_bytes.len()
    );

    let form = multipart::Form::new()
        .part(
            "file",
            multipart::Part::bytes(wav_bytes)
                .file_name("audio.wav")
                .mime_str("audio/wav")?,
        )
        .text("model", MISTRAL_VOXTRAL_MODEL);

    let client = reqwest::Client::builder()
        .timeout(MISTRAL_REQUEST_TIMEOUT)
        .build()?;

    let response = client
        .post(format!("{}/audio/transcriptions", MISTRAL_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Mistral STT request failed ({}): {}",
            status,
            body
        ));
    }

    let parsed: TranscriptionResponse = serde_json::from_str(&body)
        .map_err(|e| anyhow::anyhow!("Failed to parse Mistral response: {} — body: {}", e, body))?;

    debug!(
        "Mistral STT: transcription complete ({} chars)",
        parsed.text.len()
    );
    Ok(parsed.text.trim().to_string())
}

//! Groq Whisper API — cloud speech-to-text client.
//!
//! Uses the OpenAI-compatible `/v1/audio/transcriptions` endpoint offered by Groq.
//! Audio is encoded as a 16 kHz 16-bit mono WAV file and uploaded as multipart/form-data.

use anyhow::Result;
use hound::{WavSpec, WavWriter};
use log::debug;
use reqwest::multipart;
use serde::Deserialize;
use std::io::Cursor;
use std::time::Duration;

const GROQ_API_BASE: &str = "https://api.groq.com/openai/v1";
const GROQ_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const GROQ_WHISPER_MODEL: &str = "whisper-large-v3";

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
        "Groq STT: {} samples → {} bytes WAV",
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
        .text("model", GROQ_WHISPER_MODEL)
        .text("response_format", "json");

    let client = reqwest::Client::builder()
        .timeout(GROQ_REQUEST_TIMEOUT)
        .build()?;

    let response = client
        .post(format!("{}/audio/transcriptions", GROQ_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Groq STT request failed ({}): {}",
            status,
            body
        ));
    }

    let parsed: TranscriptionResponse = serde_json::from_str(&body)
        .map_err(|e| anyhow::anyhow!("Failed to parse Groq response: {} — body: {}", e, body))?;

    debug!(
        "Groq STT: transcription complete ({} chars)",
        parsed.text.len()
    );
    Ok(parsed.text.trim().to_string())
}

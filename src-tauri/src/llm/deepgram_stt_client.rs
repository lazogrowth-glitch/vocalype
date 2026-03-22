//! Deepgram Nova API — cloud speech-to-text client.
//!
//! Uses the REST batch transcription endpoint. Audio is posted as raw PCM
//! (16 kHz, 16-bit, mono, little-endian) with appropriate query parameters.
//! Deepgram does not require multipart — it accepts raw binary bodies.

use anyhow::Result;
use log::debug;
use serde::Deserialize;
use std::time::Duration;

const DEEPGRAM_API_BASE: &str = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
struct DeepgramResponse {
    results: Option<DeepgramResults>,
}

#[derive(Deserialize)]
struct DeepgramResults {
    channels: Option<Vec<DeepgramChannel>>,
}

#[derive(Deserialize)]
struct DeepgramChannel {
    alternatives: Option<Vec<DeepgramAlternative>>,
}

#[derive(Deserialize)]
struct DeepgramAlternative {
    transcript: Option<String>,
}

fn encode_samples_to_pcm(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let s16 = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        bytes.extend_from_slice(&s16.to_le_bytes());
    }
    bytes
}

pub async fn transcribe_audio(api_key: &str, audio_samples: &[f32]) -> Result<String> {
    let pcm_bytes = encode_samples_to_pcm(audio_samples);
    debug!(
        "Deepgram STT: {} samples → {} bytes PCM",
        audio_samples.len(),
        pcm_bytes.len()
    );

    let url = format!(
        "{}?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&punctuate=true",
        DEEPGRAM_API_BASE
    );

    let client = reqwest::Client::builder()
        .timeout(DEEPGRAM_REQUEST_TIMEOUT)
        .build()?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Token {}", api_key))
        .header("Content-Type", "audio/raw")
        .body(pcm_bytes)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Deepgram STT request failed ({}): {}",
            status,
            body
        ));
    }

    let parsed: DeepgramResponse = serde_json::from_str(&body).map_err(|e| {
        anyhow::anyhow!("Failed to parse Deepgram response: {} — body: {}", e, body)
    })?;

    let transcript = parsed
        .results
        .and_then(|r| r.channels)
        .and_then(|channels| channels.into_iter().next())
        .and_then(|channel| channel.alternatives)
        .and_then(|alts| alts.into_iter().next())
        .and_then(|alt| alt.transcript)
        .unwrap_or_default();

    debug!(
        "Deepgram STT: transcription complete ({} chars)",
        transcript.len()
    );
    Ok(transcript.trim().to_string())
}

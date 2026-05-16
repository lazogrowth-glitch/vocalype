use parakeet_rs::{ExecutionConfig, ExecutionProvider, ParakeetTDT, TimestampMode, Transcriber};
use std::path::PathBuf;
use std::time::Instant;

const SAMPLE_RATE: usize = 16_000;
const SHORT_PAD_SAMPLES: usize = SAMPLE_RATE / 2;
const FAST_SHORT_SAMPLES: usize = 40_000;
const ULTRA_SHORT_SAMPLES: usize = 3 * SAMPLE_RATE;

fn sine_audio(samples: usize) -> Vec<f32> {
    (0..samples)
        .map(|i| {
            let t = i as f32 / SAMPLE_RATE as f32;
            ((t * 220.0 * std::f32::consts::TAU).sin() * 0.08).clamp(-1.0, 1.0)
        })
        .collect()
}

fn pad_short_phrase(samples: &[f32]) -> Vec<f32> {
    let pad = vec![0.0_f32; SHORT_PAD_SAMPLES];
    let mut padded = Vec::with_capacity(samples.len() + pad.len() * 2);
    padded.extend_from_slice(&pad);
    padded.extend_from_slice(samples);
    padded.extend_from_slice(&pad);
    padded
}

fn run_legacy_short_path(engine: &mut ParakeetTDT, audio: &[f32]) -> anyhow::Result<String> {
    let decode_audio = pad_short_phrase(audio);
    let mut display_text = engine
        .transcribe_samples(
            decode_audio.clone(),
            SAMPLE_RATE as u32,
            1,
            Some(TimestampMode::Sentences),
        )?
        .text;

    if let Ok(word_result) = engine.transcribe_samples(
        decode_audio.clone(),
        SAMPLE_RATE as u32,
        1,
        Some(TimestampMode::Words),
    ) {
        if !word_result.text.trim().is_empty() {
            display_text = word_result.text;
        }
    }

    if audio.len() <= ULTRA_SHORT_SAMPLES {
        let _ = engine.transcribe_samples(
            audio.to_vec(),
            SAMPLE_RATE as u32,
            1,
            Some(TimestampMode::Sentences),
        )?;
        let _ = engine.transcribe_samples(
            audio.to_vec(),
            SAMPLE_RATE as u32,
            1,
            Some(TimestampMode::Words),
        )?;
    }

    let _ = engine.transcribe_samples(
        decode_audio,
        SAMPLE_RATE as u32,
        1,
        Some(TimestampMode::Sentences),
    )?;

    Ok(display_text)
}

fn run_fast_short_path(engine: &mut ParakeetTDT, audio: &[f32]) -> anyhow::Result<String> {
    let decode_audio = pad_short_phrase(audio);
    Ok(engine
        .transcribe_samples(
            decode_audio,
            SAMPLE_RATE as u32,
            1,
            Some(TimestampMode::Sentences),
        )?
        .text)
}

fn main() -> anyhow::Result<()> {
    let model_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                r"C:\Users\ziani\AppData\Roaming\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8",
            )
        });

    let intra_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);

    let load_start = Instant::now();
    let mut engine = ParakeetTDT::from_pretrained_with_cache(
        &model_dir,
        Some(
            ExecutionConfig::new()
                .with_execution_provider(ExecutionProvider::Cpu)
                .with_intra_threads(intra_threads)
                .with_inter_threads(1),
        ),
        None,
    )?;
    println!("LOAD_MS={}", load_start.elapsed().as_millis());

    for seconds in [1usize, 2, 4] {
        let audio = sine_audio(seconds * SAMPLE_RATE);
        let mode = if audio.len() <= FAST_SHORT_SAMPLES {
            "fast_short_path"
        } else {
            "regular_short_path"
        };

        let legacy_start = Instant::now();
        let legacy_text = run_legacy_short_path(&mut engine, &audio)?;
        let legacy_ms = legacy_start.elapsed().as_millis();

        let fast_start = Instant::now();
        let fast_text = run_fast_short_path(&mut engine, &audio)?;
        let fast_ms = fast_start.elapsed().as_millis();

        let saved_ms = legacy_ms.saturating_sub(fast_ms);
        let saved_pct = if legacy_ms > 0 {
            (saved_ms as f64 / legacy_ms as f64) * 100.0
        } else {
            0.0
        };

        println!("CASE={}s MODE={}", seconds, mode);
        println!("LEGACY_MS={}", legacy_ms);
        println!("FAST_MS={}", fast_ms);
        println!("SAVED_MS={}", saved_ms);
        println!("SAVED_PCT={:.1}", saved_pct);
        println!("LEGACY_TEXT={}", legacy_text.replace('\n', " "));
        println!("FAST_TEXT={}", fast_text.replace('\n', " "));
    }

    Ok(())
}

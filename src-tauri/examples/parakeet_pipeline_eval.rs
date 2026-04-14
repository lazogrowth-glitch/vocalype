use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use parakeet_rs::{ParakeetTDT, TimestampMode, Transcriber};
use serde::Serialize;
use vocalype_app_lib::audio_toolkit::apply_custom_words;
use vocalype_app_lib::chunking::deduplicate_boundary_n;
use vocalype_app_lib::eval::dataset::EvalDatasetManifest;
use vocalype_app_lib::eval::metrics::{compute_metrics, EvalMetrics};
use vocalype_app_lib::eval::report::{
    aggregate_by_scenario, aggregate_reports, AggregateInput, AggregateReport,
};
use vocalype_app_lib::model_ids::{
    PARAKEET_V3_ENGLISH_ID, PARAKEET_V3_LEGACY_ID, PARAKEET_V3_MULTILINGUAL_ID,
};
use vocalype_app_lib::parakeet_text::{
    finalize_parakeet_text, maybe_prefer_sentence_punctuation, parakeet_builtin_correction_terms,
    parakeet_chunk_ends_sentence, should_attempt_sentence_punctuation,
};

const SAMPLE_RATE: u32 = 16_000;
const MIN_FINAL_CHUNK_SAMPLES: usize = 8_000;
const PARAKEET_LOW_ENERGY_RMS_THRESHOLD: f32 = 0.05;
const PARAKEET_LOW_ENERGY_TARGET_RMS: f32 = 0.1;
const PARAKEET_LOW_ENERGY_MAX_GAIN: f32 = 4.5;

#[derive(Debug, Clone, Copy)]
struct ChunkProfile {
    interval_samples: usize,
    overlap_samples: usize,
}

#[derive(Serialize)]
struct PipelineSampleReport {
    sample_id: String,
    scenario: String,
    language: String,
    chunk_count: usize,
    latency_ms: u128,
    metrics: EvalMetrics,
    hypothesis_text: String,
}

#[derive(Serialize)]
struct PipelineAggregateReport {
    quality: AggregateReport,
    avg_latency_ms: f32,
    avg_chunk_count: f32,
}

#[derive(Serialize)]
struct PipelineFullReport {
    model_id: String,
    manifest_path: String,
    aggregate: PipelineAggregateReport,
    by_scenario: std::collections::HashMap<String, PipelineAggregateReport>,
    samples: Vec<PipelineSampleReport>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let model_dir =
        PathBuf::from(args.next().ok_or(
            "usage: cargo run --example parakeet_pipeline_eval -- <model_dir> <manifest.json> [model_id] [output.json]",
        )?);
    let manifest_path =
        PathBuf::from(args.next().ok_or(
            "usage: cargo run --example parakeet_pipeline_eval -- <model_dir> <manifest.json> [model_id] [output.json]",
        )?);
    let model_id = args
        .next()
        .unwrap_or_else(|| PARAKEET_V3_MULTILINGUAL_ID.to_string());
    let output_path = args.next().map(PathBuf::from);

    let manifest: EvalDatasetManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let manifest_dir = manifest_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let mut engine = ParakeetTDT::from_pretrained(&model_dir, None)?;
    let mut reports = Vec::new();

    for sample in manifest.samples {
        let audio_path = manifest_dir.join(&sample.audio_path);
        let audio = load_wav_mono_16k(&audio_path)?;
        let profile = profile_for_model_and_language(&model_id, &sample.language);
        let started = Instant::now();
        let (hypothesis_text, chunk_count) = run_chunked_pipeline(
            &mut engine,
            &audio,
            profile,
            &sample.language,
            &sample.sample_id,
        )?;
        let latency_ms = started.elapsed().as_millis();
        let metrics = compute_metrics(&sample.reference_text, &hypothesis_text);

        println!(
            "{}\t{}\tchunks={}\tlatency={}ms\tWER={:.4}\tCER={:.4}\tOMIT={:.4}\tDUP={:.4}\tHALL={:.4}\tEND={:.4}",
            sample.sample_id,
            sample.scenario,
            chunk_count,
            latency_ms,
            metrics.wer,
            metrics.cer,
            metrics.omission_rate,
            metrics.duplication_rate,
            metrics.hallucination_rate,
            metrics.end_truncation_score
        );

        reports.push(PipelineSampleReport {
            sample_id: sample.sample_id,
            scenario: sample.scenario,
            language: sample.language,
            chunk_count,
            latency_ms,
            metrics,
            hypothesis_text,
        });
    }

    let report = PipelineFullReport {
        model_id,
        manifest_path: manifest_path.display().to_string(),
        aggregate: aggregate_pipeline_reports(&reports),
        by_scenario: aggregate_pipeline_by_scenario(&reports),
        samples: reports,
    };

    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = output_path {
        fs::write(&path, json)?;
        println!("Wrote pipeline report to {}", path.display());
    } else {
        println!("{}", json);
    }

    Ok(())
}

fn run_chunked_pipeline(
    engine: &mut ParakeetTDT,
    audio: &[f32],
    profile: ChunkProfile,
    selected_language: &str,
    sample_id: &str,
) -> Result<(String, usize), Box<dyn std::error::Error>> {
    let mut results: Vec<String> = Vec::new();
    let mut last_committed = 0usize;
    let mut next_idx = 0usize;
    let debug_sample = std::env::var("VOCALYPE_EVAL_DEBUG_SAMPLE")
        .ok()
        .filter(|wanted| wanted == sample_id);

    while audio.len().saturating_sub(last_committed) >= profile.interval_samples {
        let actual_overlap = last_committed.min(profile.overlap_samples);
        let chunk_start = last_committed.saturating_sub(actual_overlap);
        let chunk_end = last_committed + profile.interval_samples;
        let chunk = audio[chunk_start..chunk_end].to_vec();
        let cutoff_secs = actual_overlap as f32 / SAMPLE_RATE as f32;
        let text = transcribe_parakeet_chunk(engine, chunk, cutoff_secs)?;
        if debug_sample.is_some() {
            eprintln!(
                "[debug:{sample_id}] chunk={next_idx} start={chunk_start} end={chunk_end} cutoff={cutoff_secs:.3}s text={:?}",
                text
            );
        }
        results.push(text);
        last_committed = chunk_end;
        next_idx += 1;
    }

    let actual_overlap = last_committed.min(profile.overlap_samples);
    let overlap_start = last_committed.saturating_sub(actual_overlap);
    let remaining = audio[overlap_start..].to_vec();
    if remaining.len() >= MIN_FINAL_CHUNK_SAMPLES {
        let text = transcribe_parakeet_chunk(
            engine,
            remaining,
            actual_overlap as f32 / SAMPLE_RATE as f32,
        )?;
        if debug_sample.is_some() {
            eprintln!(
                "[debug:{sample_id}] chunk={next_idx} start={overlap_start} end={} cutoff={:.3}s text={:?}",
                audio.len(),
                actual_overlap as f32 / SAMPLE_RATE as f32,
                text
            );
        }
        results.push(text);
        next_idx += 1;
    }

    let mut assembled = assemble_parakeet_results(&results);
    if should_attempt_full_audio_recovery(&results, audio.len(), profile, &assembled) {
        // Add 0.25s of silence so the model can cleanly decode the last word
        let mut recovery_audio = audio.to_vec();
        recovery_audio.extend(std::iter::repeat(0.0f32).take(4_000));
        let recovered = transcribe_parakeet_chunk(engine, recovery_audio, 0.0)?;
        if should_promote_full_audio_recovery(&assembled, &recovered, audio.len()) {
            if debug_sample.is_some() {
                eprintln!(
                    "[debug:{sample_id}] promoted full-audio recovery: {} -> {} words",
                    assembled.split_whitespace().count(),
                    recovered.split_whitespace().count()
                );
            }
            assembled = recovered;
        }
    }
    if debug_sample.is_some() {
        eprintln!("[debug:{sample_id}] assembled={assembled:?}");
    }
    let corrected = apply_custom_words(
        &assembled,
        &parakeet_builtin_correction_terms(selected_language),
        0.24,
    );
    Ok((
        finalize_parakeet_text(&corrected, selected_language),
        next_idx,
    ))
}

fn transcribe_parakeet_chunk(
    engine: &mut ParakeetTDT,
    audio: Vec<f32>,
    overlap_cutoff_secs: f32,
) -> Result<String, Box<dyn std::error::Error>> {
    let decode_audio = maybe_boost_low_energy_parakeet_audio(&audio)
        .map(|(samples, _)| samples)
        .unwrap_or(audio.clone());
    let result = engine.transcribe_samples(
        decode_audio.clone(),
        SAMPLE_RATE,
        1,
        Some(TimestampMode::Words),
    )?;
    let mut preferred_text = result.text.clone();
    if should_attempt_sentence_punctuation(&preferred_text) {
        if let Ok(sentence_result) = engine.transcribe_samples(
            decode_audio.clone(),
            SAMPLE_RATE,
            1,
            Some(TimestampMode::Sentences),
        ) {
            if let Some(punctuated) =
                maybe_prefer_sentence_punctuation(&preferred_text, &sentence_result.text)
            {
                preferred_text = punctuated;
            }
        }
    }

    if overlap_cutoff_secs <= 0.0 {
        return Ok(preferred_text);
    }

    let mut trimmed = String::new();
    let mut kept = 0usize;
    for token in result
        .tokens
        .iter()
        .filter(|t| t.start >= overlap_cutoff_secs)
    {
        let is_punct = token.text.len() == 1
            && token
                .text
                .chars()
                .all(|c| matches!(c, '.' | ',' | '!' | '?' | ';' | ':' | ')'));
        if !trimmed.is_empty() && !is_punct {
            trimmed.push(' ');
        }
        trimmed.push_str(token.text.trim());
        kept += 1;
    }

    if kept == 0 {
        let skip = (overlap_cutoff_secs * SAMPLE_RATE as f32) as usize;
        let retry_audio = decode_audio[skip.min(decode_audio.len())..].to_vec();
        if retry_audio.len() >= MIN_FINAL_CHUNK_SAMPLES {
            let retry = engine.transcribe_samples(
                retry_audio,
                SAMPLE_RATE,
                1,
                Some(TimestampMode::Words),
            )?;
            return Ok(retry.text);
        }
    }

    let trimmed = trimmed.trim().to_string();
    if trimmed.is_empty() {
        Ok(trimmed)
    } else if let Some(punctuated) = maybe_prefer_sentence_punctuation(&trimmed, &preferred_text) {
        Ok(punctuated)
    } else {
        Ok(trimmed)
    }
}

fn assemble_parakeet_results(results: &[String]) -> String {
    let non_empty: Vec<&str> = results
        .iter()
        .map(String::as_str)
        .filter(|t| !t.trim().is_empty())
        .collect();

    let mut out = String::new();
    for (i, chunk) in non_empty.iter().enumerate() {
        if i == 0 {
            out.push_str(chunk.trim());
            continue;
        }

        let deduped = deduplicate_boundary_n(&out, chunk, 3);
        if deduped.is_empty() {
            continue;
        }

        let prev_ends_sentence = parakeet_chunk_ends_sentence(&out, &deduped);
        if !out.is_empty() {
            out.push(' ');
        }
        let mut chars = deduped.chars();
        if let Some(first) = chars.next() {
            if prev_ends_sentence {
                for uc in first.to_uppercase() {
                    out.push(uc);
                }
            } else {
                for lc in first.to_lowercase() {
                    out.push(lc);
                }
            }
            out.push_str(chars.as_str());
        }
    }
    out
}

fn should_attempt_full_audio_recovery(
    results: &[String],
    sample_count: usize,
    profile: ChunkProfile,
    assembled: &str,
) -> bool {
    let duration_secs = sample_count as f32 / SAMPLE_RATE as f32;
    if !(6.0..=45.0).contains(&duration_secs) {
        return false;
    }

    let assembled_words = assembled.split_whitespace().count();
    let assembled_words_per_sec = assembled_words as f32 / duration_secs.max(0.1);
    let empty_boundary = results
        .iter()
        .take(results.len().saturating_sub(1))
        .any(|text| text.trim().is_empty())
        && assembled_words_per_sec <= 1.45;
    let severe_low_density = assembled_words_per_sec <= 1.05 && duration_secs >= 12.0;

    let final_chunk_secs = estimate_final_chunk_secs(sample_count, results.len(), profile);
    let final_chunk_words = results
        .last()
        .map(|text| text.split_whitespace().count())
        .unwrap_or(0);
    let final_chunk_words_per_sec = final_chunk_words as f32 / final_chunk_secs.max(0.1);
    let short_final_chunk = final_chunk_secs >= 1.0
        && final_chunk_secs <= 6.0
        && final_chunk_words <= 2
        && assembled_words_per_sec <= 2.5;
    let sparse_final_chunk = final_chunk_secs >= 3.0
        && final_chunk_words_per_sec <= 0.35
        && assembled_words_per_sec <= 2.0;
    let empty_final_chunk =
        final_chunk_words == 0 && final_chunk_secs >= 2.0 && assembled_words_per_sec <= 2.5;

    empty_boundary
        || severe_low_density
        || short_final_chunk
        || sparse_final_chunk
        || empty_final_chunk
}

fn estimate_final_chunk_secs(
    sample_count: usize,
    result_count: usize,
    profile: ChunkProfile,
) -> f32 {
    if result_count <= 1 {
        return sample_count as f32 / SAMPLE_RATE as f32;
    }

    let full_background_chunks = result_count.saturating_sub(1);
    let last_committed = full_background_chunks * profile.interval_samples;
    let actual_overlap = last_committed.min(profile.overlap_samples);
    let final_chunk_samples =
        sample_count.saturating_sub(last_committed.saturating_sub(actual_overlap));
    final_chunk_samples as f32 / SAMPLE_RATE as f32
}

fn should_promote_full_audio_recovery(
    assembled: &str,
    recovered: &str,
    sample_count: usize,
) -> bool {
    let assembled_words = assembled.split_whitespace().count();
    let recovered_words = recovered.split_whitespace().count();
    let duration_secs = sample_count as f32 / SAMPLE_RATE as f32;
    let recovered_words_per_sec = recovered_words as f32 / duration_secs.max(0.1);

    recovered_words >= assembled_words + 3
        && (recovered_words as f32) >= (assembled_words as f32 * 1.15)
        && (0.4..=5.5).contains(&recovered_words_per_sec)
        && recovered.chars().filter(|ch| ch.is_alphabetic()).count() >= 12
}

fn audio_rms_and_peak(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let sum = samples.iter().map(|sample| sample * sample).sum::<f32>();
    let peak = samples
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max);
    ((sum / samples.len() as f32).sqrt(), peak)
}

fn maybe_boost_low_energy_parakeet_audio(samples: &[f32]) -> Option<(Vec<f32>, f32)> {
    let (rms, peak) = audio_rms_and_peak(samples);
    if rms <= 0.0 || rms >= PARAKEET_LOW_ENERGY_RMS_THRESHOLD || peak >= 0.92 {
        return None;
    }

    let gain_from_rms = PARAKEET_LOW_ENERGY_TARGET_RMS / rms;
    let gain_from_peak = if peak > 0.0 { 0.98 / peak } else { 1.0 };
    let gain = gain_from_rms
        .min(gain_from_peak)
        .min(PARAKEET_LOW_ENERGY_MAX_GAIN);

    if gain <= 1.15 {
        return None;
    }

    Some((
        samples
            .iter()
            .map(|sample| (sample * gain).clamp(-1.0, 1.0))
            .collect(),
        gain,
    ))
}

#[allow(dead_code)]
fn parakeet_builtin_correction_terms_legacy(selected_language: &str) -> Vec<String> {
    let mut terms = vec![
        "Parakeet".to_string(),
        "Parakeet V3".to_string(),
        "Vocalype".to_string(),
        "GitHub".to_string(),
        "OpenAI".to_string(),
        "Microsoft".to_string(),
    ];

    match selected_language {
        "fr" => {
            terms.push("aujourd'hui".to_string());
            terms.push("vérifier".to_string());
            terms.push("modèle".to_string());
        }
        "en" => {
            terms.push("today".to_string());
        }
        _ => {}
    }

    terms
}

fn profile_for_model_and_language(model_id: &str, selected_language: &str) -> ChunkProfile {
    if let Ok(chunk_seconds) = std::env::var("VOCALYPE_EVAL_CHUNK_SECONDS") {
        if let Ok(chunk_seconds) = chunk_seconds.parse::<usize>() {
            return ChunkProfile {
                interval_samples: chunk_seconds.max(1) * 16_000,
                overlap_samples: 16_000,
            };
        }
    }

    match model_id {
        PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_MULTILINGUAL_ID | PARAKEET_V3_LEGACY_ID
            if selected_language.starts_with("fr") =>
        {
            ChunkProfile {
                interval_samples: 12 * 16_000,
                overlap_samples: 16_000,
            }
        }
        PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_MULTILINGUAL_ID | PARAKEET_V3_LEGACY_ID => {
            ChunkProfile {
                interval_samples: 12 * 16_000,
                overlap_samples: 16_000,
            }
        }
        _ => ChunkProfile {
            interval_samples: 12 * 16_000,
            overlap_samples: 16_000,
        },
    }
}

fn load_wav_mono_16k(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    if spec.sample_rate != SAMPLE_RATE {
        return Err(format!(
            "Unsupported sample rate {} for {}. Expected 16000 Hz.",
            spec.sample_rate,
            path.display()
        )
        .into());
    }

    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?,
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32768.0))
            .collect::<Result<Vec<_>, _>>()?,
    };

    if spec.channels <= 1 {
        return Ok(raw);
    }

    Ok(raw
        .chunks(spec.channels as usize)
        .map(|chunk| chunk.iter().sum::<f32>() / spec.channels as f32)
        .collect())
}

fn aggregate_pipeline_by_scenario(
    samples: &[PipelineSampleReport],
) -> std::collections::HashMap<String, PipelineAggregateReport> {
    let inputs: Vec<AggregateInput<'_>> = samples
        .iter()
        .map(|sample| AggregateInput {
            scenario: &sample.scenario,
            metrics: &sample.metrics,
        })
        .collect();
    aggregate_by_scenario(&inputs)
        .into_iter()
        .map(|(scenario, quality)| {
            let matching: Vec<&PipelineSampleReport> =
                samples.iter().filter(|s| s.scenario == scenario).collect();
            let count = matching.len().max(1) as f32;
            (
                scenario,
                PipelineAggregateReport {
                    quality,
                    avg_latency_ms: matching.iter().map(|s| s.latency_ms as f32).sum::<f32>()
                        / count,
                    avg_chunk_count: matching.iter().map(|s| s.chunk_count as f32).sum::<f32>()
                        / count,
                },
            )
        })
        .collect()
}

fn aggregate_pipeline_reports(samples: &[PipelineSampleReport]) -> PipelineAggregateReport {
    let quality = aggregate_reports(
        samples
            .iter()
            .map(|sample| AggregateInput {
                scenario: &sample.scenario,
                metrics: &sample.metrics,
            })
            .collect(),
    );
    let count = samples.len().max(1) as f32;
    PipelineAggregateReport {
        quality,
        avg_latency_ms: samples.iter().map(|s| s.latency_ms as f32).sum::<f32>() / count,
        avg_chunk_count: samples.iter().map(|s| s.chunk_count as f32).sum::<f32>() / count,
    }
}

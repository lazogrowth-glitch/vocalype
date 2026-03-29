use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use vocalype_app_lib::eval::dataset::EvalDatasetManifest;
use vocalype_app_lib::eval::metrics::{compute_metrics, EvalMetrics};
use vocalype_app_lib::eval::report::{
    aggregate_by_scenario, aggregate_reports, AggregateInput, AggregateReport,
};

#[derive(Serialize)]
struct SampleReport {
    sample_id: String,
    scenario: String,
    language: String,
    metrics: EvalMetrics,
}

#[derive(Serialize)]
struct FullReport {
    aggregate: AggregateReport,
    by_scenario: std::collections::HashMap<String, AggregateReport>,
    samples: Vec<SampleReport>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let manifest_path = PathBuf::from(
        args.next()
            .ok_or("usage: cargo run --example parakeet_eval -- <manifest.json> <hypothesis_dir> [output.json]")?,
    );
    let hypothesis_dir = PathBuf::from(
        args.next()
            .ok_or("usage: cargo run --example parakeet_eval -- <manifest.json> <hypothesis_dir> [output.json]")?,
    );
    let output_path = args.next().map(PathBuf::from);

    let manifest: EvalDatasetManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let mut sample_reports = Vec::new();

    for sample in manifest.samples {
        let hyp_path = hypothesis_dir.join(format!("{}.txt", sample.sample_id));
        let hypothesis = fs::read_to_string(&hyp_path).unwrap_or_default();
        let metrics = compute_metrics(&sample.reference_text, &hypothesis);
        println!(
            "{}\t{}\tWER={:.4}\tCER={:.4}\tOMIT={:.4}\tDUP={:.4}\tHALL={:.4}\tEND={:.4}",
            sample.sample_id,
            sample.scenario,
            metrics.wer,
            metrics.cer,
            metrics.omission_rate,
            metrics.duplication_rate,
            metrics.hallucination_rate,
            metrics.end_truncation_score
        );
        sample_reports.push(SampleReport {
            sample_id: sample.sample_id,
            scenario: sample.scenario,
            language: sample.language,
            metrics,
        });
    }

    let report = FullReport {
        aggregate: aggregate_reports(
            sample_reports
                .iter()
                .map(|sample| AggregateInput {
                    scenario: &sample.scenario,
                    metrics: &sample.metrics,
                })
                .collect(),
        ),
        by_scenario: aggregate_by_scenario(
            &sample_reports
                .iter()
                .map(|sample| AggregateInput {
                    scenario: &sample.scenario,
                    metrics: &sample.metrics,
                })
                .collect::<Vec<_>>(),
        ),
        samples: sample_reports,
    };

    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = output_path {
        fs::write(&path, json)?;
        println!("Wrote report to {}", path.display());
    } else {
        println!("{}", json);
    }

    Ok(())
}

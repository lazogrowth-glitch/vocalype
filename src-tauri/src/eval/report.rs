use crate::eval::metrics::{EvalMetrics, WordDelta};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct AggregateReport {
    pub samples: usize,
    pub global_wer: f32,
    pub global_cer: f32,
    pub global_omission_rate: f32,
    pub global_duplication_rate: f32,
    pub global_hallucination_rate: f32,
    pub average_end_truncation_score: f32,
    pub top_omitted_terms: Vec<WordDelta>,
    pub top_duplicated_terms: Vec<WordDelta>,
    pub top_hallucinated_terms: Vec<WordDelta>,
}

#[derive(Debug, Clone)]
pub struct AggregateInput<'a> {
    pub scenario: &'a str,
    pub metrics: &'a EvalMetrics,
}

pub fn aggregate_reports(items: Vec<AggregateInput<'_>>) -> AggregateReport {
    let count = items.len().max(1) as f32;
    AggregateReport {
        samples: items.len(),
        global_wer: items.iter().map(|s| s.metrics.wer).sum::<f32>() / count,
        global_cer: items.iter().map(|s| s.metrics.cer).sum::<f32>() / count,
        global_omission_rate: items
            .iter()
            .map(|s| s.metrics.omission_rate)
            .sum::<f32>()
            / count,
        global_duplication_rate: items
            .iter()
            .map(|s| s.metrics.duplication_rate)
            .sum::<f32>()
            / count,
        global_hallucination_rate: items
            .iter()
            .map(|s| s.metrics.hallucination_rate)
            .sum::<f32>()
            / count,
        average_end_truncation_score: items
            .iter()
            .map(|s| s.metrics.end_truncation_score)
            .sum::<f32>()
            / count,
        top_omitted_terms: aggregate_terms(items.iter().flat_map(|s| s.metrics.omitted_terms.iter())),
        top_duplicated_terms: aggregate_terms(
            items.iter().flat_map(|s| s.metrics.duplicated_terms.iter()),
        ),
        top_hallucinated_terms: aggregate_terms(
            items.iter().flat_map(|s| s.metrics.hallucinated_terms.iter()),
        ),
    }
}

pub fn aggregate_by_scenario<'a>(
    items: &'a [AggregateInput<'a>],
) -> HashMap<String, AggregateReport> {
    let mut buckets: HashMap<String, Vec<AggregateInput<'a>>> = HashMap::new();
    for item in items {
        buckets
            .entry(item.scenario.to_string())
            .or_default()
            .push(AggregateInput {
                scenario: item.scenario,
                metrics: item.metrics,
            });
    }
    buckets
        .into_iter()
        .map(|(scenario, reports)| (scenario, aggregate_reports(reports)))
        .collect()
}

fn aggregate_terms<'a>(terms: impl Iterator<Item = &'a WordDelta>) -> Vec<WordDelta> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for term in terms {
        *counts.entry(term.word.clone()).or_insert(0) += term.count;
    }
    let mut out: Vec<WordDelta> = counts
        .into_iter()
        .map(|(word, count)| WordDelta { word, count })
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.word.cmp(&b.word)));
    out.truncate(10);
    out
}

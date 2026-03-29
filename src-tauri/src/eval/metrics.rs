use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordDelta {
    pub word: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalMetrics {
    pub wer: f32,
    pub cer: f32,
    pub omission_rate: f32,
    pub duplication_rate: f32,
    pub hallucination_rate: f32,
    pub end_truncation_score: f32,
    pub reference_word_count: usize,
    pub hypothesis_word_count: usize,
    pub reference_char_count: usize,
    pub hypothesis_char_count: usize,
    pub omitted_words: usize,
    pub duplicated_words: usize,
    pub hallucinated_words: usize,
    pub suffix_match_words: usize,
    pub omitted_terms: Vec<WordDelta>,
    pub duplicated_terms: Vec<WordDelta>,
    pub hallucinated_terms: Vec<WordDelta>,
}

pub fn compute_metrics(reference: &str, hypothesis: &str) -> EvalMetrics {
    let ref_words = tokenize_words(reference);
    let hyp_words = tokenize_words(hypothesis);
    let ref_chars: Vec<char> = normalize_chars(reference);
    let hyp_chars: Vec<char> = normalize_chars(hypothesis);

    let wer = if ref_words.is_empty() {
        0.0
    } else {
        levenshtein(&ref_words, &hyp_words) as f32 / ref_words.len() as f32
    };
    let cer = if ref_chars.is_empty() {
        0.0
    } else {
        levenshtein(&ref_chars, &hyp_chars) as f32 / ref_chars.len() as f32
    };

    let ref_counts = word_counts(&ref_words);
    let hyp_counts = word_counts(&hyp_words);
    let omitted_words = ref_counts
        .iter()
        .map(|(word, ref_count)| {
            ref_count.saturating_sub(*hyp_counts.get(word).unwrap_or(&0))
        })
        .sum::<usize>();
    let omitted_terms = sorted_positive_deltas(&ref_counts, &hyp_counts);
    let hallucinated_words = hyp_counts
        .iter()
        .map(|(word, hyp_count)| {
            hyp_count.saturating_sub(*ref_counts.get(word).unwrap_or(&0))
        })
        .sum::<usize>();
    let hallucinated_terms = sorted_positive_deltas(&hyp_counts, &ref_counts);
    let duplicated_words = hyp_counts
        .iter()
        .map(|(word, hyp_count)| hyp_count.saturating_sub(*ref_counts.get(word).unwrap_or(&0)))
        .sum::<usize>();
    let duplicated_terms = sorted_positive_deltas(&hyp_counts, &ref_counts);

    let omission_rate = if ref_words.is_empty() {
        0.0
    } else {
        omitted_words as f32 / ref_words.len() as f32
    };
    let hallucination_rate = if hyp_words.is_empty() {
        0.0
    } else {
        hallucinated_words as f32 / hyp_words.len() as f32
    };
    let duplication_rate = if hyp_words.is_empty() {
        0.0
    } else {
        duplicated_words as f32 / hyp_words.len() as f32
    };

    let suffix_match_words = matching_suffix_words(&ref_words, &hyp_words);
    let end_truncation_score = if ref_words.is_empty() {
        0.0
    } else {
        1.0 - (suffix_match_words as f32 / ref_words.len().min(12) as f32)
    }
    .clamp(0.0, 1.0);

    EvalMetrics {
        wer,
        cer,
        omission_rate,
        duplication_rate,
        hallucination_rate,
        end_truncation_score,
        reference_word_count: ref_words.len(),
        hypothesis_word_count: hyp_words.len(),
        reference_char_count: ref_chars.len(),
        hypothesis_char_count: hyp_chars.len(),
        omitted_words,
        duplicated_words,
        hallucinated_words,
        suffix_match_words,
        omitted_terms,
        duplicated_terms,
        hallucinated_terms,
    }
}

fn tokenize_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

fn normalize_chars(text: &str) -> Vec<char> {
    text.to_lowercase()
        .chars()
        .filter(|c| !c.is_control())
        .collect()
}

fn word_counts(words: &[String]) -> HashMap<String, usize> {
    let mut map = HashMap::new();
    for word in words {
        *map.entry(word.clone()).or_insert(0) += 1;
    }
    map
}

fn sorted_positive_deltas(
    source: &HashMap<String, usize>,
    baseline: &HashMap<String, usize>,
) -> Vec<WordDelta> {
    let mut out: Vec<WordDelta> = source
        .iter()
        .filter_map(|(word, source_count)| {
            let delta = source_count.saturating_sub(*baseline.get(word).unwrap_or(&0));
            if delta > 0 {
                Some(WordDelta {
                    word: word.clone(),
                    count: delta,
                })
            } else {
                None
            }
        })
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.word.cmp(&b.word)));
    out
}

fn matching_suffix_words(reference: &[String], hypothesis: &[String]) -> usize {
    let max_len = reference.len().min(hypothesis.len()).min(12);
    let mut matches = 0;
    for i in 0..max_len {
        if reference[reference.len() - 1 - i] == hypothesis[hypothesis.len() - 1 - i] {
            matches += 1;
        } else {
            break;
        }
    }
    matches
}

fn levenshtein<T: PartialEq>(left: &[T], right: &[T]) -> usize {
    if left.is_empty() {
        return right.len();
    }
    if right.is_empty() {
        return left.len();
    }

    let mut prev: Vec<usize> = (0..=right.len()).collect();
    let mut curr = vec![0_usize; right.len() + 1];

    for (i, l) in left.iter().enumerate() {
        curr[0] = i + 1;
        for (j, r) in right.iter().enumerate() {
            let cost = if l == r { 0 } else { 1 };
            curr[j + 1] = (curr[j] + 1).min(prev[j + 1] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[right.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_zero_on_exact_match() {
        let metrics = compute_metrics("bonjour le monde", "bonjour le monde");
        assert_eq!(metrics.wer, 0.0);
        assert_eq!(metrics.cer, 0.0);
        assert_eq!(metrics.omission_rate, 0.0);
        assert_eq!(metrics.hallucination_rate, 0.0);
        assert!(metrics.omitted_terms.is_empty());
    }

    #[test]
    fn metrics_detect_word_error() {
        let metrics = compute_metrics("bonjour le monde", "bonjour monde");
        assert!(metrics.wer > 0.0);
        assert!(metrics.omitted_words > 0);
        assert_eq!(metrics.omitted_terms[0].word, "le");
    }

    #[test]
    fn metrics_detect_end_truncation() {
        let metrics = compute_metrics(
            "je veux tester la fin de cette phrase assez longue",
            "je veux tester la fin",
        );
        assert!(metrics.end_truncation_score > 0.0);
    }
}

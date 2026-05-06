//! Text processing pipeline.
//!
//! ## Current pipeline order (see `actions/post_processing.rs`):
//!
//! 1. Chinese variant conversion  (`post_processing::maybe_convert_chinese_variant`)
//! 2. Filler removal              (`filler::clean_transcript`)
//! 3. Punctuation restoration     (`punctuation::fix_punctuation`)
//! 4. Dictionary replacement      (`dictionary::apply_dictionary`)
//! 5. Voice snippets              (`settings::apply_voice_snippets`)
//! 6. LLM post-processing         (`post_processing::post_process_transcription`)
//!
//! ## Extending the pipeline
//!
//! Implement [`SyncProcessingStep`] for pure-text transforms (no async, no app state)
//! and add your step to the relevant position in `actions/post_processing.rs`.
#![allow(dead_code)]

pub mod correction_tracker;
pub mod dictionary;
pub mod filler;
pub mod post_processing;
pub mod punctuation;

use crate::context_detector::{AppContextCategory, AppTranscriptionContext};

// ── Pipeline context ─────────────────────────────────────────────────────────

/// Immutable context passed to every processing step.
#[derive(Clone, Debug)]
pub struct ProcessingContext<'a> {
    /// Detected active application context (code editor, chat, email, …).
    pub app_context: Option<&'a AppTranscriptionContext>,
    /// ISO language code of the transcription (e.g. "fr", "en", "auto").
    pub language: &'a str,
}

impl<'a> ProcessingContext<'a> {
    pub fn new(app_context: Option<&'a AppTranscriptionContext>, language: &'a str) -> Self {
        Self {
            app_context,
            language,
        }
    }

    /// Shorthand for the resolved context category.
    pub fn category(&self) -> AppContextCategory {
        self.app_context
            .map(|ctx| ctx.category)
            .unwrap_or(AppContextCategory::Unknown)
    }
}

// ── Step trait ───────────────────────────────────────────────────────────────

/// A single synchronous text-transformation step.
///
/// Implement this for pure transforms (no I/O, no async).
/// Async steps (LLM calls, Chinese conversion) remain standalone `async fn`s.
pub trait SyncProcessingStep: Send + Sync {
    /// Human-readable step name used for profiling labels.
    fn name(&self) -> &'static str;

    /// Transform `text` given the current `ctx`. Return the (possibly unchanged) text.
    fn apply(&self, text: String, ctx: &ProcessingContext<'_>) -> String;
}

// ── Concrete step wrappers ───────────────────────────────────────────────────

/// Wraps `filler::clean_transcript` as a [`SyncProcessingStep`].
pub struct FillerStep;

impl SyncProcessingStep for FillerStep {
    fn name(&self) -> &'static str {
        "filler_removal"
    }
    fn apply(&self, text: String, _ctx: &ProcessingContext<'_>) -> String {
        filler::clean_transcript(&text)
    }
}

/// Wraps `punctuation::fix_punctuation` as a [`SyncProcessingStep`].
pub struct PunctuationStep;

impl SyncProcessingStep for PunctuationStep {
    fn name(&self) -> &'static str {
        "punctuation_fix"
    }
    fn apply(&self, text: String, ctx: &ProcessingContext<'_>) -> String {
        punctuation::fix_punctuation(&text, ctx.category())
    }
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/// Chains [`SyncProcessingStep`]s in order.
///
/// Async steps (LLM, Chinese conversion) are not included here — they live in
/// `actions/post_processing.rs` where they can be awaited with proper profiling.
pub struct SyncPipeline {
    steps: Vec<Box<dyn SyncProcessingStep>>,
}

impl SyncPipeline {
    /// Build the standard sync pipeline: filler → punctuation.
    pub fn standard() -> Self {
        Self {
            steps: vec![Box::new(FillerStep), Box::new(PunctuationStep)],
        }
    }

    /// Run all steps in order, returning the final text.
    pub fn run(&self, text: String, ctx: &ProcessingContext<'_>) -> String {
        self.steps.iter().fold(text, |t, step| step.apply(t, ctx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn en_ctx<'a>() -> ProcessingContext<'a> {
        ProcessingContext::new(None, "en")
    }

    #[test]
    fn filler_step_removes_euh() {
        let step = FillerStep;
        let result = step.apply("euh bonjour".to_string(), &en_ctx());
        assert!(!result.contains("euh"), "got: {result}");
    }

    #[test]
    fn punctuation_step_capitalises() {
        let step = PunctuationStep;
        let result = step.apply("hello world".to_string(), &en_ctx());
        assert!(result.starts_with('H'), "got: {result}");
    }

    #[test]
    fn standard_pipeline_chains_both() {
        let pipeline = SyncPipeline::standard();
        let ctx = en_ctx();
        let result = pipeline.run("um hello world".to_string(), &ctx);
        assert!(!result.contains("um"), "filler not removed: {result}");
        assert!(result.starts_with('H'), "not capitalised: {result}");
    }
}

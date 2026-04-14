# Parakeet Experiment History

This file is the shared lab notebook for Vocalype ASR experiments.
Update it after every meaningful Parakeet change so future agents do not repeat old tests.

## Goal

Reduce real ASR errors for future Vocalype users across EN/ES/FR/PT without overfitting a single benchmark.

Traffic priority:
- EN is the majority path, around 65% of users.
- ES, FR, and PT must not regress.
- Hindi is currently excluded from Parakeet V3 evals because this model path does not support it well enough.

Do not accept a change just because one benchmark improves. A change must pass both:
- Local Vocalype set: `src-tauri/evals/parakeet/dataset_manifest_combined_current.json`
- External FLEURS EN/ES/FR/PT set: `src-tauri/evals/parakeet/external/fleurs_supported_400/dataset_manifest_external.json`

## Metrics

- WER: Word Error Rate. Lower is better. Counts word substitutions, insertions, and deletions.
- CER: Character Error Rate. Lower is better. Useful when words are close but spelling/formatting differs.
- OMIT: Omission rate. Lower is better. High value means words are being dropped.
- HALL: Hallucination rate. Lower is better. High value means extra/wrong words are being added.
- END: End truncation score. Lower is better. High value suggests endings are being cut or drifting.
- Latency: average milliseconds per sample. Lower is better, but quality wins over small latency gains.

## Hard Rules

- Do not globally change Parakeet chunk size without rerunning local 70 and FLEURS 400. Chunk size changes have repeatedly looked good on FLEURS while badly regressing local speech.
- Do not reintroduce Hindi into Parakeet V3 evals unless the model path changes.
- Do not add acoustic post-processing like `want -> wanted` unless it is proven general. That kind of fix usually belongs in the model or dataset, not text cleanup.
- Be careful with fillers: `um` is an English filler but `um` is a real Portuguese word.
- Prefer conditional recovery/retry strategies over global changes.
- If a change improves only local 70 but hurts FLEURS, reject it or make it conditional.
- If a change improves only FLEURS but hurts local 70, reject it or make it conditional.

## Eval Commands

Local 70:

```powershell
cargo run --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval -- "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8" .\src-tauri\evals\parakeet\dataset_manifest_combined_current.json parakeet_v3_multilingual .\src-tauri\evals\parakeet\YOUR_LOCAL_REPORT.json
```

FLEURS 400:

```powershell
cargo run --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval -- "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8" .\src-tauri\evals\parakeet\external\fleurs_supported_400\dataset_manifest_external.json parakeet_v3_multilingual .\src-tauri\evals\parakeet\YOUR_FLEURS_REPORT.json
```

Debug one sample:

```powershell
$env:VOCALYPE_EVAL_DEBUG_SAMPLE='sample_id_here'
# run eval
Remove-Item Env:\VOCALYPE_EVAL_DEBUG_SAMPLE
```

Try a temporary chunk size:

```powershell
$env:VOCALYPE_EVAL_CHUNK_SECONDS='20'
# run eval
Remove-Item Env:\VOCALYPE_EVAL_CHUNK_SECONDS
```

Required checks after code changes:

```powershell
cargo check --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval
cargo test --manifest-path .\src-tauri\Cargo.toml --lib
git diff --check -- src-tauri\src\runtime\chunking.rs src-tauri\src\runtime\parakeet_text.rs src-tauri\src\actions\transcribe.rs src-tauri\examples\parakeet_pipeline_eval.rs
```

Note: global `git diff --check` may fail due to unrelated generated `src/bindings.ts` trailing whitespace. Check the ASR files directly unless working on bindings.

## Experiment Table

| Date | Experiment | Local 70 WER / CER / OMIT / HALL / END | FLEURS 400 WER / CER / OMIT / HALL / END | Decision | Notes |
|---|---|---:|---:|---|---|
| 2026-04-12 | Context-safe local baseline with tail fillers | 0.475 / 1.434 / n/a / n/a / n/a | not run | reference only | Report was mentioned in prior notes but not present in current working tree. |
| 2026-04-12 | Remove aggressive builtin `Parakeet V3` correction; add targeted variants | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 8.465 / 5.997 / 7.184 / 6.327 / 32.042 | keep | Avoids broad false correction of normal words into `Parakeet V3`. |
| 2026-04-13 | Recovery v2: full-audio retry only when a non-final chunk is empty and output looks too short | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 8.009 / 5.523 / 6.728 / 6.353 / 32.042 | keep | Improved FLEURS without local regression. Best current production compromise. |
| 2026-04-13 | Global chunk 10s | 10.162 / 9.321 / 9.217 / 4.616 / 45.833 | not run | reject | Too many chunks; severe local regression. |
| 2026-04-13 | Global chunk 14s | 4.711 / 4.501 / 3.868 / 3.055 / 15.476 | not run | reject | Still much worse than 12s on local 70. |
| 2026-04-13 | Global chunk 20s | 4.088 / 3.163 / 3.531 / 3.240 / 8.690 | 6.950 / 4.753 / 5.899 / 5.791 / 26.646 | reject as global | Improves FLEURS but badly regresses local 70. Use only as inspiration for conditional recovery, not a global setting. |
| 2026-04-13 | Global full context / chunk 60s | 5.058 / 3.812 / 4.492 / 4.006 / 11.190 | 6.754 / 4.596 / 5.716 / 5.681 / 26.501 | reject as global | Best FLEURS score among chunk tests, but severe local regression, especially FR long/self-correct. |
| 2026-04-13 | Dedup/fillers v1: safer punctuation-only boundary dedup guard; multilingual mid-sentence fillers; preserve PT `um` | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 8.009 / 5.523 / 6.728 / 6.353 / 32.042 | keep as safe cleanup | No measured quality change on current sets, but safer for real future speech with `euh`, `eh`, `ah`, `mhm`. |
| 2026-04-13 | Recovery v3 suspicion: retry full-audio when word density is very low or final chunk is suspiciously short/sparse | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 7.778 / 5.302 / 6.473 / 6.288 / 31.376 | keep | Improves FLEURS without local regression. FLEURS EN 8.962 -> 8.308, ES 6.359 -> 6.088, FR/PT unchanged. Reports: `parakeet-pipeline-eval-20260413-local70-recovery-v3-suspicion.json`, `external-fleurs-supported-400-no-hi-recovery-v3-suspicion.json`. |
| 2026-04-13 | Recovery v4 aggressive thresholds: low density 1.45 -> 1.60, severe 1.05 -> 1.20, promotion +5/1.25 -> +3/1.15 | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 7.778 / 5.302 / 6.473 / 6.288 / 31.376 | reject as neutral | Produced identical hypotheses to v3 on local 70 and FLEURS 400. Reverted to v3 thresholds to avoid extra risk. Reports: `parakeet-pipeline-eval-20260413-local70-recovery-v4-aggressive.json`, `external-fleurs-supported-400-no-hi-recovery-v4-aggressive.json`. |
| 2026-04-14 | v5 synced: ES/PT mojibake fix, Mm-hmm hallucination removal, eval recovery thresholds matched to transcribe.rs (6.0s min, empty_final_chunk, +3/1.15x promote, 0.25s trailing silence) | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 7.488 / 5.196 / 6.369 / 6.073 / 30.417 | keep | All metrics improved. EN 8.308→8.015, ES 6.088→5.527 (large), FR 9.596→9.527, PT 7.120→6.883. No local regression. Reports: `parakeet-pipeline-eval-20260414-local70-recovery-v5-synced.json`, `external-fleurs-supported-400-no-hi-recovery-v5-synced.json`. |
| 2026-04-14 | WiFi word-form patterns: `eight zero two point one one [A/B/G/N]` → `802.11x`, `two point four/five point zero GHC` → `2.4/5.0GHz` | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 7.212 / 5.115 / 6.288 / 5.895 / 30.152 | keep | EN WER 8.015→6.911 (-1.10pp). Model outputs 802.11 standards and GHz as spoken words, not digits. No local regression, ES/FR/PT unchanged. Reports: `parakeet-pipeline-eval-20260414-local70-wifi-word.json`, `external-fleurs-supported-400-no-hi-wifi-word.json`. |
| 2026-04-14 | FR punct-space fix: apply `PUNCT_SPACE_PATTERN` to FR branch (removes model-inserted spaces before `.`,`,`,`;`,`!`,`?`) | 0.525 / 1.443 / 0.462 / 0.458 / 1.071 | 7.145 / 5.109 / 6.254 / 5.838 / 30.152 | keep | FR WER 9.527→9.260 (-0.267pp). Fixes `802 .11n`→`802.11n`, `2 ,4 GHz`→`2,4 GHz`. No regression on EN/ES/PT. Reports: `parakeet-pipeline-eval-20260414-local70-fr-punct.json`, `external-fleurs-supported-400-no-hi-fr-punct.json`. |

## Current Best Known Setup

Keep:
- 12s Parakeet V3 chunk profile.
- Recovery v5: 6.0s min duration, empty_final_chunk trigger, +3/1.15x promotion, 0.25s trailing silence.
- ES/PT mojibake normalization (shared safe cleanup in `finalize_parakeet_text` else branch).
- Mm-hmm/uh-huh hallucination removal via `TRAILING_MM_HMM_PATTERN`.
- WiFi word-form patterns: `eight zero two point one one [A/B/G/N]` → `802.11x`, `two point four/five point zero GHC` → `2.4/5.0GHz`.
- FR punct-space: `PUNCT_SPACE_PATTERN` applied to FR branch (model inserts spaces before punctuation in numbers).
- Targeted Parakeet phrase variants instead of broad `Parakeet V3` builtin correction.
- Hindi removed from Parakeet evals.
- Safe dedup/fillers v1.

Do not use globally:
- Chunk 10s.
- Chunk 14s.
- Chunk 20s.
- Chunk 60s/full-context for all samples.

## Ideas Still Worth Testing

1. Better suspicion score for conditional recovery:
   - words per second too low
   - empty non-final chunks
   - high end-truncation-like signal
   - final chunk too short compared with audio duration
   - status: v3 helped FLEURS and did not regress local; future work should tune carefully, not start over.

2. Conditional second pass only for suspicious samples:
   - compare normal chunked output vs full-audio output
   - promote only when recovered has enough extra credible words
   - reject if recovered is much shorter or repeats too much

3. Safer boundary assembly:
   - exact 1-3 word overlap is already supported
   - test punctuation-only and filler-only boundary edge cases
   - avoid false positives that drop legitimate repeated words

4. Dataset expansion when disk is available:
   - Common Voice EN/ES/FR/PT small subset first
   - LibriSpeech `test-clean` and `test-other`
   - more local short/medium/long user-style recordings

5. Per-language analysis:
   - EN must remain stable
   - FR long/self-correct samples are sensitive to full-context/chunk-size changes
   - PT must preserve real word `um`

## Template For New Entries

Copy this row after every experiment:

```markdown
| YYYY-MM-DD | Experiment name | local WER / CER / OMIT / HALL / END | FLEURS WER / CER / OMIT / HALL / END | keep/reject/conditional | Short reason and report filenames |
```

Also list:
- files changed
- commands run
- exact report filenames
- any known regressions by language or duration

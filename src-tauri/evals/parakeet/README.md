# Parakeet Eval Dataset

This folder holds the local evaluation corpus used to diagnose and improve
`Parakeet V3` in realistic dictation scenarios.

## Layout

- `dataset_manifest.json`: sample metadata and reference texts
- `audio/`: WAV files referenced by the manifest
- `reports/`: generated evaluation reports
- `hypotheses/`: optional plain-text hypotheses for `parakeet_eval`

## Audio Requirements

- WAV format
- 16 kHz sample rate
- mono preferred
- one file per sample id

## Recommended Scenarios

- `long_no_pause_fr`
- `fast_dictation_fr`
- `low_volume_fr`
- `light_noise_fr`
- `franglais_terms`
- `proper_nouns`
- `cheap_laptop_mic`
- `end_truncation_fr`
- `english_control`
- `natural_chat_en`
- `free_form_en`
- `accent_en`
- `dirty_noise_en`
- `very_low_volume_en`
- `weird_pauses_en`
- `conversation_en`
- `interruption_en`
- `cheap_mic_en`
- `code_switch_en`
- `messy_thought_en`
- `far_mic_en`
- `overlap_speech_en`

## Ready Packs

- `dataset_manifest_english_20.json`: clean English benchmark
- `dataset_manifest_natural_24.json`: more realistic English benchmark
- `NATURAL_PACK_24.md`: recording guidance for the realistic pack

## Run the Text-Hypothesis Evaluator

Use this when you already have hypotheses in text files:

```powershell
cd src-tauri
cargo run --example parakeet_eval -- .\evals\parakeet\dataset_manifest.json .\evals\parakeet\hypotheses .\evals\parakeet\reports\text-eval.json
```

Each hypothesis file should be named `<sample_id>.txt`.

## Run Everything With One Script

From the repo root:

```powershell
npm run eval:parakeet -- -Mode text
```

Real pipeline:

```powershell
npm run eval:parakeet -- -Mode pipeline -ModelDir C:\models\parakeet-v3
```

Both:

```powershell
npm run eval:parakeet -- -Mode all -ModelDir C:\models\parakeet-v3
```

Optional English control:

```powershell
npm run eval:parakeet -- -Mode pipeline -ModelDir C:\models\parakeet-v3 -ModelId parakeet-tdt-0.6b-v3-multilingual
```

## Run the Real Pipeline Evaluator

Use this to exercise a chunked `Parakeet V3` pipeline against the WAV files:

```powershell
cd src-tauri
cargo run --example parakeet_pipeline_eval -- <model_dir> .\evals\parakeet\dataset_manifest.json parakeet-tdt-0.6b-v3-multilingual .\evals\parakeet\reports\pipeline-eval.json
```

Example English control run:

```powershell
cd src-tauri
cargo run --example parakeet_pipeline_eval -- <model_dir> .\evals\parakeet\dataset_manifest.json parakeet-tdt-0.6b-v3-multilingual .\evals\parakeet\reports\pipeline-eval-en.json
```

## How to Grow the Dataset

Prefer at least 5 to 10 files per scenario before trusting the averages.

For each new sample:

1. Add the WAV in `audio/`
2. Add the manifest entry with accurate metadata
3. Keep the reference text normalized and final
4. Re-run both evaluators
5. Compare `WER`, `CER`, omissions, hallucinations and end truncation

## Suggested Naming

- `long_no_pause_fr_003.wav`
- `light_noise_fr_004.wav`
- `proper_nouns_002.wav`

Keep names stable so reports can be compared over time.

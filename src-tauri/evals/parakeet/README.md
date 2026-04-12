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
- `FRIENDS_PACK_ES_HI_PT.md`: shareable pack for Spanish, Hindi, and Portuguese friends
- `dataset_manifest_spanish_10.json`: Spanish starter benchmark
- `dataset_manifest_hindi_10.json`: Hindi starter benchmark
- `dataset_manifest_portuguese_10.json`: Portuguese starter benchmark

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

## External Datasets

Use this to check whether a change generalizes beyond the hand-recorded local
pack. The generated `external/` folder is ignored by git because public speech
corpora can get large quickly.

### Common Voice

Download a Common Voice language release from Mozilla, unzip it, then sample a
bounded eval pack:

```powershell
python ..\scripts\prepare-external-asr-dataset.py `
  --dataset common_voice `
  --source-dir C:\datasets\common_voice `
  --languages en fr es pt hi `
  --max-per-language 25 `
  --output-dir .\evals\parakeet\external\common_voice_smoke
```

The source folder can either be a single language folder containing
`validated.tsv` and `clips/`, or a parent folder with one subfolder per language.

### LibriSpeech

LibriSpeech is English-only and useful as a clean baseline:

```powershell
python ..\scripts\prepare-external-asr-dataset.py `
  --dataset librispeech `
  --source-dir C:\datasets\LibriSpeech\test-clean `
  --languages en `
  --max-per-language 50 `
  --output-dir .\evals\parakeet\external\librispeech_test_clean
```

### FLEURS

FLEURS can be pulled through Hugging Face `datasets` for multilingual smoke
checks. Install the optional dependency first:

```powershell
python -m pip install datasets
python ..\scripts\prepare-external-asr-dataset.py `
  --dataset fleurs `
  --languages en fr es pt hi `
  --max-per-language 20 `
  --output-dir .\evals\parakeet\external\fleurs_smoke
```

### Running Parakeet on the External Pack

```powershell
cd src-tauri
$model = "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8"
cargo run --example parakeet_pipeline_eval -- `
  $model `
  .\evals\parakeet\external\common_voice_smoke\dataset_manifest_external.json `
  parakeet-tdt-0.6b-v3-multilingual `
  .\evals\parakeet\reports\external-common-voice-smoke.json
```

Treat this as a holdout set: do not add rules that only memorize a specific
public transcript. Keep changes only when they improve both the local pack and a
fresh external sample.

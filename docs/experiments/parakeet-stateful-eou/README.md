# Parakeet Stateful EOU Experiment

## Status

Disabled in the app as of May 16, 2026.

The code is intentionally kept in the repository for later research, but the
runtime gate is hard-disabled and the UI toggle has been removed.

## What Plan C Was

Plan C tested a second Parakeet path based on an EOU model.

EOU means `End Of Utterance`.

The goal was to:

- keep a streaming state between short chunks
- reduce latency on very short dictation turns
- detect when the speaker has likely finished a phrase

## Model Used

- Name: `nvidia/parakeet_realtime_eou_120m-v1`
- Family: streaming FastConformer-RNNT
- Parameters: about 120M
- Intended use: low-latency voice agents
- Language support: English only
- Output style: raw streaming text, no reliable punctuation/capitalization

In this repository we tested an ONNX export of that model.

## Why It Was Removed From The App

The experiment did not match Vocalype's primary product goal.

Vocalype needs final dictation text that is:

- multilingual
- readable
- properly spaced
- stable on short recruiter-style dictation

The EOU model was not designed for that. In local tests it could:

- merge words together
- produce raw streaming-style output
- degrade final text quality even when latency looked promising

This made it useful as a research path, but not acceptable as a production
transcription path.

## What It Is Still Good For

If revisited later, EOU should only be considered for:

- utterance boundary detection
- deciding when to commit or stop listening
- internal timing signals

It should not be used directly as the final user-visible transcript unless a
stronger multilingual streaming model replaces it.

## Recommended Direction

For final dictation quality, prefer:

- `Parakeet TDT 0.6B v3` for multilingual final text

If we revisit a true streaming path later, better candidates are:

- a stronger multilingual RNNT streaming model
- using EOU only as a boundary signal while TDT remains the final decoder

## Main Code Paths

- UI toggle removed from:
  - `src/components/settings/preferences/PreferencesSettings.tsx`
- runtime hard-disabled in:
  - `src-tauri/src/managers/transcription/engine_loader.rs`
  - `src-tauri/src/managers/transcription/inference.rs`

## Notes

The remaining experimental code can be kept as reference for:

- model loading
- EOU fallback labeling
- runtime-path diagnostics
- future streaming experiments

# Vocalype Brain - Model Benchmark Report

Date: 2026-04-23

## Purpose

Use this template to compare speech-to-text models manually without paid APIs.

## Metrics

- latency_ms
- ram_mb
- cpu_percent
- gpu_percent
- wer_estimate
- notes

## Test Categories

### French casual speech

Expected text: Je veux dicter un courriel rapidement sans envoyer ma voix dans le cloud.

### English casual speech

Expected text: I want to write this email without touching my keyboard.

### Code dictation

Expected text: Create a function called parse user input and return the cleaned text.

### Long paragraph dictation

Expected text: Vocalype should help me capture a complete paragraph, keep punctuation readable, and paste it into any app.

### Fast speech

Expected text: This is a quick test to see whether the model can follow me when I speak faster than usual.

### Noisy background

Expected text: I am speaking with background noise and still need accurate transcription.

### Punctuation

Expected text: Add a comma after hello, then a period after world, then start a new line.

### Commands

Expected text: Paste the text into the active window and keep the original capitalization.

### Low-end PC performance

Expected text: This test measures whether dictation remains usable on a slow laptop.

### Startup time

Expected text: Measure how long the model takes before the first dictation is ready.

## Manual Benchmark Instructions

1. Choose one model and one test category.
2. Dictate the expected sentence using the same microphone and environment.
3. Paste the actual output into `data/benchmarks.jsonl`.
4. Record latency, RAM, CPU, GPU, WER estimate, and notes.
5. Compare models by user mode: normal, developer, French, low-end PC, privacy, fastest, best accuracy.

## Recommendation Rule

Do not change the default model unless it improves the target metric without hurting first successful dictation.

# Vocalype Brain — V7 Benchmark Report

Date: 2026-04-24T20:33:36
Total observations: 37

> This report is measurement-only. No optimization recommendations.
> Run more sessions to build a reliable baseline.

---

## Coverage

- Priority metrics covered : 2 / 10
- Priority metrics missing  : 8
- Unique scenarios recorded : 2
- Unique metrics recorded   : 4

### Baseline readiness per priority metric

| Metric | Observations | Baseline ready (≥5) |
|---|---|---|
| `total_dictation_latency_ms` | 9 | ✅ Yes |
| `model_load_time_ms` | 0 | ❌ No (0/5) |
| `stt_inference_time_ms` | 20 | ✅ Yes |
| `app_idle_ram_mb` | 0 | ❌ No (0/5) |
| `ram_during_transcription_mb` | 0 | ❌ No (0/5) |
| `ram_after_transcription_mb` | 0 | ❌ No (0/5) |
| `wer_percent` | 0 | ❌ No (0/5) |
| `cer_percent` | 0 | ❌ No (0/5) |
| `first_successful_dictation_time_ms` | 0 | ❌ No (0/5) |
| `activation_success_rate` | 0 | ❌ No (0/5) |

---

## Metric Summaries

### `total_dictation_latency_ms`
*Total dictation latency (trigger → paste)*

- Observations : 9
- Min          : 998.0 ms
- Max          : 2400.0 ms
- Mean         : 1387.33 ms
- p50          : 1098.0 ms
- p95          : 2400.0 ms
- Recent observations:
  - 2026-04-24T20:31 [windows_ryzen7_rtx4060]: 1081.0 ms — from_log:2026-04-24T18:48:40 recording-stop-to-paste. steps: cfa=255ms cleanup=150ms paste=644ms
  - 2026-04-24T20:31 [windows_ryzen7_rtx4060]: 2169.0 ms — from_log:2026-04-24T18:49:08 recording-stop-to-paste. steps: cfa=886ms cleanup=0ms paste=647ms
  - 2026-04-24T20:31 [windows_ryzen7_rtx4060]: 998.0 ms — from_log:2026-04-24T18:49:16 recording-stop-to-paste. steps: cfa=321ms cleanup=0ms paste=645ms

### `stt_inference_time_ms`
*STT inference time*

- Observations : 20
- Min          : 178.0 ms
- Max          : 886.0 ms
- Mean         : 328.8 ms
- p50          : 255.0 ms
- p95          : 886.0 ms
- Recent observations:
  - 2026-04-24T20:33 [windows_ryzen7_rtx4060]: 232.0 ms — per_chunk_inference from_log:2026-04-24 Transcription-completed-in line. True single-chunk Parakeet inference.
  - 2026-04-24T20:33 [windows_ryzen7_rtx4060]: 253.0 ms — per_chunk_inference from_log:2026-04-24 Transcription-completed-in line. True single-chunk Parakeet inference.
  - 2026-04-24T20:33 [windows_ryzen7_rtx4060]: 303.0 ms — per_chunk_inference from_log:2026-04-24 Transcription-completed-in line. True single-chunk Parakeet inference.

### Additional metrics recorded

- `capture_duration_ms`: 3 obs, mean 4370.67 ms, range [1831.0–7410.0]
- `paste_latency_ms`: 5 obs, mean 652.8 ms, range [644.0–687.0]

---

## Latest Observations

| Date | Scenario | Metric | Value | Unit | Device |
|---|---|---|---|---|---|
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 303.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 253.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 232.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 226.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 219.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 208.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 199.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 194.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 191.0 | ms | windows_ryzen7_rtx4060 |
| 2026-04-24T20:33 | warm_dictation | stt_inference_time_ms | 178.0 | ms | windows_ryzen7_rtx4060 |

---

## Missing Priority Metrics

The following priority metrics have no observations yet.
Collect these before building a baseline.

### `model_load_time_ms`
*Model cold-load time*

How to measure: Cold-start: relaunch app, time from launch to first 'ready' state.

### `app_idle_ram_mb`
*App idle RAM*

How to measure: Open Task Manager → Vocalype process → record RSS with no dictation running.

### `ram_during_transcription_mb`
*RAM during transcription (peak)*

How to measure: Open Task Manager → Vocalype → record peak RAM while dictating 10s audio.

### `ram_after_transcription_mb`
*RAM after transcription (steady-state)*

How to measure: Record RAM 5s after a dictation completes (check for leak vs. idle).

### `wer_percent`
*Word error rate (%)*

How to measure: Dictate 5 known reference phrases. Compare hypothesis to reference manually.

### `cer_percent`
*Character error rate (%)*

How to measure: Same as WER test but count character errors instead of word errors.

### `first_successful_dictation_time_ms`
*Time to first successful dictation*

How to measure: Fresh install / new account: time from app open to first successful paste.

### `activation_success_rate`
*Activation success rate*

How to measure: Run 5 app launches. Count how many reach 'ready' state without manual retry.

---

## Suggested Next Measurements

**Next priority:** `model_load_time_ms`

Cold-start: relaunch app, time from launch to first 'ready' state.

Command to record:
```
python vocalype-brain/scripts/add_benchmark_observation.py \
    --scenario <scenario_name> \
    --metric model_load_time_ms \
    --value <your_measurement> \
    --unit ms \
    --device <your_device>
```

---

## Stop Conditions

Do not begin optimization until:
- ≥5 observations exist for every priority metric
- Baseline is locked in `data/benchmark_baseline.jsonl`
- At least one product change has been benchmarked before AND after

*This report is measurement-only. V7 does not optimize — it measures.*

# Vocalype Brain — V7 Benchmark Report

Date: 2026-04-24T14:32:48
Total observations: 1

> This report is measurement-only. No optimization recommendations.
> Run more sessions to build a reliable baseline.

---

## Coverage

- Priority metrics covered : 1 / 10
- Priority metrics missing  : 9
- Unique scenarios recorded : 1
- Unique metrics recorded   : 1

### Baseline readiness per priority metric

| Metric | Observations | Baseline ready (≥5) |
|---|---|---|
| `total_dictation_latency_ms` | 1 | ❌ No (1/5) |
| `model_load_time_ms` | 0 | ❌ No (0/5) |
| `stt_inference_time_ms` | 0 | ❌ No (0/5) |
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

- Observations : 1
- Min          : 2400.0 ms
- Max          : 2400.0 ms
- Mean         : 2400.0 ms
- p50          : 2400.0 ms
- p95          : 2400.0 ms
- Recent observations:
  - 2026-04-24T14:11 [windows_4060]: 2400.0 ms — manual validation sample

---

## Latest Observations

| Date | Scenario | Metric | Value | Unit | Device |
|---|---|---|---|---|---|
| 2026-04-24T14:11 | first_dictation | total_dictation_latency_ms | 2400.0 | ms | windows_4060 |

---

## Missing Priority Metrics

The following priority metrics have no observations yet.
Collect these before building a baseline.

### `model_load_time_ms`
*Model cold-load time*

How to measure: Cold-start: relaunch app, time from launch to first 'ready' state.

### `stt_inference_time_ms`
*STT inference time*

How to measure: Check Tauri console logs for inference timing during a dictation.

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

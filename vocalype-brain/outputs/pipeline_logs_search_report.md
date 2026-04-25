# Vocalype V7 — PipelineProfiler Log Search Report

Date: 2026-04-24
Author: Vocalype Brain (V7 Phase 1 automated search)
Status: **FOUND — 43 Pipeline profile entries extracted and recorded.**

---

## Search Summary

| Location | Searched | Found |
|---|---|---|
| `%APPDATA%\com.vocalype.desktop\` (Roaming) | ✅ | ❌ — only settings/auth/license JSON, no logs |
| `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log` | ✅ | ✅ **43 Pipeline profile entries** |
| `%LOCALAPPDATA%\com.vocaltype.desktop\logs\vocaltype.log` (typo variant) | ✅ | ❌ — empty (0 bytes matching) |
| `%LOCALAPPDATA%\com.vocaltype.desktop.dev\logs\vocaltype.log` (dev variant) | ✅ | ❌ — empty |
| `vocalype/vite.stdout.log` (repo root) | ✅ | ❌ — Vite frontend logs only, no Rust output |
| `vocalype/vite.stderr.log` (repo root) | ✅ | ❌ — 2 bytes, empty |
| Repo `logs/` directories | ✅ | ❌ — none exist |
| `%APPDATA%\com.vocalype.desktop\` subdirs recursively | ✅ | ❌ — no `.log` files |

**Log file found:** `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log` — **157 KB**, last modified 2026-04-24 15:54

---

## Log File: Full Statistics

All entries: `model=parakeet-tdt-0.6b-v3-multilingual`

| Date | Entries | Complete runs (with paste_execute) |
|---|---|---|
| 2026-04-21 | 18 | 18 |
| 2026-04-24 (today) | 25 | 20 |
| **Total** | **43** | **38** |

### `total_dictation_latency_ms` (recording-stop → paste complete)

> Note: This is the post-recording pipeline time. The trigger → recording-start
> adds a few milliseconds. For all practical purposes this equals the user-perceived
> latency from stop-speaking to text appearing.

| Stat | All 38 complete runs | Today only (20 runs) |
|---|---|---|
| min | 717 ms | 717 ms |
| p50 | 1043 ms | 1081 ms |
| p95 | 2405 ms | 2405 ms |
| max | 4747 ms (Apr 21, chunk_cleanup=3320ms) | 2405 ms |
| mean | 1247 ms | 1213 ms |

### Step breakdown (medians across 38 complete runs)

| Step | Median | Max | Notes |
|---|---|---|---|
| `stop_recording` | 11 ms | 23 ms | Recording finalization — negligible |
| `chunk_finalize_and_assemble` | 303 ms | 886 ms | **STT inference + chunk assembly** |
| `chunk_cleanup` | 0 ms | 3320 ms | Optional LLM cleanup — only 9/38 runs used it |
| `dictionary_replacement` | 0 ms | 446 ms | Optional dictionary pass — 17/38 runs |
| `paste_execute` | **645 ms** | 687 ms | **Clipboard/injection — remarkably constant** |

### Notable findings

1. **`paste_execute` is the dominant cost**: ~645ms constant regardless of transcription length.
   Inference (`chunk_finalize_and_assemble`) is only ~300ms median.
   The pipeline is **paste-bound**, not inference-bound, under normal conditions.

2. **`chunk_cleanup` is the outlier driver**: The 4747ms max (Apr 21) and 2405ms today
   were caused by `chunk_cleanup=3320ms` and `chunk_cleanup=1366ms` respectively.
   This is an optional LLM-based assembly cleanup step — not always triggered.

3. **Parakeet inference is fast**: median 303ms for 2–8s audio clips.
   Real-time factor ≈ 0.05–0.15x (well under 1.0x, meaning faster than real time).

4. **`parakeet_full_audio_recovery`** appeared in 2 runs today:
   - 441ms (total=2169ms, triggered post_process=532ms)
   - 449ms (total=1550ms)
   This recovery path runs when the primary chunked path fails/downgrades.

---

## Raw Log Lines (Today, Complete Runs)

```
[2026-04-24][18:48:11] total=1443ms  stop_recording=15ms  chunk_finalize_and_assemble=318ms  dictionary_replacement=393ms  paste_execute=687ms
[2026-04-24][18:48:19] total=1201ms  stop_recording=15ms  chunk_finalize_and_assemble=218ms  chunk_cleanup=296ms  paste_execute=645ms
[2026-04-24][18:48:23] total=1045ms  stop_recording=15ms  chunk_finalize_and_assemble=359ms  paste_execute=644ms
[2026-04-24][18:48:27] total=1051ms  stop_recording=10ms  chunk_finalize_and_assemble=372ms  paste_execute=644ms
[2026-04-24][18:48:33] total=1098ms  stop_recording=9ms   chunk_finalize_and_assemble=416ms  paste_execute=644ms
[2026-04-24][18:48:40] total=1081ms  stop_recording=9ms   chunk_finalize_and_assemble=255ms  chunk_cleanup=150ms  paste_execute=644ms
[2026-04-24][18:49:08] total=2169ms  stop_recording=23ms  parakeet_full_audio_recovery=441ms  chunk_finalize_and_assemble=886ms  post_process=532ms  paste_execute=647ms
[2026-04-24][18:49:16] total=998ms   stop_recording=9ms   chunk_finalize_and_assemble=321ms  paste_execute=645ms
[2026-04-24][18:49:22] total=1081ms  stop_recording=10ms  chunk_finalize_and_assemble=404ms  paste_execute=644ms
[2026-04-24][18:57:32] total=2405ms  stop_recording=9ms   chunk_finalize_and_assemble=353ms  chunk_cleanup=1366ms  paste_execute=650ms
[2026-04-24][19:51:54] total=1017ms  stop_recording=12ms  chunk_finalize_and_assemble=314ms  paste_dispatch_wait=21ms  paste_execute=644ms
[2026-04-24][19:52:00] total=876ms   stop_recording=18ms  chunk_finalize_and_assemble=187ms  paste_execute=643ms
[2026-04-24][19:52:08] total=1546ms  stop_recording=10ms  chunk_finalize_and_assemble=465ms  chunk_cleanup=397ms  paste_execute=644ms
[2026-04-24][19:52:15] total=963ms   stop_recording=9ms   chunk_finalize_and_assemble=287ms  paste_execute=643ms
[2026-04-24][19:52:25] total=717ms   stop_recording=10ms  chunk_finalize_and_assemble=14ms   paste_execute=663ms
[2026-04-24][19:53:35] total=1550ms  stop_recording=11ms  parakeet_full_audio_recovery=449ms  chunk_finalize_and_assemble=615ms  chunk_cleanup=236ms  paste_execute=665ms
[2026-04-24][19:53:39] total=1043ms  stop_recording=13ms  chunk_finalize_and_assemble=367ms  paste_execute=641ms
[2026-04-24][19:53:45] total=1002ms  stop_recording=8ms   chunk_finalize_and_assemble=235ms  chunk_cleanup=95ms  paste_execute=641ms
[2026-04-24][19:53:55] total=1084ms  stop_recording=10ms  chunk_finalize_and_assemble=226ms  chunk_cleanup=194ms  paste_execute=628ms
[2026-04-24][19:54:01] total=892ms   stop_recording=16ms  chunk_finalize_and_assemble=234ms  paste_execute=618ms
```

---

## Observations Recorded

| Metric | Values recorded | Source |
|---|---|---|
| `total_dictation_latency_ms` | 1443, 1201, 1045, 1051, 1098, 1081, 2169, 998 ms | Log file (today) |
| `stt_inference_time_ms` | 318, 218, 359, 372, 416, 255, 886, 321 ms | `chunk_finalize_and_assemble` step |
| `paste_latency_ms` (extra) | 687, 645, 644, 644, 644 ms | `paste_execute` step |

**`total_dictation_latency_ms`**: 9 total observations (1 prior + 8 today) → **≥5 ✅ baseline ready**
**`stt_inference_time_ms`**: 10 total observations (2 prior bounds + 8 today) → **≥5 ✅ baseline ready**

---

## What Still Cannot Be Extracted From Logs

| Metric | Why |
|---|---|
| `app_idle_ram_mb` | Not logged — requires live process memory reading |
| `ram_during_transcription_mb` | Not logged |
| `ram_after_transcription_mb` | Not logged |
| `model_load_time_ms` | Not in Pipeline profile log. Requires searching for model-load log lines separately |
| `total_dictation_latency_ms` (trigger-to-paste) | Log captures recording-stop-to-paste. The trigger-to-recording-start gap (~50-200ms) is not logged |
| `wer_percent` / `cer_percent` | Requires reference phrases — not stored in logs or history.db |
| `activation_success_rate` | Failure events not counted in history.db — only successes |
| `first_successful_dictation_time_ms` | Not logged |

---

## Model Load Time — Additional Search

The Pipeline profile log does not contain model load entries. Check the full log
for model-load related lines to see if `model_load_time_ms` is available:

```bash
grep -i "model.*load\|load.*model\|model.*ready\|ready" \
    "%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log" | head -20
```

---

*This report is measurement-only. No product code was modified.*
*Source log: `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log`*

# Vocalype Brain — Product Patch Proposal

Date: 2026-04-24T21:00:00

---

## Proposal: Investigate `paste_execute` Latency

**Type:** investigation_only (read-only source inspection)
**Source:** V7 bottleneck hypothesis (v7_bottleneck_hypothesis.md)
**Status:** Proposed — awaiting founder approval to begin investigation

---

## 1. Problem Statement

The `paste_execute` step takes a **constant ~645 ms** on every dictation run, regardless of:
- Transcription length or audio duration
- Model output size
- Chunk count or chunk_cleanup activation

This single step accounts for **~62% of total post-recording latency at p50** (643ms out of 1043ms).

Meanwhile, Parakeet inference completes in a **median of 230ms per chunk** — faster than real time
(real-time factor ~0.06x on Ryzen 7 5800X + RTX 4060). Inference is NOT the bottleneck.

If paste_execute can be reduced from ~645ms to ~100ms, the p50 total drops from ~1043ms
to ~450ms — a **57% improvement in user-perceived post-recording latency** with no model change.

---

## 2. Evidence from Benchmark Data

| Metric | Value | Source |
|---|---|---|
| `paste_execute` p50 | 645 ms | 38 log samples, remarkably constant |
| `paste_execute` min | 618 ms | Log sample at 19:54:01 |
| `paste_execute` max | 687 ms | Log sample at 18:48:11 |
| `paste_execute` variance | ±35 ms | Very narrow — not noise, not I/O wait |
| `chunk_finalize_and_assemble` p50 | 303 ms | 38 log samples |
| `stt_inference_time_ms` p50 | 230 ms | 20 per-chunk inference samples |
| `total_dictation_latency_ms` p50 | 1043 ms | 38 complete runs |
| paste as % of total | ~62% | 645 / 1043 |
| `paste_dispatch_wait` (observed once) | 21 ms | Log sample at 19:51:54 |

**Key observation:** `paste_dispatch_wait` (measured as the time from paste dispatch to main thread
callback execution) was 21ms in one log entry. The remaining ~625ms is consumed inside the
`app.run_on_main_thread()` callback — inside `paste_exec_started` to completion.

This implies the 645ms is NOT an async queue wait — it is the actual paste execution time
on the main thread.

---

## 3. Approved Investigation Scope

> **Read-only. No product code changes allowed in this investigation.**

The investigation is permitted to read the following files:

| File | Purpose |
|---|---|
| `src-tauri/src/actions/paste.rs` | Full paste execution logic — Enigo calls, clipboard write, timing |
| `src-tauri/src/actions/mod.rs` or `commands/mod.rs` | How paste_execute_mode is configured per user plan |
| `src-tauri/Cargo.toml` | Enigo version, clipboard plugin version |
| `src-tauri/Cargo.lock` | Exact resolved Enigo version |
| `src-tauri/src/actions/profiler.rs` | Confirm what is included in the paste_execute timing window |
| `src-tauri/src/managers/` | Any paste-related manager or timing config |

**Expected output of investigation:**
- What Enigo method is called (keyboard injection vs clipboard-only)?
- Is there a `sleep` or `tokio::time::sleep` inside the paste execution path?
- Is the 645ms a deliberate delay (Enigo API requirement) or emergent (OS overhead)?
- Does `ClipboardOnlyBasic` follow the same path as `NativePasteAllowed`?
- What Enigo version is in use? Does it have known timing issues?

---

## 4. Forbidden Scope

The following are **permanently forbidden** for this investigation and any subsequent proposal:

| Forbidden Area | Reason |
|---|---|
| `backend/` | Brain never touches backend |
| `src/lib/auth/client.ts` | Auth client — security boundary |
| `src/lib/license/client.ts` | License client — billing boundary |
| `src-tauri/src/managers/` — writes | Read only in this phase |
| Payment / billing logic | Financial boundary |
| Rust security, signing, or crypto code | Integrity boundary |
| Translation files | Not related to this change |
| Any frontend file | This is a Rust/backend concern only |

**No code may be modified, generated, or committed as part of this investigation.**
**The output is a diagnosis report only.**

---

## 5. Candidate Files — Next Implementation Handoff

If the investigation confirms the 645ms is reducible, these are the candidate files
for a **future V8 implementation handoff** (not this task):

| File | Candidate Change |
|---|---|
| `src-tauri/src/actions/paste.rs` | Remove or reduce deliberate delay; test alternative clipboard method |
| `src-tauri/Cargo.toml` | Enigo version bump if a newer version fixes timing |
| `src-tauri/src/actions/profiler.rs` | Add finer-grained timing inside paste_execute (read: `paste_exec_started` sub-steps) |

**These files must NOT be touched in the current investigation task.**

---

## 6. Safe Implementation Options (Hypothesis Only)

> ⚠️ These are hypotheses only. Do NOT implement any of these until:
> (a) the investigation confirms the mechanism, and (b) the baseline is locked.

| Option | Description | Expected gain | Risk |
|---|---|---|---|
| Remove intentional delay | If Enigo has a `sleep` for clipboard settle time, test removing or reducing it | High (up to 500ms) | Paste failures if target app needs settle time |
| Switch clipboard method | Replace keyboard-injection (`Ctrl+V` simulation) with direct `SetClipboardData` + `SendInput` | Medium | Platform-specific; may break on some apps |
| Use `NativePasteAllowed` path for all users | If `ClipboardOnlyBasic` is slower than `NativePasteAllowed` | Unknown — needs investigation | Plan enforcement logic must be preserved |
| Async clipboard write | Move clipboard write off main thread if possible via Tauri async | Low-medium | Main thread requirement may be enforced by OS |
| Enigo version upgrade | If current Enigo version has a known delay bug fixed in later versions | Unknown | API breaking changes possible |

---

## 7. Measurement Plan (Before / After)

> To be executed **after** the investigation confirms a reducible cause.
> Not applicable until then.

**Before baseline (already collected):**
- `paste_execute` p50 = 645ms (38 samples, windows_ryzen7_rtx4060)
- `total_dictation_latency_ms` p50 = 1043ms (38 samples)

**After any implementation:**
1. Run ≥10 dictations with modified paste path.
2. Parse `vocalype.log` for new Pipeline profile entries.
3. Record new `paste_latency_ms` observations:
   ```
   python vocalype-brain/scripts/add_benchmark_observation.py \
       --scenario warm_dictation_post_patch \
       --metric paste_latency_ms \
       --value <value> \
       --unit ms \
       --device windows_ryzen7_rtx4060 \
       --notes "post-patch: <description of change>"
   ```
4. Record new `total_dictation_latency_ms` observations.
5. Run `review_benchmarks.py` and compare p50 before vs after.

**Success criterion:** `paste_execute` p50 < 200ms without any increase in paste failure rate.
**Failure criterion:** Any pasted text appearing incorrectly, partially, or in wrong target app.

---

## 8. Risks

| Risk | Description | Mitigation |
|---|---|---|
| Deliberate settle delay | Enigo may insert a delay intentionally to let the target app receive clipboard content before `Ctrl+V` fires. Removing it causes paste failures. | Confirm via code inspection before proposing any removal. |
| OS clipboard timing | Windows clipboard operations require the main thread. Some of the 645ms may be non-reducible OS overhead (`OpenClipboard`, `SetClipboardData`, `CloseClipboard`). | Identify what fraction is Enigo vs OS. |
| Plan enforcement breakage | The `ClipboardOnlyBasic` vs `NativePasteAllowed` split enforces plan tiers. Any change must preserve this gate. | Investigation must confirm which path the 645ms applies to. |
| Single-device measurement | All 38 samples are from Ryzen 7 5800X + RTX 4060. The 645ms may be 200ms on a fast machine and 900ms on a low-spec laptop. | Measure on a second device before proposing any optimization. |
| Regression in paste reliability | Faster paste is worthless if it fails intermittently. Paste success rate is currently unmeasured. | Add `paste_success_rate` to benchmark before patching. |
| `paste_dispatch_wait` confusion | One log entry showed `paste_dispatch_wait=21ms` separately from `paste_execute`. Confirm whether the 645ms includes or excludes this wait step. | Read profiler.rs to confirm timing window boundaries. |

---

## 9. Stop Conditions

**Do not proceed to implementation handoff until ALL of the following are true:**

- [ ] Investigation report confirms the paste mechanism at code level
- [ ] The root cause of 645ms is identified (deliberate delay? OS overhead? Enigo bug?)
- [ ] Baseline is locked: all 10 priority metrics have ≥5 observations
- [ ] `paste_latency_ms` confirmed on at least 2 device profiles
- [ ] `paste_success_rate` has been measured (currently unmeasured)
- [ ] chunk_cleanup trigger condition is understood (H2 — tail latency driver)
- [ ] Founder has approved implementation handoff explicitly

**Current state:** 0/7 stop conditions met.
Most critical gap: investigation not yet run (paste mechanism unknown at code level).

---

## 10. Recommended Next Handoff Type

**Type:** `investigation_only`

**What it is:** A read-only code inspection task. No product code is modified.

**Scope:**
1. Read `src-tauri/src/actions/paste.rs` in full.
2. Read `src-tauri/Cargo.toml` and `Cargo.lock` for Enigo version.
3. Read `src-tauri/src/actions/profiler.rs` to confirm paste_execute timing window.
4. Answer the 6 diagnostic questions in Section 3.
5. Output a short diagnosis note (< 200 lines) appended to this report or saved to
   `vocalype-brain/outputs/paste_mechanism_diagnosis.md`.

**What it is NOT:** An implementation task, a patch proposal, or a code change.

**How to trigger:**
When ready, prompt Claude Code or a research agent with:
```
Read-only investigation: paste_execute latency in Vocalype.

Files to read:
  src-tauri/src/actions/paste.rs (full file)
  src-tauri/Cargo.toml and Cargo.lock (Enigo/clipboard plugin versions)
  src-tauri/src/actions/profiler.rs (paste_execute timing window)
  src-tauri/src/actions/mod.rs or commands/mod.rs (paste mode configuration)

Questions to answer:
  1. What Enigo method is called for NativePasteAllowed? For ClipboardOnlyBasic?
  2. Is there a sleep() or delay() inside the paste execution path?
  3. What Enigo version is in use (Cargo.lock)?
  4. Does the paste_execute timing window (profiler.rs) include clipboard write + key injection?
  5. Is the ClipboardOnlyBasic path (clipboard write only) also ~645ms?
  6. Is there any rate-limiting, debounce, or settle-wait in the paste path?

Output: paste_mechanism_diagnosis.md — answers to the 6 questions above, with file:line citations.
Do NOT modify any file. Read-only.
```

---

## Human Approval Required

This investigation proposal requires founder review before any investigation is run.

Steps:
1. Read Section 3 (Approved Scope) and Section 4 (Forbidden Scope).
2. Confirm the investigation target matches the intended optimization direction.
3. Copy the investigation prompt from Section 10 to Claude Code for execution.
4. Review the diagnosis output before authorizing any implementation handoff.

---

*This proposal is planning_only / measurement_task output.*
*No product code was modified or proposed. Source data: v7_bottleneck_hypothesis.md, pipeline_logs_search_report.md*

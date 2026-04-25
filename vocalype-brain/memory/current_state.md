# Vocalype Brain — Current State

Last updated: 2026-04-25
Latest commit: 640f30e — docs(brain): close V9 growth distribution phase
Brain phase: V10 design complete — Phase 1 implementation is next

---

## Phase

**V10 Design — Unified Decision Engine. Design plan written. Phase 1 implementation pending.**
V10 joins V7 (product) + V8 (business) + V9 (distribution) by ISO week period key.
Answers each week: "Is the constraint product, funnel, or distribution?"
Rule-based decision matrix, confidence levels, graceful degradation on empty layers.
Design plan: `outputs/v10_design_plan.md` — 15 sections.
Phase 1 = single script `generate_unified_report.py` → `unified_weekly_report.md` + `weekly_action.md`.
Use exact prompt from `v10_design_plan.md` Section 15 to implement.

Current expected output: V7 product constraint MEDIUM confidence (paste_execute=645ms known).
V8 and V9: INSUFFICIENT DATA — 0 real observations in both layers.

V8 status: CLOSED. Infrastructure complete. Real business observations = 0 (founder Monday session pending).
V8 real data needed: record weekly metrics from Stripe / Supabase / Vercel each Monday (10 min).

---

## What Works Right Now

- Night Shift: 5-cycle proposal loop, proposal_only mode, local Ollama (qwen3:8b)
- Task classification: `planning_only` / `measurement_task` / `implementation_task`
- Codex task generation: measurement prompt, planning prompt, implementation prompt
- Quality signal tracking and scoring
- Post-implementation review via git diff
- Memory retrieval via embeddings + keyword match
- Full V2 loop validated: night_shift → classify → prompt → execute → review → commit
- **V3 — Safe Patch generation**: `generate_safe_patch.py` classifies target files and creates a patch proposal in `vocalype-brain/patches/`
- **V3 — Safe Patch review**: `review_safe_patch.py` summarizes the latest patch candidate and recommends next action
- **V3.5 — Apply Approved Patch**: `apply_approved_patch.py` applies `brain_safe`/`docs_safe` patches with `--approve`; dry-run by default; refuses product/unsafe patches; requires `## Apply Instructions` section in patch file
- **V5 — Product Patch Proposal**: `generate_product_patch_proposal.py` selects best frontend candidate, writes structured proposal + copy-pasteable implementation prompt; `review_product_patch_proposal.py` summarises and recommends next action

- **V6 — Product Implementation Handoff Loop**: `generate_handoff_task.py` reads approved proposal, runs 9 safety gates, extracts read-only code context, classifies task, writes `outputs/handoff_task.md`; `review_handoff_task.py` reviews latest record and recommends next action

- **V7 — Real Product Benchmark Loop**: Design plan at `outputs/v7_design_plan.md` — 13-section benchmark architecture covering latency, RAM, WER, activation stability, first dictation. Phase 1 = manual sessions. Phase 2 = baseline lock + comparison scripts.

- **V7 Phase 1 — Manual Benchmark Recorder**: `add_benchmark_observation.py` (CLI recorder) + `review_benchmarks.py` (report generator). Both validated. First observation recorded (`total_dictation_latency_ms = 2400ms`, first_dictation, parakeet, windows_4060). Waiting for ≥5 observations per priority metric.

## What Does Not Exist Yet

- `generate_unified_report.py` — V10 Phase 1 script (designed, not yet built)
- `unified_weekly_report.md` — V10 cross-layer report (not yet generated)
- `weekly_action.md` — V10 weekly action (not yet generated)
- `correlate_content_business.py` — V9 Phase 2 script (not yet built)
- `correlate_content_business.py` — V9 Phase 2 script (designed, not yet built)
- `compare_content_experiments.py` — V9 Phase 3 script (not yet designed)
- `lock_business_baseline.py` — V8 Phase 2 script (designed, not yet built)
- `fetch_business_metrics.py` — V8 Phase 2 automated pull script (designed, not yet built)
- `correlate_metrics.py` — V8 Phase 2 V7×V8 correlation script (designed, not yet built)
- `data/business_baseline.jsonl` — V8 locked baseline (not yet created)
- `lock_benchmark_baseline.py` — V7 Phase 2 script (designed, not yet built)
- `compare_benchmarks.py` — V7 Phase 2 script (designed, not yet built)
- `benchmark_baseline.jsonl` — V7 locked baseline (not yet created)
- `paste_mechanism_diagnosis.md` — V7 read-only investigation output (not yet run)
- `idle_background_transcription_diagnosis.md` — V7 Track B output (not yet run)
- Event tracking — no instrumentation in product code (separate V7.5 task if needed)

---

## V3 Safety Classes

| Class | Meaning | Patch file created? |
|---|---|---|
| `brain_safe` | Only `vocalype-brain/` files | Yes — Markdown proposal |
| `docs_safe` | Only README/docs/markdown | Yes — Markdown proposal |
| `product_proposal_only` | Product code involved | Yes — TEXT ONLY, never auto-applied |
| `unsafe` | Forbidden scope detected | No — rejection logged |

Forbidden scope (always blocked in V3):
`backend/`, `src-tauri/`, `src/lib/auth/client.ts`, `src/lib/license/client.ts`, payment, billing, security, translation.json

---

## North Star Metric

`successful_dictations_per_active_user_per_week`
Activation event: `first_successful_dictation`
Current baseline: unknown — manual observation required

---

## Top Active Quality Risks

1. `activation_failed` retry button added — manual test pending (all 5 activation states) — MEDIUM
2. Auto-refresh loop (8 × 2500ms) may exhaust before license propagates — MEDIUM (retry button now resets counter)
3. `isExpectedMissingLicenseMessage` may silently suppress real errors — MEDIUM

## Operating Contract

Future prompts may reference the contract instead of repeating safety rules:
> "Follow `vocalype-brain/memory/operating_contract.md`."

## Top Recommended Next Actions

1. **Implement V10 Phase 1** (next Brain session):
   - Use exact prompt from `vocalype-brain/outputs/v10_design_plan.md` Section 15
   - Creates: `generate_unified_report.py`, `unified_weekly_report.md`, `weekly_action.md`

2. **Record real content observations** (after each post — founder task):
   - After publishing: `python vocalype-brain/scripts/add_content_observation.py --platform <p> --content_type <t> --hook "<h>" --niche <n> --target_user "<u>" --cta "<c>" --period <YYYY-Www> --source manual_founder`
   - 24–72h later: add `--views`, `--likes`, `--saves`, `--lesson`, `--next_action` to same script with `--record_type performance_update`
   - Review: `python vocalype-brain/scripts/review_content_performance.py`
   - Snapshot: `python vocalype-brain/scripts/weekly_content_snapshot.py`

2. **Record real V8 business observations** (10-min weekly session — founder task):
   - Open Stripe → record `mrr`, `paid_conversions`, `trial_starts`, `churned_users`, `refunds`
   - Open Supabase → record `account_signups`, `activation_attempts`, `first_successful_dictations`
   - Open Vercel → record `website_visitors`, `downloads`
   - Record each: `python vocalype-brain/scripts/add_business_observation.py --metric <m> --value <v> --unit <u> --source <s> --period <YYYY-Www>`
   - Review: `python vocalype-brain/scripts/review_business_metrics.py`

3. **V7 product investigations** (parallel track, lower priority until V9 Phase 1 done):
   - Track A: read-only investigation of `src-tauri/src/actions/paste.rs` → `paste_mechanism_diagnosis.md`
   - Track B: read-only investigation of audio manager → `idle_background_transcription_diagnosis.md`

---

## Validated Safety Rules (do not remove)

- `allow_product_code_modifications: false` — Brain never writes product code directly
- Night Shift is `proposal_only` — cannot apply patches
- `FORBIDDEN_PATTERNS` blocks backend/, src-tauri/, auth/client.ts, license/client.ts
- Scope reduction enforces frontend-first before any implementation prompt
- Score < 25 or risk = high → `planning_only` classification, no implementation
- `measurement_task` classification → plan file only, no product code
- V3: `unsafe` safety class → no patch file generated, rejection logged
- V3: `product_proposal_only` → patch file is text only, never auto-applied
- V3.5: `--approve` required for any write; dry-run by default
- V3.5: requires `## Apply Instructions` section; refuses if missing
- V3.5: resolves and validates absolute path before any write
- `--no-verify` is never used on commits

---

## Model Setup

- CEO / Critic: qwen3:8b
- Coder: qwen2.5-coder:7b
- Embeddings: nomic-embed-text
- Fast: qwen3:4b (fallback: qwen3:8b)
- `keep_alive: 0` on all roles (models unloaded after each call)

---

## Key Files

| Purpose | File |
|---|---|
| Full V2 status report | outputs/v2_status_report.md |
| Activation measurement plan | outputs/measure_activation_failure_points.md |
| Latest Codex task | outputs/codex_task.md |
| Approved task candidates | data/approved_task_candidates.jsonl |
| Safe patch candidates | data/safe_patch_candidates.jsonl |
| Safe patch report | outputs/safe_patch_report.md |
| Apply patch report | outputs/apply_patch_report.md |
| Applied patches log | data/applied_patches.jsonl |
| Product patch proposal | outputs/product_patch_proposal_report.md |
| Product proposals log | data/product_patch_proposals.jsonl |
| V6 design plan | outputs/v6_design_plan.md |
| V6 handoff task | outputs/handoff_task.md |
| V6 handoff tasks log | data/handoff_tasks.jsonl |
| V7 design plan | outputs/v7_design_plan.md |
| V7 benchmark observations | data/benchmark_observations.jsonl |
| V7 benchmark report | outputs/benchmark_report.md |
| V7 bottleneck hypothesis | outputs/v7_bottleneck_hypothesis.md |
| V7 pipeline logs search report | outputs/pipeline_logs_search_report.md |
| V7 paste investigation proposal | outputs/product_patch_proposal_report.md |
| Paste mechanism diagnosis (pending) | outputs/paste_mechanism_diagnosis.md |
| V7 final status report | outputs/v7_final_status_report.md |
| V7 closure report + V8 entry | outputs/v7_closure_report.md |
| V8 design plan | outputs/v8_design_plan.md |
| V8 business observations | data/business_observations.jsonl |
| V8 business metrics report | outputs/business_report.md |
| V8 business baseline (pending) | data/business_baseline.jsonl |
| V8C missing metrics protocol | outputs/v8_missing_metrics_protocol.md |
| V8D weekly business snapshot | outputs/weekly_business_snapshot.md |
| V8 closure report | outputs/v8_closure_report.md |
| **V9 design plan** | **outputs/v9_design_plan.md** |
| V9 content observations | data/content_observations.jsonl |
| V9 content report | outputs/content_report.md |
| V9 weekly content snapshot | outputs/weekly_content_snapshot.md |
| V9 closure report | outputs/v9_closure_report.md |
| **V10 design plan** | **outputs/v10_design_plan.md** |
| V10 unified weekly report (pending) | outputs/unified_weekly_report.md |
| V10 weekly action (pending) | outputs/weekly_action.md |
| Patch proposal files | patches/ |
| Quality signals | data/quality_observations.jsonl |
| Quality report | outputs/quality_report.md |
| Implementation review | outputs/implementation_review.md |
| Wins | memory/wins.md |
| Mistakes | memory/mistakes.md |
| Lessons learned | memory/lessons_learned.md |
| **Operating contract** | **memory/operating_contract.md** |
| Brain config | config/brain.config.json |

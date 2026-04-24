# Vocalype Brain — Current State

Last updated: 2026-04-24
Latest commit: 706d6c0 — feat(app): add activation retry state for first dictation
Brain commit: 12b3295 — feat(brain): add V6 implementation handoff loop

---

## Phase

**V7 — Real Product Benchmark Loop. Design plan written, Phase 1 (manual sessions) not yet started.**

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

## What Does Not Exist Yet

- V7 Phase 1: ≥5 manual benchmark sessions not yet run
- `review_benchmarks.py` — V7 Phase 1 script (designed, not yet built)
- `lock_benchmark_baseline.py` — V7 Phase 2 script (designed, not yet built)
- `compare_benchmarks.py` — V7 Phase 2 script (designed, not yet built)
- `benchmark_observations.jsonl` — manual observation log (not yet created)
- `benchmark_baseline.jsonl` — locked baseline (not yet created)
- `validate_patch.py` — no automated lint/test runner triggered by Brain
- `rollback_patch.py` — revert is done manually via `git checkout -- <file>`
- Baseline metrics — `activation_success_rate` and `dictation_latency_ms` both unknown
- Event tracking — no instrumentation in product code

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

1. Run manual test: all 5 activation states (logged_out, checking_activation, subscription_inactive, activation_failed, ready)
2. Run ≥5 V7 manual benchmark sessions (M1–M7 protocol in `outputs/v7_design_plan.md` Section 4)
3. Build `review_benchmarks.py` after ≥5 sessions
4. Lock baseline with `lock_benchmark_baseline.py --approve`
5. Complete manual observation checklist (`outputs/measure_activation_failure_points.md`, Section 6)

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
| Patch proposal files | patches/ |
| Quality signals | data/quality_observations.jsonl |
| Quality report | outputs/quality_report.md |
| Implementation review | outputs/implementation_review.md |
| Wins | memory/wins.md |
| Mistakes | memory/mistakes.md |
| Lessons learned | memory/lessons_learned.md |
| **Operating contract** | **memory/operating_contract.md** |
| Brain config | config/brain.config.json |

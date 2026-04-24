# Vocalype Brain — Current State

Last updated: 2026-04-24
Validation commit: f25a417

---

## Phase

**V2 — Validated.**
V3 Safe Patch Mode is the recommended next phase.

---

## What Works Right Now

- Night Shift: 5-cycle proposal loop, proposal_only mode, local Ollama (qwen3:8b)
- Task classification: `planning_only` / `measurement_task` / `implementation_task`
- Codex task generation: measurement prompt, planning prompt, implementation prompt
- Quality signal tracking and scoring
- Post-implementation review via git diff
- Memory retrieval via embeddings + keyword match
- Full loop validated: night_shift → classify → prompt → execute → review → commit

## What Does Not Exist Yet

- `apply_patch.py` — no automated patch application
- `validate_patch.py` — no automated lint/test runner
- `rollback_patch.py` — no automated rollback
- Baseline metrics — `activation_success_rate` and `dictation_latency_ms` both unknown
- Event tracking — no instrumentation in product code

---

## North Star Metric

`successful_dictations_per_active_user_per_week`
Activation event: `first_successful_dictation`
Current baseline: unknown — manual observation required

---

## Top Active Quality Risks

1. `activation_failed` state shows no actionable guidance — HIGH
2. Auto-refresh loop (8 × 2500ms) may exhaust before license propagates — MEDIUM
3. `isExpectedMissingLicenseMessage` may silently suppress real errors — MEDIUM

## Top Recommended Next Actions

1. Complete manual observation checklist (outputs/measure_activation_failure_points.md, Section 6)
2. Implement O1 + O2 from measurement plan (improve activation_failed message + add retry button)
3. Deduplicate wins.md and mistakes.md entries
4. Begin V3 apply_patch.py (dry-run, single-file, FRONTEND_SAFE_FILES only)

---

## Validated Safety Rules (do not remove)

- `allow_product_code_modifications: false` — Brain never writes product code directly
- Night Shift is `proposal_only` — cannot apply patches
- `FORBIDDEN_PATTERNS` blocks backend/, src-tauri/, auth/client.ts, license/client.ts
- Scope reduction enforces frontend-first before any implementation prompt
- Score < 25 or risk = high → `planning_only` classification, no implementation
- `measurement_task` classification → plan file only, no product code
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
| Quality signals | data/quality_observations.jsonl |
| Quality report | outputs/quality_report.md |
| Latest Codex task | outputs/codex_task.md |
| Approved task candidates | data/approved_task_candidates.jsonl |
| Implementation review | outputs/implementation_review.md |
| Wins | memory/wins.md |
| Mistakes | memory/mistakes.md |
| Lessons learned | memory/lessons_learned.md |
| Brain config | config/brain.config.json |

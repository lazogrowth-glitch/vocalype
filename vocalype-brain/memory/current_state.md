# Vocalype Brain — Current State

Last updated: 2026-04-24
Latest commit: 772c869 — feat(brain): add V3 safe patch mode

---

## Phase

**V3.5 — Apply Approved Patch Mode. Built, not yet committed.**

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

## What Does Not Exist Yet

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

1. `activation_failed` state shows no actionable guidance — HIGH
2. Auto-refresh loop (8 × 2500ms) may exhaust before license propagates — MEDIUM
3. `isExpectedMissingLicenseMessage` may silently suppress real errors — MEDIUM

## Top Recommended Next Actions

1. Complete manual observation checklist (`outputs/measure_activation_failure_points.md`, Section 6)
2. Run `generate_safe_patch.py` → confirm `brain_safe` for the current measurement task
3. When ready for product fix: re-run `create_codex_task.py` after adding activation_failed observation → should yield `implementation_task` → `product_proposal_only` patch
4. Apply O1 + O2 from measurement plan (improve `activation_failed` message + add retry button)

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
| Patch proposal files | patches/ |
| Quality signals | data/quality_observations.jsonl |
| Quality report | outputs/quality_report.md |
| Implementation review | outputs/implementation_review.md |
| Wins | memory/wins.md |
| Mistakes | memory/mistakes.md |
| Lessons learned | memory/lessons_learned.md |
| Brain config | config/brain.config.json |

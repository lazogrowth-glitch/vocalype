# Vocalype Brain â€” V2 Status Report

Date: 2026-04-24
Validation commit: f25a417 â€” feat(brain): validate V2 measurement task flow
Product code modified: NO

---

## 1. What V1 Accomplished

V1 established the full Brain scaffolding and executed the first real implementation cycle.

**Infrastructure built:**
- `night_shift.py` â€” 5-cycle proposal-only loop using local Ollama models
- `review_night_shift.py` â€” morning review of proposals
- `performance_quality_loop.py` / `add_quality_observation.py` / `review_quality.py` â€” quality signal tracking
- `review_implementation.py` / `record_result.py` / `review_results.py` â€” post-implementation review loop
- `create_codex_task.py` â€” turns Night Shift proposals into scoped Codex prompts
- `context_builder.py` / `index_memory.py` / `retrieve_context.py` â€” memory retrieval layer
- `model_router.py` â€” routes tasks to the right local model (ceo, coder, critic, embeddings, fast)
- Full `memory/` layer: lessons_learned, wins, mistakes, quality_playbook, founder_rules, etc.

**First real product improvement:**
- Commit `423fe7e` â€” frontend-only clarification of first successful dictation readiness UI
- `AuthPortal.tsx` and `App.tsx` updated with clearer activation state messaging
- Stayed within the approved frontend-only scope
- No backend, Rust, auth logic, or payment code touched

**V1 limitation discovered:**
- `create_codex_task.py` had no task type classification
- "Measure activation failure points" (a measurement proposal) was routed as an implementation task
- The generated prompt included product files in its approved scope
- The loop correctly stopped before executing, but the root cause was unclassified task intent

---

## 2. What V2 Accomplished

V2 fixed the classification gap and validated the full loop end-to-end with a measurement task.

**Classification fix (commit `c9a4e38`):**
- Added `MEASUREMENT_TERMS` and `PLANNING_ONLY_TERMS` keyword lists to `create_codex_task.py`
- Added `_classify_task_type(candidate)` â€” returns `planning_only`, `measurement_task`, or `implementation_task`
- Added `_measurement_prompt()` â€” generates a plan-only prompt with 9 required sections, explicit forbidden scope, no product code
- All three `_best_candidate()` branches now set `task_type` on the candidate
- `task_type` is written to both `codex_task.md` and `approved_task_candidates.jsonl`
- `mode = "measurement"` routes to `_measurement_prompt` instead of the implementation template

**Full V2 loop validated (commit `f25a417`):**
1. `night_shift.py` â€” 5 cycles, 5 proposals generated, proposal_only mode confirmed
2. `review_night_shift.py` â€” top proposal: First successful dictation (score 70)
3. `create_codex_task.py` â€” selected "Measure activation failure points", classified as `measurement_task`
4. `codex_task.md` â€” generated measurement plan prompt, not implementation prompt
5. Measurement task executed: `measure_activation_failure_points.md` created with all 9 sections
6. `review_implementation.py` + `review_results.py` â€” results recorded, lessons updated
7. Commit passed all hooks, no product code in diff

**Measurement plan produced** (`outputs/measure_activation_failure_points.md`):
- 11-step activation flow map with source file references
- 10 identified failure points (F1â€“F10) with exact code locations
- 7 files identified for future inspection (not modified)
- 7 proposed metrics including `activation_success_rate` and `time_to_ready_ms`
- 9 candidate tracking events (no implementation yet)
- 10-scenario manual observation checklist
- 6 implementation options ranked by risk (O1â€“O6)
- Risk table with 5 known risks
- Recommendation: manual observation first, then O1 + O2 (frontend-only) before any instrumentation

---

## 3. Current Working Capabilities

| Capability | Status |
|---|---|
| Night Shift proposal loop (5 cycles, proposal_only) | Working |
| Local model routing (ceo, coder, critic, embeddings, fast) | Working |
| Quality signal tracking and quality report generation | Working |
| Task classification: planning_only / measurement_task / implementation_task | Working (added V2) |
| Measurement prompt generation (9-section plan, no product code) | Working (added V2) |
| Implementation prompt generation (frontend-only, scoped) | Working |
| Scope reduction to frontend-safe files | Working |
| Critic review of scope and safety | Working |
| Post-implementation review (git diff inspection) | Working |
| Results recording and report generation | Working |
| Memory retrieval via embeddings + keyword match | Working |
| `task_type` field in JSONL records and codex_task.md | Working (added V2) |
| Full loop: night_shift â†’ classify â†’ prompt â†’ review â†’ commit | Validated |

---

## 4. Current Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Night Shift still proposes sensitive files (backend, Rust, auth) | Proposals need manual scope review before approval | Scope reduction in `create_codex_task.py` catches this; `FORBIDDEN_PATTERNS` enforced |
| No actual patch application â€” Brain can propose but not apply | Human must copy prompt to Codex/Claude for execution | By design; V3 Safe Patch Mode is the intended next step |
| `review_implementation.py` reads git diff, not Brain-tracked changes | Diff summary may include unrelated Brain data files | Low risk; product scope checked separately |
| Measurement baselines are all "unknown" | No before/after comparison is possible yet | Manual observation checklist is the bridge |
| `activation_success_rate` has no instrumentation | Cannot measure the north-star activation metric programmatically | Measurement plan exists; O4/O5 options identified |
| Wins/mistakes memory has duplicate entries | Repeated entries reduce signal quality | Needs a deduplication pass before V3 |
| Quality report date is 2026-04-23 (one day stale) | Report may not reflect latest quality observations | Re-run `performance_quality_loop.py` after adding new observations |
| `model_router.py` uses `keep_alive: 0` | Each call cold-starts the model | Acceptable for low-frequency Brain runs; adds ~2-5s per call |

---

## 5. Validated Workflow

The following sequence has been executed and committed successfully:

```
# Step 1 â€” Observe and log a quality signal
python internal/brain/scripts/add_quality_observation.py "Description of issue"

# Step 2 â€” Run quality loop to turn observations into scored actions
python internal/brain/scripts/performance_quality_loop.py
python internal/brain/scripts/review_quality.py

# Step 3 â€” Run Night Shift (autonomous proposal cycle)
python internal/brain/scripts/night_shift.py
python internal/brain/scripts/review_night_shift.py

# Step 4 â€” Generate classified Codex task
python internal/brain/scripts/create_codex_task.py
# Inspect: internal/brain/outputs/codex_task.md
# Check: task_type field

# Step 5 â€” Execute task (human reviews codex_task.md first)
# If task_type = measurement_task: create plan file only, no product code
# If task_type = implementation_task: send to Codex/Claude with approved scope
# If task_type = planning_only: clarify before acting

# Step 6 â€” Review and record result
python internal/brain/scripts/review_implementation.py
python internal/brain/scripts/review_results.py

# Step 7 â€” Commit if only Brain files changed
git add internal/brain/
git commit -m "feat(brain): <description>"
```

**Gate rule before execution:**
- Read `codex_task.md`
- Confirm `task_type` is shown
- Confirm "Forbidden" section excludes backend, auth, Rust, payment
- Confirm "Allowed" section is narrow and frontend-first
- Only proceed if all three pass

---

## 6. Safety Rules That Worked

These rules were tested during V1 and V2 and held:

| Rule | Evidence |
|---|---|
| `allow_product_code_modifications: false` in `brain.config.json` | Night Shift never wrote to product files directly |
| `FORBIDDEN_PATTERNS` in `create_codex_task.py` | Blocked backend/, src-tauri/, auth/client.ts, license/client.ts from approved scope |
| `_frontend_reduction()` narrows scope before prompt generation | Reduced over-broad Night Shift proposals to safe frontend surface |
| Score threshold: candidates below 25 or with `risk: high` route to `planning_only` | Prevented risky proposals from becoming implementation tasks |
| `measurement_task` classification blocks implementation prompt generation | "Measure activation failure points" correctly generated a plan, not a patch |
| Commit hook (`bun scripts/check-translations.ts`) ran without bypass | All 16 translations verified on every commit; `--no-verify` never used |
| Brain writes only to `internal/brain/` | No product file appears in any Brain commit diff |

---

## 7. Known Risks

| Risk | Severity | Status |
|---|---|---|
| Night Shift still proposes Rust/backend files | Medium | Mitigated by scope reduction; not fully blocked at proposal stage |
| `isExpectedMissingLicenseMessage` silently suppresses license errors | Medium | Identified in measurement plan F8; not yet fixed |
| Auto-refresh loop (8 Ã— 2500ms) can exhaust before license propagates | Medium | Identified as F6; no timeout UI exists |
| `activation_failed` state gives no actionable guidance | High | Top recommendation in measurement plan (O1 + O2); not yet fixed |
| Wins/mistakes memory has duplicate entries (2026-04-23 and 2026-04-24) | Low | Needs dedup before memory retrieval quality degrades |
| `deriveActivationStatus` depends on backend reason string content | Medium | If backend changes "Activation failed" wording, status derivation breaks silently |
| No baseline metrics recorded | Medium | All metrics are "unknown"; measurement plan is the bridge |

---

## 8. Recommended Next Phase: V3 Safe Patch Mode

V3 should allow Brain to apply a single, small, human-approved patch to a frontend file â€” without any autonomous deployment or sensitive-file access.

**V3 goal:** Close the gap between proposal â†’ plan â†’ human approves â†’ patch applied.

**Proposed V3 capabilities (in order of implementation):**
1. `apply_patch.py` â€” reads `codex_task.md`, confirms `task_type = implementation_task`, applies a single diff to one approved frontend file, logs the change
2. `validate_patch.py` â€” runs `npm run lint` and the validation command from `codex_task.md`, reports pass/fail
3. `rollback_patch.py` â€” reverts the patch file via `git checkout -- <file>` if validation fails
4. Updated `create_codex_task.py` â€” adds a `patch_diff` field to the approved task record (the exact diff to apply, not just the prompt)

**V3 safety constraints (non-negotiable):**
- Only one file per patch
- Only files in `FRONTEND_SAFE_FILES` or a new `PATCH_APPROVED_FILES` allowlist
- No auto-commit â€” human runs `git add` and `git commit` manually
- No execution of arbitrary shell commands
- Dry-run mode by default; `--apply` flag required to actually write
- Patch must be reviewed and approved by founder before `apply_patch.py --apply` is run

**V3 should NOT include:**
- Multi-file patches
- Backend, Rust, auth, payment, or i18n file writes
- Auto-deployment
- Autonomous approval

---

## 9. Exact Next Commands for the Founder

### Today â€” Manual observation (no code needed)

```bash
# Work through the manual observation checklist from the measurement plan
# File: internal/brain/outputs/measure_activation_failure_points.md
# Section 6 â€” Manual Observation Checklist (10 scenarios)

# Record what you observe
python internal/brain/scripts/add_quality_observation.py "Your observation here"
```

### After observation â€” If activation_failed confirmed as real friction

```bash
# The safe next implementation is O1 + O2 from the measurement plan:
# O1: Improve activation_failed error message (UI text only, AuthPortal.tsx)
# O2: Add retry button on activation_failed state (AuthPortal.tsx)

# Run quality loop to re-score
python internal/brain/scripts/performance_quality_loop.py
python internal/brain/scripts/review_quality.py

# Regenerate Codex task â€” should now classify as implementation_task
python internal/brain/scripts/create_codex_task.py

# Read codex_task.md â€” verify:
# - task_type: implementation_task
# - approved_files: only AuthPortal.tsx
# - forbidden scope includes backend, Rust, auth client
# Then send to Codex/Claude for implementation
```

### Ongoing Brain maintenance

```bash
# After each Night Shift run
python internal/brain/scripts/night_shift.py
python internal/brain/scripts/review_night_shift.py
python internal/brain/scripts/create_codex_task.py

# After each implementation
python internal/brain/scripts/review_implementation.py
python internal/brain/scripts/review_results.py

# Commit Brain-only changes
git add internal/brain/
git commit -m "feat(brain): <description>"
```

### When ready to build V3

Create `internal/brain/scripts/apply_patch.py` with:
- Dry-run by default
- Single-file constraint
- `FRONTEND_SAFE_FILES` allowlist only
- No auto-commit
- Reads from `approved_task_candidates.jsonl` â€” only processes `task_type: implementation_task`

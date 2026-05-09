# Vocalype Brain â€” V6 Design Plan
# Product Implementation Handoff Loop

Date: 2026-04-24
Status: planning_only â€” design document only, no scripts implemented yet
Author: Vocalype Brain

---

## 1. What V6 Should Do

V6 is the **handoff layer** between an approved product patch proposal (V5 output) and a
safe, precise implementation task that can be sent to Claude Code, Codex, or Aider.

Specifically, V6 should:

1. **Read** the latest approved product patch proposal from
   `data/product_patch_proposals.jsonl` and `outputs/product_patch_proposal_report.md`.
2. **Validate** that the proposal is approved and safe to hand off (risk â‰  high, no
   sensitive files, target files defined, manual approval confirmed).
3. **Enrich** the proposal with precise context: read the actual target files from the
   product repo, extract relevant sections (component structure, hook signatures, existing
   i18n keys, current error messages), and inline them into the task.
4. **Generate** a structured `handoff_task.md` â€” a self-contained implementation task
   document that an implementation model can act on without needing to explore the codebase.
5. **Classify** the generated task as one of four types (see Section 8) and refuse to
   produce an `implementation_task` handoff if any safety gate fails.
6. **Log** every handoff attempt to `data/handoff_tasks.jsonl` with full metadata.
7. **Produce** a review report (`outputs/handoff_task_report.md`) summarising the handoff
   and recommending the next human action.

V6 does NOT call an implementation model. It only prepares and validates the task.

---

## 2. What V6 Must NOT Do

- **Never modify product code** â€” `src/`, `src-tauri/`, `backend/` are read-only at most.
- **Never auto-apply** any patch or diff.
- **Never infer scope** â€” if the approved proposal does not specify exact file paths, V6
  must stop and write a `planning_only` task, not guess.
- **Never widen scope** beyond the approved target files listed in the proposal.
- **Never touch** forbidden patterns:
  `backend/`, `src-tauri/`, `src/lib/auth/client.ts`, `src/lib/license/client.ts`,
  payment, billing, security, translation.json, secret_store, `.env`
- **Never produce an implementation_task handoff** for a proposal with risk = high.
- **Never produce an implementation_task handoff** if `sensitive_files_involved: true`.
- **Never produce an implementation_task handoff** if `manual_approval_required` is not
  confirmed in the proposal record.
- **Never commit on behalf of the implementation model** â€” commit is always a manual step.
- **Never use `--no-verify`**.
- **Never implement V7** â€” V6 must only prepare for V7 by recording benchmark metadata
  placeholders (see Section 9), not by running benchmarks.

---

## 3. Exact Input Files

| Input | Path | Purpose |
|---|---|---|
| Approved proposal record | `data/product_patch_proposals.jsonl` (latest) | Source of truth for task scope |
| Proposal report | `outputs/product_patch_proposal_report.md` | Human-readable context and constraints |
| Latest codex task | `outputs/codex_task.md` | Background: what was classified as the problem |
| Measurement plan | `outputs/measure_activation_failure_points.md` | Background: failure points, options O1â€“O6 |
| Brain config | `config/brain.config.json` | Safety rules, forbidden patterns |
| Product target files | `src/components/auth/AuthPortal.tsx` etc. | Read-only â€” extract existing code context |
| Existing i18n keys | `src/locales/en.json` (or equivalent) | Read-only â€” avoid hardcoded strings |
| Applied patches log | `data/applied_patches.jsonl` | Deduplication â€” do not re-propose applied patches |

**Stop condition**: If the latest proposal record has `status != "proposed"` or
`manual_approval_required != true`, V6 must refuse to generate an `implementation_task`
handoff and must write a `planning_only` output instead.

---

## 4. Exact Output Files

| Output | Path | Written by |
|---|---|---|
| Handoff task document | `outputs/handoff_task.md` | `generate_handoff_task.py` |
| Handoff tasks log | `data/handoff_tasks.jsonl` | `generate_handoff_task.py` |
| Handoff review report | `outputs/handoff_task_report.md` | `review_handoff_task.py` |

**`handoff_task.md`** is the primary deliverable â€” a complete, self-contained Markdown
document structured so that Claude Code, Codex, or Aider can implement it without further
context gathering. See Section 5 for the exact format.

---

## 5. Exact Handoff Task Format

```markdown
# Vocalype â€” Implementation Handoff Task

Date: {ISO datetime}
Proposal: {proposal title}
Task type: implementation_task | planning_only | measurement_task
Risk: low | medium | high
Safety class: product_proposal_only

---

## Problem Statement

{1â€“3 sentence description of the user-facing problem, sourced from proposal.summary}

## Why It Matters

{1â€“2 sentence impact statement, sourced from proposal.why_it_matters}

## Approved Scope

Files the implementation model is allowed to modify:
{list of target_files from proposal, one per line with - prefix}

## Forbidden Scope

Files and patterns the implementation model must never touch:
- backend/
- src-tauri/
- src/lib/auth/client.ts
- src/lib/license/client.ts
- payment or billing logic
- auth state logic
- license validation logic
- Rust dictation runtime
- translation.json / i18n files (add new keys only via correct key registration)

## Existing Code Context

### {target_file_1} â€” Current Structure
{extracted relevant section: component signature, props, existing states, current error text}

### {target_file_2} â€” Current Structure
{extracted relevant section: hook signature, exported values, current state names}

## Existing i18n Keys (relevant)
{list of key: value pairs already in the locale file that are relevant to this change}

## Implementation Instructions

{precise step-by-step instructions derived from proposal.proposed_changes}

1. {step 1}
2. {step 2}
...

## Constraints

- Keep the change small and measurable
- Frontend-only â€” do not touch backend, auth client, license client, or Rust
- No new dependencies
- Use existing i18n keys if modifying user-facing strings; register new keys correctly
- Do not widen scope beyond the approved files above
- One logical change per commit

## Validation

{validation_plan from proposal, expanded with exact commands}

- npm run lint
- npm run format
- Manual test: {scenario list from measure_activation_failure_points.md Section 6}

## Rollback Plan

```
git checkout -- {space-separated target files}
```

## Safety Rules

- Do not modify product code outside the approved scope
- Do not apply unrelated patches
- Do not deploy
- Do not delete files
- Do not use --no-verify
- Do not loosen safety rules

## What To Report After Implementation

- Every file changed (path + brief description)
- Commands run and whether they passed
- Exact UI/copy changes made
- Manual test results for all activation states
- Remaining risks or limitations
- Suggested follow-up measurement task
```

---

## 6. Required Safety Gates

All gates are evaluated in order. A single failure aborts `implementation_task` generation
and produces a `planning_only` output with the failure reason.

| Gate | Check | Failure action |
|---|---|---|
| G1 â€” Proposal exists | `product_patch_proposals.jsonl` non-empty | Abort, log: "No approved proposal" |
| G2 â€” Proposal status | `status == "proposed"` | Abort, log: "Proposal not in proposed state" |
| G3 â€” Manual approval | `manual_approval_required == true` | Abort, log: "Proposal missing manual approval flag" |
| G4 â€” Risk level | `risk != "high"` | Abort, log: "Risk is HIGH â€” founder review required" |
| G5 â€” Sensitive files | `sensitive_files_involved == false` | Abort, log: "Sensitive files involved" |
| G6 â€” Target files defined | `len(target_files) > 0` | Abort, log: "No target files defined" |
| G7 â€” Forbidden patterns | None of target_files matches FORBIDDEN_PATTERNS | Abort, log: "Forbidden file in scope: {file}" |
| G8 â€” Deduplication | Not already in `applied_patches.jsonl` | Abort, log: "Patch already applied" |
| G9 â€” Context readable | Target files exist and are readable | Abort, log: "Cannot read target file: {file}" |

**Belt-and-suspenders rule**: G7 is checked twice â€” once on the raw proposal strings, once
after resolving absolute paths against the project root.

---

## 7. How V6 Protects Product Code from Vague Implementation

Vague implementation prompts are the primary risk in any AI-assisted code change.
V6 addresses this through three mechanisms:

### 7a â€” Context Inlining
V6 reads the actual current code from target files and inlines the relevant sections
directly into `handoff_task.md`. The implementation model sees the exact component
signature, existing state names, current error messages, and relevant i18n keys â€” it does
not need to explore the codebase and cannot accidentally widen scope.

### 7b â€” Explicit Forbidden Scope
Every handoff task document includes a mandatory `## Forbidden Scope` section with both
path patterns AND semantic descriptions (e.g., "auth state logic", "license validation
logic"). A semantic description catches cases where a file is not in the pattern list but
is still off-limits by intent.

### 7c â€” Stop Conditions in the Task Document Itself
If the proposal's `proposed_changes` list is empty or contains only vague entries
(e.g., "improve the UI"), V6 writes a `planning_only` task and appends a note:
> "Stop: proposed_changes too vague to generate safe implementation instructions.
>  Return to measure â†’ diagnose â†’ propose cycle before generating implementation task."

This ensures the handoff document is never produced in an ambiguous state.

---

## 8. Task Classification in V6

V6 uses the same four-class taxonomy as V2/V5, applied to the handoff layer:

| Class | Condition | V6 output |
|---|---|---|
| `planning_only` | Any safety gate fails, OR proposed_changes too vague, OR risk=high | `handoff_task.md` with planning instructions only, no code steps |
| `measurement_task` | Proposal source is a measurement plan option (O1â€“O6) that requires data collection before implementation | `handoff_task.md` with measurement checklist only |
| `proposal_task` | Proposal exists but target files context cannot be read, OR scope not yet narrow enough | `handoff_task.md` with refined proposal instructions for next V5 run |
| `implementation_task` | All 9 safety gates pass, proposed_changes specific, context readable | Full `handoff_task.md` with inlined code context and step-by-step instructions |

**Escalation rule**: If the classifier is uncertain between `measurement_task` and
`implementation_task`, it must choose `measurement_task`. Measurement is always safer than
premature implementation.

---

## 9. How V6 Prepares for V7 Without Implementing It

V6 is NOT V7. But V6 should leave clean hooks for V7 by doing two things:

### 9a â€” Benchmark Metadata Placeholder in Handoff Task
Every `implementation_task` handoff document generated by V6 includes a
`## Benchmark Baseline` section with `unknown` values and a note:
> "V7 will populate these before and after implementation to measure real impact."

Example:
```markdown
## Benchmark Baseline (V7 will populate)

| Metric | Before | After |
|---|---|---|
| dictation_latency_ms | unknown | unknown |
| idle_ram_mb | unknown | unknown |
| activation_success_rate | unknown | unknown |
| transcription_error_rate | unknown | unknown |
```

This records *which metrics matter* for this specific change â€” so V7 can know exactly
what to benchmark when it runs.

### 9b â€” Benchmark Scope Note in handoff_tasks.jsonl
Each handoff record in `data/handoff_tasks.jsonl` includes a `benchmark_scope` field:
```json
{
  "benchmark_scope": {
    "latency": true,
    "ram": false,
    "transcription_quality": false,
    "activation_stability": true
  }
}
```

V7 will read this field to know which benchmark suite to run for a given change,
without needing to re-classify from scratch.

**Stop condition**: V6 must never run benchmarks, never execute product code, and never
instrument product code. V7 is a separate phase requiring its own planning_only design pass.

---

## 10. Files Likely Involved in Future V6 Implementation

| File | Role | Notes |
|---|---|---|
| `internal/brain/scripts/generate_handoff_task.py` | Main V6 script | Reads proposal, extracts context, applies gates, writes handoff_task.md |
| `internal/brain/scripts/review_handoff_task.py` | Review script | Reads handoff_tasks.jsonl, prints review and recommended next action |
| `internal/brain/scripts/brain.py` | Library | Already exists â€” add `read_product_file(path)` helper if needed |
| `internal/brain/data/handoff_tasks.jsonl` | Log | Created on first run, one record per handoff attempt |
| `internal/brain/outputs/handoff_task.md` | Primary deliverable | Overwritten each run with latest handoff task |
| `internal/brain/outputs/handoff_task_report.md` | Human review | Summary + recommended next action |
| `internal/brain/config/brain.config.json` | Config | Add `v6_context_max_lines` limit (default: 80 lines per file) |
| `src/components/auth/AuthPortal.tsx` | Product file â€” read-only | Context extracted, never written |
| `src/hooks/useAuthFlow.ts` | Product file â€” read-only | Context extracted, never written |

**Key constraint**: `generate_handoff_task.py` must open product files with
`open(path, 'r', encoding='utf-8')` only â€” never `open(path, 'w')`.
A `_read_product_file_safe(path)` helper should enforce this at the function level.

---

## 11. Implementation Steps for the Next Task After This Design

When the founder approves this design plan, the next task is:

**V6 â€” Step 1: Scaffold**
1. Create `internal/brain/scripts/generate_handoff_task.py` with:
   - All 9 safety gates (Section 6)
   - Task classifier (Section 8)
   - `_read_product_file_safe(path)` â€” read-only file reader with line limit
   - `_extract_context(path)` â€” extract component/hook signature and relevant lines
   - `_build_handoff_task(proposal, context)` â€” renders `handoff_task.md` using format from Section 5
   - `_build_benchmark_scope(proposal)` â€” determines which V7 metrics apply
   - Dry-run mode by default, `--approve` required to write output files
   - Append to `data/handoff_tasks.jsonl` only on approve

2. Create `internal/brain/scripts/review_handoff_task.py` with:
   - Reads `data/handoff_tasks.jsonl`, shows latest record
   - Prints safety gate results
   - Prints recommended next action (same pattern as `review_product_patch_proposal.py`)

3. Create `internal/brain/data/handoff_tasks.jsonl` (empty placeholder)
4. Create `internal/brain/outputs/handoff_task.md` (empty placeholder)
5. Create `internal/brain/outputs/handoff_task_report.md` (empty placeholder)
6. Update `internal/brain/README.md` with V6 section
7. Update `internal/brain/memory/current_state.md` with V6 status

**V6 â€” Step 2: Validate**
1. Run `python internal/brain/scripts/generate_handoff_task.py` (dry-run)
   â†’ Expect: safety gates evaluated, task classified, handoff_task.md NOT written
2. Run `python internal/brain/scripts/generate_handoff_task.py --approve`
   â†’ Expect: handoff_task.md written, data/handoff_tasks.jsonl appended
3. Run `python internal/brain/scripts/review_handoff_task.py`
   â†’ Expect: summary printed, recommended next action shown
4. Verify `handoff_task.md` contains `## Existing Code Context` with real lines from AuthPortal.tsx
5. Verify `handoff_task.md` contains `## Benchmark Baseline (V7 will populate)` section
6. Verify no product files were modified: `git diff src/`

---

## 12. Validation Commands for Future V6 Implementation

```bash
# 1. Dry-run â€” verify gates, no files written
python internal/brain/scripts/generate_handoff_task.py

# 2. Approve â€” write handoff task
python internal/brain/scripts/generate_handoff_task.py --approve

# 3. Review handoff task
python internal/brain/scripts/review_handoff_task.py

# 4. Confirm product code is untouched
git diff src/
git diff src-tauri/
git diff backend/

# 5. Confirm output files written
cat internal/brain/outputs/handoff_task.md
cat internal/brain/outputs/handoff_task_report.md

# 6. Confirm log appended
tail -n 1 internal/brain/data/handoff_tasks.jsonl

# 7. Lint Brain scripts (no product code)
python -m py_compile internal/brain/scripts/generate_handoff_task.py
python -m py_compile internal/brain/scripts/review_handoff_task.py
```

---

## 13. Clear Stop Conditions

V6 must stop and refuse to produce an `implementation_task` handoff in ALL of the
following situations. Each stop condition includes an exact log message.

| # | Condition | Log message |
|---|---|---|
| S1 | No product patch proposals exist | `STOP: no product proposals found â€” run generate_product_patch_proposal.py first` |
| S2 | Latest proposal status is not "proposed" | `STOP: proposal status is "{status}" â€” only "proposed" proposals can be handed off` |
| S3 | Proposal risk is "high" | `STOP: proposal risk is HIGH â€” founder must narrow scope before handoff` |
| S4 | Proposal involves sensitive files | `STOP: sensitive files detected in proposal â€” requires explicit founder approval` |
| S5 | Target files list is empty | `STOP: no target files in proposal â€” return to measure â†’ propose cycle` |
| S6 | Any target file matches FORBIDDEN_PATTERNS | `STOP: forbidden file in scope: {file} â€” remove from target_files and re-propose` |
| S7 | Patch already in applied_patches.jsonl | `STOP: this patch was already applied ({date}) â€” verify current state before re-applying` |
| S8 | Target file cannot be read | `STOP: cannot read target file {file} â€” verify path and permissions` |
| S9 | proposed_changes is empty or vague | `STOP: proposed_changes too vague â€” return to measure â†’ diagnose â†’ propose cycle` |
| S10 | brain.config.json missing allow_product_code_modifications | `STOP: brain config missing safety key â€” do not proceed` |
| S11 | brain.config.json has allow_product_code_modifications: true | `STOP: safety config anomaly â€” allow_product_code_modifications must be false` |
| S12 | V6 script itself would write to a product file | `STOP: internal safety violation â€” attempted write to product file {file}` |

**On any stop condition**: Write a `planning_only` task to `outputs/handoff_task.md`
documenting the stop reason, append a `refused` record to `data/handoff_tasks.jsonl`,
and exit with code 1.

---

## Summary

V6 is the missing link between "we have an approved proposal" and "an implementation model
can act on it safely". It does not implement â€” it prepares. Its primary value is:

1. **Precision**: inlines real code context so the implementation model cannot hallucinate structure
2. **Safety**: 9 gates + 12 stop conditions prevent any vague or forbidden change from being handed off
3. **Continuity**: benchmark_scope metadata prepares V7 without implementing it
4. **Auditability**: every handoff attempt is logged with full metadata

The method is unchanged:
**measure â†’ diagnose â†’ propose â†’ implement small â†’ test â†’ compare â†’ learn**

V6 owns the "implement small" preparation step.
V7 will own the "test â†’ compare" step.

# Vocalype Brain — V11 Design Plan
# Operating Loop — Weekly Action Executor

Date: 2026-04-25
Task type: planning_only
Author: Vocalype Brain
Status: DESIGN APPROVED — implementation pending

> V10 answers: "Where is the constraint?"
> V11 answers: "How do we safely execute the action V10 selected?"
> V11 is the translation layer between diagnosis and work. It converts a weekly_action.md
> into a concrete, scoped, safe mission package that any implementation model can execute
> without exceeding the operating contract.

---

## 1. What V11 Should Do

V11 reads `outputs/weekly_action.md`, parses the current `action_type`, maps it to the
correct Brain task classification, applies safety gates, and writes a self-contained
mission package that any implementation model (Claude Code, Codex, Aider) can execute
in a single session without ambiguity.

V11 does not execute investigations or write product code. It generates the mission
package and records execution results. Execution happens in a separate Brain session
using the mission package V11 produces.

### V11 mandate

| Mandate | How |
|---|---|
| Read V10 weekly action | Parse `outputs/weekly_action.md` — extract `action_type`, `action`, evidence |
| Classify execution task | Map `action_type` → Brain task classification (see Section 6) |
| Apply pre-execution safety gates | 8 gates — all must pass before package is written |
| Write a mission package | `outputs/v11_mission_package.md` — self-contained, scoped, executable |
| Record execution result | Append to `data/v11_execution_log.jsonl` when action completes |
| Gate implementation tasks strictly | No `implementation_task` package without prior diagnosis + proposal both on file |
| Handle all 5 action types | `product_investigation`, `product_implementation`, `business_data_entry`, `distribution_data_entry`, `hold` |
| Graceful fallback on ambiguous action | Output a `data_clarification_request.md` — never guess scope |

### V11 phases

| Phase | Description | Gate to enter |
|---|---|---|
| Phase 1 — Mission package generator | Script reads weekly_action.md, runs gates, writes mission package | Now — PB-1 is the first target |
| Phase 2 — Execution recorder | Append execution results to v11_execution_log.jsonl after each mission | Phase 1 validated by founder |
| Phase 3 — Generalized router | Handle all 5 action types from V10 routing matrix | Phase 2 validated, ≥3 mission packages executed |

---

## 2. What V11 Must NOT Do

| Forbidden action | Why |
|---|---|
| Write to `src-tauri/`, `backend/`, `src/lib/auth/`, `src/lib/license/` | Permanently forbidden — operating contract Section 3 |
| Execute the investigation itself | V11 generates the package; a separate session executes it |
| Propose product fixes inside the mission package | Mission packages are task definitions only — findings go in diagnosis files |
| Skip the measurement → propose → implement order | Contract Section 2 — never compress steps |
| Write an `implementation_task` package without prior `measurement_task` output | Gate G5 — hard block |
| Write an `implementation_task` package without prior approved `proposal_task` output | Gate G6 — hard block |
| Modify `generate_unified_report.py`, V7/V8/V9 scripts, or existing data layers | V11 reads outputs; it does not modify the data pipeline |
| Produce a mission package when any safety gate fails | All 8 gates must pass — partial pass is a stop |
| Mark an action COMPLETE without verifying the output file exists | Gate G8 on completion — output file must be present before logging COMPLETE |
| Collapse multiple actions into one package | V10 emits one action per week — V11 maps it to one package per session |
| Auto-commit or auto-deploy | Founder approves all commits explicitly |
| Generate a `product_implementation` package from a single diagnosis | Requires: diagnosis file + proposal file + explicit founder sign-off in session |

---

## 3. Exact Input Files

| File | Purpose | Required? |
|---|---|---|
| `outputs/weekly_action.md` | Source of current `action_type`, `action`, evidence | Required — stop if missing |
| `outputs/unified_weekly_report.md` | Layer state context (obs counts, confidence, gaps) | Required for evidence citations |
| `data/benchmark_observations.jsonl` | V7 benchmark data — needed for product_investigation context | Required for `product_investigation` type |
| `data/business_observations.jsonl` | V8 business data — needed for business_data_entry context | Required for `business_data_entry` type |
| `data/content_observations.jsonl` | V9 content data — needed for distribution_data_entry context | Required for `distribution_data_entry` type |
| `data/v11_execution_log.jsonl` | Existing execution records — check for duplicate actions | Optional — created on first run |
| `outputs/paste_mechanism_diagnosis.md` | Prior diagnosis output — required before any product_implementation | Required for `product_implementation` type |
| `outputs/handoff_task.md` (via V6) | Prior proposal output — required before implementation package | Required for `product_implementation` type |
| `memory/operating_contract.md` | Safety rules — always read before generating any package | Required |

---

## 4. Exact Output Files

| File | When created | Description |
|---|---|---|
| `outputs/v11_mission_package.md` | Every run that passes all gates | Self-contained mission brief for the implementation model |
| `data/v11_execution_log.jsonl` | First run (created) / every subsequent run (appended) | Immutable execution record — one entry per action executed |
| `outputs/v11_gate_report.md` | Every run | Gate pass/fail summary — replaces previous report on each run |
| `outputs/data_clarification_request.md` | Only when action is ambiguous | Written instead of mission package — founder must resolve before V11 re-runs |

**V11 does not overwrite `weekly_action.md` or `unified_weekly_report.md`.** Those are V10 outputs — V11 reads them.

---

## 5. Mission Package Format

`outputs/v11_mission_package.md` is the canonical deliverable of a V11 run. It is fully
self-contained — the implementation model executing it must not need to read any other
file to understand the task.

```markdown
# V11 Mission Package

Generated: <ISO datetime>
Week: <YYYY-Www>
Action type: <action_type>
Task classification: <measurement_task | proposal_task | implementation_task | data_entry>
V10 confidence: <HIGH | MEDIUM | LOW | INSUFFICIENT DATA>

---

## Mission

<one-paragraph mission statement derived from weekly_action.md action field>

---

## Scope

**Allowed reads:**
- <file or path> — <why it is needed>

**Allowed writes:**
- <file or path> — <what it must contain>

**Forbidden writes (always):**
- src-tauri/ — permanently forbidden
- backend/ — permanently forbidden
- src/lib/auth/ — permanently forbidden
- src/lib/license/ — permanently forbidden
- Any file not listed under Allowed writes above

---

## Task Classification

**Type:** <type>
**Reason:** <why this action_type maps to this task classification>

---

## Evidence

<evidence table extracted from weekly_action.md — metric, value, threshold, status>

---

## Required Output

**File:** <output file path>
**Format:** <schema or section list>
**Constraint:** <findings only / no proposed fixes / no product code>

---

## Definition of Done

- [ ] Output file exists at the declared path
- [ ] Output file contains all required sections
- [ ] No product code was written
- [ ] No scope-forbidden files were touched
- [ ] Execution recorded in v11_execution_log.jsonl

---

## What NOT to Do

<action-type-specific prohibitions — at least 5 items>

---

## Commit Instructions

```
git add vocalype-brain/outputs/<output_file> vocalype-brain/data/v11_execution_log.jsonl
git commit -m "<commit_type>(brain): <short description>"
```
```

---

## 6. Supported Action Types

V11 supports exactly 5 action types emitted by V10. Each maps to a specific task
classification, execution template, and safety gate set.

### 6.1 `product_investigation`

**V10 meaning:** A product constraint was confirmed and needs root cause analysis.  
**V11 task classification:** `measurement_task`  
**Allowed reads:** Named `src-tauri/` files listed in the action (read-only) + benchmark data  
**Required output:** `outputs/<investigation_name>_diagnosis.md` — findings only, no fixes  
**Forbidden in output:** proposed code changes, patch instructions, benchmarked results claimed from theory  
**Commit type:** `docs(brain):`  

**Current instance (PB-1):**
- Read: `src-tauri/src/actions/paste.rs`
- Output: `outputs/paste_mechanism_diagnosis.md`
- Questions to answer (see Section 9)

**Gate:** G3 — confirm target file path exists before including it in allowed reads.  
If file does not exist at declared path, write `data_clarification_request.md` and stop.

---

### 6.2 `product_implementation`

**V10 meaning:** A confirmed bottleneck has a diagnosis and a proposal — ready to implement.  
**V11 task classification:** `implementation_task`  
**Allowed reads:** All context files from the prior diagnosis and proposal  
**Required input (both must exist before package is written):**
1. `outputs/paste_mechanism_diagnosis.md` (or equivalent diagnosis) — gate G5
2. `outputs/handoff_task.md` (approved V6 proposal) — gate G6
**Allowed writes:** Only the specific file(s) listed in the V6 handoff task  
**Commit type:** `feat(app):`  

**Hard rule:** V11 must never generate a `product_implementation` package if either gate G5 or G6 fails. No exceptions.

---

### 6.3 `business_data_entry`

**V10 meaning:** V8 layer has insufficient data — founder must record business metrics.  
**V11 task classification:** `data_entry` (not implementation — no code)  
**Allowed reads:** `data/business_observations.jsonl`, current V8 report  
**Required output:** Founder checklist in `outputs/v11_mission_package.md` only  
**No script execution during data_entry** — this is a human task, V11 writes the checklist  
**Commit type:** `data(brain):` (after founder records manually)  

The checklist must include:
- Which metrics to open (Stripe, Supabase, Vercel)
- Exact CLI command for each metric with `add_business_observation.py`
- Expected period key for this week
- Minimum observations needed before confidence upgrades

---

### 6.4 `distribution_data_entry`

**V10 meaning:** V9 layer has insufficient data — founder must record content observations.  
**V11 task classification:** `data_entry`  
**Allowed reads:** `data/content_observations.jsonl`, current V9 report  
**Required output:** Founder checklist in `outputs/v11_mission_package.md` only  
**No script execution** — human task  
**Commit type:** `data(brain):` (after founder records manually)  

The checklist must include:
- Publication recording command with all required flags
- Performance update timing (24–72h after publishing)
- Minimum posts needed before trend gate opens (≥5 per platform for ranking)

---

### 6.5 `hold`

**V10 meaning:** No actionable signal this week — all layers below minimum data threshold.  
**V11 task classification:** `planning_only`  
**Allowed writes:** `outputs/v11_mission_package.md` (hold notice only)  
**No investigation, no data entry, no implementation** — explicit hold  
**Commit type:** `docs(brain):`  

The hold package must include:
- Reason for hold (which stop condition from V10)
- What data would unlock the next action
- Earliest re-run date estimate
- No false urgency, no invented actions

---

## 7. Safety Gates

All 8 gates must pass before `v11_mission_package.md` is written. If any gate fails,
V11 writes `outputs/v11_gate_report.md` with the failure reason and stops. The mission
package is NOT written on a gate failure.

| Gate | Check | Fail action |
|---|---|---|
| G1 | `outputs/weekly_action.md` exists and contains a non-empty `action_type` | Stop — write gate report, no package |
| G2 | `action_type` is one of the 5 supported types | Stop — write `data_clarification_request.md` if unknown |
| G3 | For `product_investigation`: all named read-target files exist in the repo | Stop — write clarification request with actual vs declared paths |
| G4 | For `product_investigation`: no write targets inside `src-tauri/`, `backend/`, `src/lib/` | Stop — log scope violation, no package |
| G5 | For `product_implementation`: prior diagnosis file exists (`outputs/*_diagnosis.md`) | Hard stop — diagnosis must precede proposal |
| G6 | For `product_implementation`: prior proposal file exists (`outputs/handoff_task.md`) | Hard stop — proposal must precede implementation |
| G7 | No duplicate: same `action` string not already logged as COMPLETE in `v11_execution_log.jsonl` | Warn founder — action may already be done; require explicit re-run flag |
| G8 | `allow_product_code_modifications` in `config/brain.config.json` is NOT `true` | Hard stop — safety config anomaly (operating contract S8) |

---

## 8. Stop Conditions

In addition to the operating contract's S1–S10, V11 adds the following stop conditions:

| # | Condition | Action |
|---|---|---|
| V11-SC1 | `weekly_action.md` does not exist | Stop — V10 must be run first |
| V11-SC2 | `action_type` is `hold` and the hold reason is "all layers empty" | Write hold package; do not invent a fallback task |
| V11-SC3 | Gate G3 fails (file path in action does not exist on disk) | Write clarification request — do not substitute a nearby file |
| V11-SC4 | Gate G5 or G6 fails for `product_implementation` | Hard stop — operating contract Section 2 step sequence is mandatory |
| V11-SC5 | Mission package scope would require reading >3 product files for a single diagnosis | Stop — scope too wide; split into sub-investigations |
| V11-SC6 | The action string from weekly_action.md cannot be parsed into a concrete read target | Write clarification request — ambiguous action is not guessable |
| V11-SC7 | Execution log shows the same action attempted ≥2 times without COMPLETE status | Stop — something is blocking; founder must review before next attempt |

---

## 9. How V11 Handles `product_investigation` Safely

The `product_investigation` type is the most sensitive action type because it requires
reading `src-tauri/` files — outside the normal `vocalype-brain/` scope.

V11 applies a four-layer read scope discipline:

**Layer 1 — Named files only.** The mission package lists exact files by absolute path.
The implementation model reads those files and nothing else. It does not follow imports,
does not explore neighbouring files, does not read configuration files unless they are
explicitly listed.

**Layer 2 — Read-only enforcement.** The mission package explicitly states:
> "No writes to src-tauri/ or any product file. This is a read-only investigation."
The output file is always inside `vocalype-brain/outputs/`. The implementation model
writes zero bytes to the product codebase.

**Layer 3 — Findings-only output.** The diagnosis file schema (see below) forbids
proposed fixes. The diagnosis contains: what the code does, what the latency path is,
where the bottleneck mechanism lives, and what questions remain unanswered. It does NOT
contain: "we should change X to Y", patch instructions, or benchmarked claims that
weren't measured.

**Layer 4 — Controlled question set.** The mission package provides an exact list of
questions the investigation must answer. The implementation model answers those questions
and nothing else. This prevents scope drift during a complex code read.

### PB-1 mission package — exact question set for `paste_mechanism_diagnosis.md`

The investigation must answer these 8 questions:

1. What does `paste_execute` do? Trace the full call path from invocation to OS paste completion.
2. Where does the ~644ms go? Identify which sub-call (clipboard write, focus switch, keystroke simulation, OS API, sleep/delay) accounts for the latency.
3. Is there an explicit `sleep` or `delay` in the paste path? If yes, what is the value and why was it added?
4. What OS API is used for the paste action on Windows? (e.g., `SendInput`, `SetClipboardData`, `PostMessage`)
5. Is the paste mechanism synchronous or asynchronous? Does it wait for confirmation from the OS?
6. Are there any retry loops, fallback mechanisms, or timeout waits in the paste path?
7. What is the relationship between `paste_execute` and the idle_background_inference_loop? Could a running model inference block the paste call?
8. What would need to change to bring paste_latency_ms below 300ms? (Hypothesis only — no code change in this file.)

### `paste_mechanism_diagnosis.md` required schema

```markdown
# paste_mechanism_diagnosis.md

Date: <ISO date>
Source file(s) read: <list of files read>
Investigation type: read-only / measurement_task
Output of: V11 PB-1 mission
No product code was modified.

---

## Call Path

<trace of paste_execute from entry to OS completion — function names, line numbers>

---

## Latency Attribution

<table: sub-call | estimated share of latency | evidence>

---

## Explicit Delays Found

<list of any sleep/delay/timeout values with file:line references, or "None found">

---

## OS API Used

<which OS API handles the paste action, how it is called>

---

## Sync / Async Behavior

<is the paste call blocking? does it await OS confirmation?>

---

## Retry / Fallback Mechanisms

<any retry loops, fallback paths, or timeout waits — with file:line references>

---

## Relationship to Idle Inference Loop

<whether a running inference could block the paste path — with evidence>

---

## Hypothesis for Sub-300ms Path

<what would need to change — hypothesis only, no patch, no code change>

---

## Open Questions

<anything the read could not answer — what additional measurement is needed>

---

## Confidence in This Diagnosis

<HIGH / MEDIUM / LOW — with reason>
```

---

## 10. How V11 Handles Implementation Tasks Later

When V10 eventually selects `product_implementation` (after diagnosis + proposal are
complete), V11 routes to the existing V6 handoff loop.

**V11 does not replace V6.** V11 generates a mission package that instructs the
implementation model to execute the V6 handoff process. V6's `generate_handoff_task.py`
already applies the correct safety gates (9 gates, forbidden pattern checks, scope
validation). V11 adds only: the entry check (gates G5 + G6) and the execution log record.

**Full sequence for a future `product_implementation` action:**

```
V10 selects action_type=product_implementation
    ↓
V11 checks G5 (diagnosis exists) + G6 (handoff_task.md exists)
    ↓ both pass
V11 writes mission package: "Run V6 generate_handoff_task.py for <target>"
    ↓
Implementation model runs V6 handoff — applies all V6 gates
    ↓
V6 handoff_task.md written
    ↓
Founder approves handoff in session
    ↓
Implementation model executes approved task
    ↓
V11 execution log: action=COMPLETE, output=<patched file>, commit=<hash>
    ↓
V7 benchmark recorder: new observation after fix deployed
    ↓
V10 re-runs: confirms constraint resolved or surfaces next bottleneck
```

This sequence is the complete feedback cycle. V11 Phase 3 will codify this routing
in `generate_mission_package.py` so it runs without manual mapping.

---

## 11. How V11 Records Execution Results

After each mission package is executed (in a separate session), the execution result
is appended to `data/v11_execution_log.jsonl`.

### `v11_execution_log.jsonl` record schema

```json
{
  "execution_id": "v11-YYYYMMDD-NNN",
  "date_recorded": "ISO datetime",
  "period": "YYYY-Www",
  "action_type": "product_investigation | product_implementation | business_data_entry | distribution_data_entry | hold",
  "task_classification": "measurement_task | proposal_task | implementation_task | data_entry | planning_only",
  "action_summary": "short description of what was done",
  "source_action": "full action string from weekly_action.md",
  "output_file": "path to primary output file",
  "status": "COMPLETE | IN_PROGRESS | BLOCKED | SKIPPED",
  "blocked_reason": "if BLOCKED — why",
  "commit_hash": "git short hash or null",
  "v10_confidence": "HIGH | MEDIUM | LOW | INSUFFICIENT DATA",
  "gates_passed": ["G1", "G2", ...],
  "notes": "optional founder notes"
}
```

`execution_id` format: `v11-YYYYMMDD-NNN` where NNN = zero-padded count of records in the file + 1.

**Immutability rule:** Records are append-only. Never modify a prior record. If an action
needs to be re-run, append a new record with the same `source_action` and a new `execution_id`.

---

## 12. Future Implementation Steps

| Step | Description | Gate |
|---|---|---|
| Phase 1 | `generate_mission_package.py` — reads weekly_action.md, runs 8 gates, writes v11_mission_package.md + v11_gate_report.md | Now — PB-1 is the target |
| Phase 1 | Manual execution of PB-1 mission package — read paste.rs, write paste_mechanism_diagnosis.md | After Phase 1 script is committed |
| Phase 1 | Record PB-1 execution result in v11_execution_log.jsonl | After diagnosis is written |
| Phase 2 | `record_execution_result.py` — CLI recorder for v11_execution_log.jsonl | After Phase 1 validated |
| Phase 2 | Support for `business_data_entry` checklist generation | After Phase 1 validated |
| Phase 2 | Support for `distribution_data_entry` checklist generation | After Phase 1 validated |
| Phase 3 | `hold` action type handling | After Phase 2 validated |
| Phase 3 | Generalized router for all 5 action types | After Phase 2 validated and ≥3 packages executed |
| Phase 3 | `product_implementation` routing to V6 handoff | After ≥1 diagnosis + ≥1 approved proposal on file |

---

## 13. Validation Commands

After implementing `generate_mission_package.py`, run these in order:

```bash
# 1. Syntax check
python -m py_compile vocalype-brain/scripts/generate_mission_package.py

# 2. Dry-run (gates only — no file writes)
python vocalype-brain/scripts/generate_mission_package.py --dry-run

# 3. Full run — generates mission package
python vocalype-brain/scripts/generate_mission_package.py

# 4. Verify outputs exist
ls vocalype-brain/outputs/v11_mission_package.md
ls vocalype-brain/outputs/v11_gate_report.md

# 5. Verify no product files written
git -C <repo_root> diff --name-only

# 6. Verify v11_execution_log.jsonl format
python -c "import json; [json.loads(l) for l in open('vocalype-brain/data/v11_execution_log.jsonl')]"

# 7. Confirm git status — only vocalype-brain/ files
git status --short
```

Validation passes when: all 7 commands return success, no product file appears in git diff,
and `v11_mission_package.md` contains all required sections.

---

## 14. How V11 Prepares V12 Continuous Improvement Loop

V11 closes the Brain's weekly execution cycle. Once V11 Phase 3 is live and ≥4 complete
execution records exist in `v11_execution_log.jsonl`, V12 becomes possible.

**V12 mandate (future):** Continuous Improvement Loop. V12 reads V11 execution logs +
V7/V8/V9 data and answers: "Is the Brain's weekly cycle improving the north star metric?"

V11 prepares V12 by ensuring:

1. **Execution log is structured and complete.** Each record includes `action_type`, `output_file`, `commit_hash`, `status`. V12 can join this against V7 benchmark changes to correlate actions with metric movement.

2. **Bottleneck resolution is traceable.** When a `product_investigation` leads to a `product_implementation` that produces a new benchmark observation showing paste_latency_ms < 300ms, V12 can close the loop: action → fix → metric improvement.

3. **Data entry compliance is tracked.** V11 records when `business_data_entry` and `distribution_data_entry` actions are completed. V12 can flag weeks where the founder missed data entry and the confidence stayed LOW.

4. **Hold weeks are explicit.** V11 `hold` records give V12 a clean signal that those weeks had no actionable signal — not silence, but an explicit hold. V12 can measure hold rate without false attribution.

**V12 entry gate:** ≥4 COMPLETE records in `v11_execution_log.jsonl` spanning at least two different action types.

---

## 15. Exact Next Prompt for V11 Phase 1 Implementation

Use the following prompt verbatim to begin V11 Phase 1 implementation:

---

```
Read and follow:
- vocalype-brain/memory/operating_contract.md
- vocalype-brain/memory/current_state.md
- vocalype-brain/outputs/v11_design_plan.md
- vocalype-brain/outputs/weekly_action.md
- vocalype-brain/outputs/unified_weekly_report.md

Mission:
Implement V11 Phase 1 — Mission Package Generator.

Task type:
implementation_task (Brain-only — no product code).

Goal:
Create generate_mission_package.py that:
1. Reads outputs/weekly_action.md
2. Parses action_type, action, evidence
3. Runs 8 safety gates (G1–G8 from v11_design_plan.md Section 7)
4. Writes outputs/v11_mission_package.md using the format from Section 5
5. Writes outputs/v11_gate_report.md with pass/fail for each gate
6. On gate failure: writes gate report, does NOT write mission package
7. Creates data/v11_execution_log.jsonl on first run (empty array or header comment)
8. Supports --dry-run flag: runs gates only, no file writes

The current action is action_type=product_investigation targeting paste.rs.
The PB-1 mission package must include:
- Allowed reads: src-tauri/src/actions/paste.rs (read-only)
- Required output: outputs/paste_mechanism_diagnosis.md
- All 8 questions from v11_design_plan.md Section 9
- The paste_mechanism_diagnosis.md schema from Section 9
- The "What NOT to do" prohibitions from Section 2

Use brain.py helpers: read_jsonl, write_text, BRAIN_ROOT.
Do not use write_jsonl — append to v11_execution_log.jsonl manually (append mode).

Validation:
1. python -m py_compile vocalype-brain/scripts/generate_mission_package.py
2. python vocalype-brain/scripts/generate_mission_package.py --dry-run
3. python vocalype-brain/scripts/generate_mission_package.py
4. Verify outputs/v11_mission_package.md exists and contains all required sections
5. Verify outputs/v11_gate_report.md exists
6. git status --short — confirm only vocalype-brain/ files

If validation passes and only vocalype-brain files changed, commit with:
feat(brain): add V11 mission package generator

Rules:
- Do not modify product code.
- Do not read paste.rs yet — that is the mission package's target, not this script.
- Do not create paste_mechanism_diagnosis.md in this task.
- Only write inside vocalype-brain/.
- Do not use --no-verify.

After commit, run:
git status --short
git log --oneline -3

Report:
1. Files created
2. Gate results for current PB-1 action
3. Mission package sections written
4. Commit hash
5. Product code touched yes/no
```

---

## V11 Design Summary

| Item | Value |
|---|---|
| V11 role | Operating Loop — converts V10 weekly action into safe mission package |
| Phase 1 target | `generate_mission_package.py` → `v11_mission_package.md` |
| First mission | PB-1 — `paste_mechanism_diagnosis.md` (product_investigation, measurement_task) |
| Gate count | 8 gates — all must pass before package is written |
| Supported action types | 5: product_investigation, product_implementation, business_data_entry, distribution_data_entry, hold |
| Execution log | `data/v11_execution_log.jsonl` — append-only, one record per completed action |
| V12 entry gate | ≥4 COMPLETE records across ≥2 action types |
| Product code written | None — V11 is Brain-only |
| Blocked on | Nothing — ready to implement Phase 1 immediately |

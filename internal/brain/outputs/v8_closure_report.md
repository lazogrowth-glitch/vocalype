# Vocalype Brain â€” V8 Closure Report

Date: 2026-04-25
Task type: planning_only
Author: Vocalype Brain
Status: V8 CLOSED as infrastructure phase. V9 design approved to begin.

> This document closes V8 as a measurement infrastructure phase and frames V9.
> No product code was modified during V8. No growth was automated.

---

## 1. V8 Completion Verdict

**V8 is closed. Reason: the measurement infrastructure is complete and working.**

V8 was designed to give the Brain business eyes. It delivered on that mandate.

| Deliverable | Status | Notes |
|---|---|---|
| `v8_design_plan.md` â€” 15-section business metrics architecture | âœ… Done | Planning only |
| `v8_missing_metrics_protocol.md` â€” zero/unknown/not_available/not_applicable | âœ… Done | Honest early-stage recording defined |
| `add_business_observation.py` â€” CLI recorder with status support | âœ… Done | Validated, committed |
| `review_business_metrics.py` â€” report generator with status-aware logic | âœ… Done | Validated, committed |
| `weekly_business_snapshot.py` â€” founder-facing weekly checklist | âœ… Done | Validated, committed |
| `business_report.md` â€” auto-generated coverage and funnel report | âœ… Done | Regenerates on every review run |
| `weekly_business_snapshot.md` â€” founder checklist with do-not-overreact section | âœ… Done | Excludes validation samples correctly |
| 4 weeks of real business baseline | âŒ Not collected | No real observations recorded yet |
| `lock_business_baseline.py` â€” Phase 2 script | âŒ Not built | Requires 4 weeks of real data first |
| `fetch_business_metrics.py` â€” automated API pulls | âŒ Not built | Phase 2 â€” manual baseline first |
| `correlate_metrics.py` â€” V7 Ã— V8 correlation | âŒ Not built | Phase 2 |

**Why closing without a real baseline:**

V8 was always a two-part phase:
1. Build the measurement infrastructure (done)
2. Feed it real weekly data over time (ongoing â€” not a Brain task, a founder task)

The Brain's job in V8 is complete. The infrastructure works, the protocol is defined,
and the tools handle all early-stage edge cases (zero, unknown, not_available,
not_applicable) without inventing data.

The remaining V8 work â€” recording real business metrics each Monday â€” is a recurring
**founder action**, not a Brain implementation task. The tools to do it exist.

---

## 2. What V8 Can Do Now

| Capability | How |
|---|---|
| Record any business metric with honest status | `add_business_observation.py --metric X --value Y --status Z` |
| Record confirmed zeros without faking traction | `--status zero --value 0` |
| Record unchecked weeks without lying | `--status unknown` (no numeric value stored) |
| Record missing data sources without blocking | `--status not_available` |
| Record premature metrics without false warnings | `--status not_applicable` |
| Generate weekly business report | `review_business_metrics.py` â†’ `business_report.md` |
| Generate founder action checklist | `weekly_business_snapshot.py` â†’ `weekly_business_snapshot.md` |
| Flag anomalies (North Star = 0, churn > conversions, MRR drop) | Built into review script |
| Surface data-source setup backlog | `not_available` metrics shown in backlog section |
| Suppress irrelevant warnings for premature metrics | `not_applicable` excluded from missing-metric warnings |
| Exclude validation samples from real snapshots | `source=manual_validation` filtered in snapshot generator |

---

## 3. What V8 Cannot Do Yet

| Capability | Why not yet | When |
|---|---|---|
| Show 4-week baseline trends | No real observations yet | After 4 weeks of founder data entry |
| Lock business baseline | `lock_business_baseline.py` not built + no real data | V8 Phase 2 |
| Correlate V7 product metrics to business outcomes | `correlate_metrics.py` not built | V8 Phase 2 |
| Pull Stripe / Supabase / Vercel automatically | `fetch_business_metrics.py` not built | V8 Phase 2 (requires founder API approval) |
| Identify which funnel stage is the bottleneck | No real funnel data | After 4 weeks |
| Confirm whether V7 latency fix improved retention | No retention baseline | After patch + before/after comparison |
| Justify V9 growth investment | Funnel not yet measured | After V8 data confirms activation rate |

---

## 4. How V8 Prevents Fake Traction

V8 was specifically designed for the zero-traction early stage where many numbers are
zero, unknown, or inapplicable. Three mechanisms prevent fake traction:

### 4a â€” Status-required recording
Every observation has an explicit status. There is no default of "zero" for unchecked
metrics â€” the founder must choose `--status unknown` if they didn't check, which
does not count toward the baseline. This prevents "I didn't check, so it must be zero."

### 4b â€” Validation sample exclusion
The snapshot generator explicitly filters out all records with `source=manual_validation`.
Validation samples used to test the scripts never appear in the weekly snapshot or
influence the checklist. The script warns loudly when only validation samples exist.

### 4c â€” Baseline counting only counts checked data
`review_business_metrics.py` tracks "checked weeks" (status=measured or zero) separately
from total observations. A metric checked zero times in week 1 and `unknown` in weeks 2â€“3
shows 1/4 checked weeks â€” not 3/4. The 4-week baseline clock only ticks on real checks.

### 4d â€” Do-not-overreact section
The weekly snapshot includes an explicit "Do Not Overreact Yet" section that surfaces
early-stage reality-check messages: zero downloads â‰  product failure, $0 MRR â‰  unsustainable,
one data point â‰  a trend. This prevents premature strategy pivots based on a single week.

### 4e â€” No invented funnel metrics
V8 does not compute derived metrics (trial-to-paid rate, activation-to-dictation drop,
d7 retention) until both inputs have real observations. Division by zero or by a
validation sample is never surfaced as a real business ratio.

---

## 5. Current Business Data Reality

**As of 2026-04-25:**

| Dimension | Status |
|---|---|
| Real business observations | **0** (all 6 records are validation samples) |
| Checked priority metrics | 0 / 13 |
| Weeks of real data | 0 / 4 needed for baseline |
| North Star (`first_successful_dictations`) | Not checked â€” unknown |
| MRR | Not checked â€” unknown |
| Downloads | Not checked â€” unknown |
| Activation funnel | Not checked â€” unknown |
| Content performance | Not checked â€” unknown |

**This is the honest state.** The measurement infrastructure exists.
The founder has not yet run the Monday 10-minute dashboard session to populate it.

The correct next action is not a Brain task â€” it is the founder opening Stripe,
Supabase, and Vercel and recording what is actually there, using the tools that now exist.

The Brain will process whatever reality the founder records. It will not invent a baseline.

---

## 6. Product-to-Business Link from V7

V7 established the product baseline. V8 established the business measurement infrastructure.
The link between them will become meaningful once real business observations exist.

**Current V7 â†’ V8 connection status:**

| V7 Finding | Business Impact Question | V8 Status |
|---|---|---|
| `paste_execute` = 645ms (62% of p50 latency) | Does faster paste increase `first_successful_dictations`? | No baseline yet â€” cannot answer |
| Idle background inference loop (+110 MB / 15 min) | Does fixing RAM growth reduce `churned_users`? | No baseline yet â€” cannot answer |
| `chunk_cleanup` fires 24% of runs (tail latency p95 = 2405ms) | Does eliminating tail latency reduce early churn? | No baseline yet â€” cannot answer |
| `stt_inference_time_ms` p50 = 230ms (not the bottleneck) | Inference speed not the lever â€” confirmed | Consistent with no conversion data |

**When this link becomes active:**
Once the founder records real `first_successful_dictations` and `mrr` for 4+ weeks,
and the V7 paste_execute patch is applied, `correlate_metrics.py` (V8 Phase 2) will
join the product delta to the business delta and report:
"Latency dropped X% in week N. first_successful_dictations changed Y% in weeks N+1/N+2."

---

## 7. V9 Readiness Verdict

**V9 is NOT ready. V9 design may begin in planning_only mode.**

| V9 gate (from v8_design_plan.md Section 14) | Status | Decision |
|---|---|---|
| 4 weeks of V8 business baseline | âŒ 0 weeks | Not waived â€” real data required before growth investment |
| â‰¥1 confirmed product win (product + business delta positive) | âŒ None | Not waived â€” cannot justify growth without product proof |
| Activation funnel assessed (`activation_success_rate` known) | âŒ Unknown | Not waived â€” critical gate: is growth blocked at activation? |

**Why V9 design can still begin now:**

The design of V9 does not require real data â€” it requires knowing what V9 should measure
and what constraints it must respect. Planning V9 now (as a `planning_only` task)
ensures the design is ready to execute when V8 data arrives.

**V9 cannot run until** the founder has used the V8 tools for â‰¥4 weeks and confirmed
that `first_successful_dictations > 0` and the activation funnel is understood.

---

## 8. What V9 Should Be

**V9 = Growth / Distribution Loop â€” Manual Experiment Tracker**

V9 does not automate growth. It makes growth experiments **measurable and comparable**.

V9 tracks:
- Distribution experiments (content formats, channels, posting cadences)
- Onboarding improvements (landing page copy, CTA, download flow)
- Activation improvements (what reduces time-to-first-dictation?)
- The conversion funnel at each stage: visitor â†’ download â†’ signup â†’ activate â†’ dictate â†’ pay

V9 structure mirrors V7 and V8:

| Phase | Description |
|---|---|
| V9 Phase 1 â€” Manual experiment log | Founder records each experiment (what changed, when, what was measured before/after) |
| V9 Phase 2 â€” Experiment comparison | Brain compares V8 business metrics before/after each experiment |
| V9 Phase 3 â€” Distribution automation | Only automates what Phase 2 proves works |

**V9 inputs:**
- V7 product metrics (latency, RAM, WER) â€” to confirm the product is worth scaling
- V8 business metrics (funnel, MRR, activation) â€” to confirm where the bottleneck is
- Founder experiment log â€” what was tried and when

**V9 outputs:**
- `experiment_log.jsonl` â€” one record per experiment
- `experiment_report.md` â€” before/after comparison per experiment
- `funnel_report.md` â€” where users drop off (download â†’ activate â†’ dictate â†’ pay)
- `distribution_backlog.md` â€” ranked experiment candidates by expected leverage

**V9 North Star:** `first_successful_dictations_per_week` Ã· `downloads_per_week`
= activation rate from download to first dictation. This is the metric V9 tries to move.

---

## 9. What V9 Must NOT Do

| Forbidden action | Why |
|---|---|
| Automate content posting to TikTok, Twitter, LinkedIn | V9 Phase 1 and 2 are manual â€” automation is Phase 3 only, after proof |
| Run paid advertising | No conversion rate baseline â€” cannot compute CAC or LTV |
| Recommend product changes | V7 and V8 handle product â€” V9 handles distribution |
| Declare a distribution experiment a "win" without before/after data | Same discipline as V7/V8: measure â†’ compare |
| Expand scope beyond funnel and distribution experiments | V9 stays in its lane |
| Generate content on behalf of the founder | V9 tracks experiments; the founder creates content |
| Use V8 business data if fewer than 4 real weeks are recorded | Baseline must be real before any growth experiment is compared to it |
| Modify backend, auth, license, or product code | Permanently forbidden scope |
| Claim virality, product-market fit, or growth trajectory from 1â€“2 data points | Anti-hype â€” same discipline as V8's do-not-overreact section |

---

## 10. Exact Next Prompt for V9 Design

Copy and send this prompt to begin V9 planning:

```
Read and follow:
- internal/brain/memory/operating_contract.md
- internal/brain/memory/current_state.md
- internal/brain/outputs/v8_closure_report.md
- internal/brain/outputs/v8_design_plan.md

Mission:
Design V9 â€” Growth / Distribution Loop.

Task type:
planning_only.
No product code changes.

Goal:
Write the V9 design plan.

Create:
- internal/brain/outputs/v9_design_plan.md

The plan must include:
1. V9 objectives (what it measures that V8 does not)
2. Experiment log format (one record per experiment)
3. Funnel tracking (visitor â†’ download â†’ activate â†’ dictate â†’ pay)
4. Before/after comparison protocol for each distribution experiment
5. Content experiment tracking (format, channel, hook, views, attributed downloads)
6. Onboarding experiment tracking (landing page, CTA, download flow)
7. Activation experiment tracking (what reduces time-to-first-dictation?)
8. Safety gates (when is it safe to declare an experiment a win?)
9. Stop conditions (when to pause growth work and fix product instead)
10. What V9 must NOT do (automate, run ads, invent traction)
11. Brain scripts needed (add_experiment, review_experiments, funnel_report)
12. V9 success criteria
13. What V10 should be (one paragraph only)
14. Exact next prompt for V9 Phase 1 implementation

Context:
V8 produces: first_successful_dictations, downloads, mrr, activation_attempts
V7 produced: paste_execute 645ms (bottleneck), idle inference loop
North Star: first_successful_dictations_per_week / downloads_per_week (activation rate)

Rules:
- Do not create automation.
- Do not recommend paid ads.
- Do not modify product code.
- Do not implement scripts yet.
- Only write inside internal/brain/.
- If a metric requires V8 data not yet collected, note it as a dependency.
```

---

## Summary Card

```
V8 CLOSURE (2026-04-25)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Verdict:   CLOSED â€” infrastructure complete, real data entry pending
Phase 1:   Complete (3 scripts built, status protocol defined,
           validation samples correctly excluded)
Phase 2:   Not started (lock_business_baseline, correlate_metrics
           require 4 weeks of real data first)
Real data: 0 observations (founder has not run Monday session yet)

What V8 built:
  add_business_observation.py   â€” status-aware recorder
  review_business_metrics.py    â€” coverage + funnel + anomaly report
  weekly_business_snapshot.py   â€” founder checklist (anti-hype)
  v8_missing_metrics_protocol.md â€” zero/unknown/not_available/not_applicable

Anti-traction mechanisms:
  - validation samples excluded from snapshot
  - unknown does NOT count toward baseline
  - do-not-overreact section in every snapshot
  - baseline clock ticks only on checked data

V9 gates (NOT yet met):
  - â‰¥4 weeks of real V8 data
  - â‰¥1 confirmed product win
  - activation funnel assessed

V9 design: APPROVED to begin (planning_only)
V9 entry:  Use exact prompt in Section 10 above

Product code touched during V8: ZERO
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

---

*This report is planning_only. No product code was modified or proposed for modification.*
*All source data: `internal/brain/data/business_observations.jsonl` (validation samples only at closure).*

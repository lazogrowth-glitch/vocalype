# Vocalype Brain â€” V10 Design Plan
# Unified Decision Engine â€” Cross-Layer Weekly Report

Date: 2026-04-25
Task type: planning_only
Author: Vocalype Brain
Status: DESIGN APPROVED â€” implementation pending

> V10 gives the Brain a unified view.
> V7 = product eyes. V8 = business eyes. V9 = distribution eyes.
> V10 = one report that joins all three and answers: "Where is the bottleneck this week?"
> No autonomous action. No product changes. No marketing strategy from empty data.

---

## 1. What V10 Should Do

V10 reads the three existing data layers, joins them by the shared period key
(ISO week `YYYY-Www`), and produces a single founder-facing weekly report that
answers one question:

> **"Is the current constraint in the product (V7), the funnel (V8), or distribution (V9)?"**

V10 does not guess. When data is insufficient, it says so explicitly and outputs only
the founder data-entry checklist. When data exists, it applies a deterministic
rule-based diagnosis â€” no machine learning, no inference, no speculation.

### V10 mandate

| Mandate | How |
|---|---|
| Join V7 + V8 + V9 by ISO week period key | `generate_unified_report.py` |
| Assess data sufficiency for each layer | Checks real observation count and week coverage |
| Run bottleneck diagnosis when â‰¥2 layers have â‰¥1 week of real data | Rule-based decision matrix |
| Output one ranked action per week with evidence citations | `weekly_action.md` |
| Output the full cross-layer join table for founder review | `unified_weekly_report.md` |
| Surface data gaps clearly so the founder knows what to record | Gap section in both reports |
| Exclude validation samples from all layers before joining | Same filter as V7/V8/V9 |
| Refuse to diagnose from a single data point per layer | Gate G5 |

### V10 phases

| Phase | Description | Gate to enter |
|---|---|---|
| Phase 1 â€” Cross-layer join + gap report | Joins available data, shows what can and cannot be said | Now â€” no gate on implementation |
| Phase 2 â€” Bottleneck diagnosis | Runs decision matrix, flags the weakest layer | â‰¥2 layers with â‰¥4 weeks of real data |
| Phase 3 â€” Weekly action generation | Outputs one ranked action with evidence | Phase 2 validated by founder |
| Phase 4 â€” Trend tracking | Tracks bottleneck layer over time, surfaces shifts | â‰¥8 weeks of joint data |

**The implementation target for V10 Phase 1 is a script that runs honestly on empty or
partial data â€” surfacing what it knows, what it cannot say yet, and what the founder
needs to record to make it useful.**

---

## 2. What V10 Must NOT Do

| Forbidden action | Why |
|---|---|
| Make decisions autonomously | V10 outputs recommendations â€” the founder decides |
| Run bottleneck diagnosis from a single week | One week is not a pattern (gate G5) |
| Recommend paid advertising | No CAC/LTV baseline â€” cannot justify spend |
| Automate any product, distribution, or business action | V10 is read-only across all three layers |
| Recommend product changes | V7 handles product investigation â€” V10 only surfaces known V7 signals |
| Declare a bottleneck layer without evidence from that layer | Missing data = "cannot assess" â€” not a guess |
| Replace the V7, V8, or V9 layer-specific reports | V10 supplements; it does not replace |
| Claim product-market fit, virality, or growth trajectory | Anti-hype â€” same discipline as V8 and V9 |
| Compute activation_rate when either input has zero real observations | Division by zero = silent data invention |
| Produce a weekly action when all three layers have only validation samples | No real data = no recommendation |
| Modify backend, auth, license, or product code | Permanently forbidden per operating contract |
| Join validation samples with real observations | Each layer must be filtered before the join |
| Surface V7 benchmark numbers as current if they are >4 weeks old | Old benchmarks may not reflect current product state |

---

## 3. Exact Input Files

| File | Layer | Key fields used | Notes |
|---|---|---|---|
| `data/benchmark_observations.jsonl` | V7 â€” Product | `date`, `metric`, `value`, `unit`, `scenario` | No `period` field â€” ISO week derived from `date` |
| `data/business_observations.jsonl` | V8 â€” Business | `period`, `metric`, `value`, `status`, `source` | `period` = ISO week `YYYY-Www` directly |
| `data/content_observations.jsonl` | V9 â€” Distribution | `period`, `platform`, `content_type`, `views`, `record_type`, `source` | `period` = ISO week `YYYY-Www` directly |

### 3a â€” V7 period derivation

V7 benchmark records use a `date` field (`YYYY-MM-DDTHH:MM:SS` ISO datetime).
V10 derives the ISO week from this field:

```python
from datetime import datetime
dt = datetime.fromisoformat(record["date"])
year, week, _ = dt.isocalendar()
period = f"{year}-W{week:02d}"
```

This means V7 data is grouped by the week in which the benchmark was recorded,
not the week the feature was deployed. The join is approximate but consistent.

### 3b â€” Shared period key contract

All three layers use ISO week `YYYY-Www` as the join key.
Example: `2026-W18` = the week of 2026-04-27.

The join is a left outer join on period: every week with any data from any layer
appears in the unified table. Weeks with no data from a layer show `â€”` for that
layer's columns.

### 3c â€” Validation sample filter (applied before join)

Before any join, each layer's observations are filtered:
- V8: exclude `source == "manual_validation"`
- V9: exclude `source == "manual_validation"`
- V7: no validation source concept â€” all records are treated as real

---

## 4. Exact Output Files

| File | Generated by | Contents |
|---|---|---|
| `outputs/unified_weekly_report.md` | `generate_unified_report.py` | Cross-layer join table, layer status, data gaps, bottleneck diagnosis |
| `outputs/weekly_action.md` | `generate_unified_report.py` | Single ranked action with evidence citations and confidence level |

Both files are overwritten on every run. Neither is append-only.
The script is safe to run repeatedly â€” each run reflects the latest data state.

---

## 5. Decision Report Format

### 5a â€” `unified_weekly_report.md` sections

```
# Vocalype Brain â€” Unified Weekly Report

Generated: <timestamp>
Report week: <latest week with any real data, or current week>
Data state: <FULL | PARTIAL | EMPTY>

---

## Layer Status

| Layer | Real observations | Weeks of data | Key signal | Sufficiency |
|---|---|---|---|---|
| V7 Product | N | W weeks | paste_execute=645ms | âœ…/âš ï¸/âŒ |
| V8 Business | N | W weeks | downloads=?, MRR=? | âœ…/âš ï¸/âŒ |
| V9 Distribution | N | W weeks | posts=?, views=? | âœ…/âš ï¸/âŒ |

---

## Cross-Layer Join Table

| Period | V7: paste_ms | V7: ram_mb | V8: downloads | V8: activations | V8: rate | V9: posts | V9: views | V9: website_clicks |
|---|...|

---

## Bottleneck Diagnosis

<Only shown if â‰¥2 layers have â‰¥4 weeks of real data>
OR
> âš ï¸ Insufficient data for diagnosis. [N] layer(s) have fewer than 4 weeks of real observations.
> Diagnosis requires: [list what each layer still needs]

---

## Weekly Action

<See weekly_action.md for the current week's recommended action>

---

## Data Gaps â€” What to Record This Week

[Per-layer gap list]

---

## Do Not Overreact Yet

[Anti-hype messages based on current data state]
```

### 5b â€” `weekly_action.md` format

```
# Vocalype Brain â€” Weekly Action

Generated: <timestamp>
Week: <YYYY-Www>
Confidence: <HIGH | MEDIUM | LOW | INSUFFICIENT DATA>

---

## This Week's Action

**Layer:** <Product | Funnel | Distribution | Data Entry>
**Action:** <One specific thing to do>
**Why:** <Evidence from the data â€” cite specific metrics>
**Expected signal:** <What should change if this action works>
**How to measure:** <Which script to run to verify>

---

## Evidence

| Source | Signal | Value | Week |
|---|---|---|---|
| V7 benchmark | paste_execute | 645ms | 2026-W14 |
| V8 business | downloads | 0 | 2026-W17 |
| V9 content | posts | 0 | 2026-W17 |

---

## Confidence Explanation

<Why this confidence level was assigned>
<What additional data would increase confidence>
```

---

## 6. Proposed Decision Scoring Model

V10 Phase 1 uses a rule-based decision matrix â€” no machine learning, no scoring formula.
The three possible bottleneck states are assessed in priority order.

### 6a â€” Bottleneck priority order

The operating contract defines product improvement as highest priority.
V10 respects this by checking layers in order:

```
1. Is the product constraint unresolved?  â†’ if YES â†’ bottleneck = Product
2. Is the funnel constraint unresolved?   â†’ if YES â†’ bottleneck = Funnel
3. Is the distribution constraint present? â†’ if YES â†’ bottleneck = Distribution
4. Is data insufficient to assess?        â†’ if YES â†’ output = Data Entry
```

### 6b â€” Product constraint signal (V7)

The product constraint is flagged when:

| Condition | Signal source | Threshold |
|---|---|---|
| `paste_execute` > 300ms | V7 benchmark_observations | Confirmed from existing data (645ms) |
| `memory_growth_mb` > 50MB | V7 benchmark_observations | Confirmed from existing data (110MB) |
| No product benchmark observations in last 4 weeks | V7 data age | Stale data = unknown state |

If ANY product constraint condition is true: `product_constrained = True`

### 6c â€” Funnel constraint signal (V8)

The funnel constraint is assessed when V8 has â‰¥1 real week of data:

| Condition | Signal source | Threshold |
|---|---|---|
| `activation_rate` < 30% | V8: first_dictations / downloads | Below acceptable for product-led growth |
| `downloads` > 0 AND `first_successful_dictations` = 0 | V8 business | People download but don't activate |
| `account_signups` > 0 AND `first_successful_dictations` = 0 | V8 business | People sign up but don't dictate |
| No V8 real data | V8 | Cannot assess |

If funnel constraint conditions are true and product is NOT constrained: `funnel_constrained = True`

### 6d â€” Distribution constraint signal (V9)

The distribution constraint is assessed when V9 has â‰¥1 real week of data:

| Condition | Signal source | Threshold |
|---|---|---|
| 0 content posts in last 2 weeks | V9 content | No distribution effort |
| Posting but `website_clicks` = 0 | V9 content | Content not driving traffic |
| `downloads` flat despite content posting | V9 + V8 join | Traffic not converting to downloads |

If distribution constraint conditions are true and product AND funnel are NOT constrained: `distribution_constrained = True`

### 6e â€” Insufficient data fallback

If any required layer has 0 real observations: skip that layer's constraint check entirely.
Output the data entry action for the layer with the least data.

Priority order for data entry action:
1. V8 business (most actionable â€” Monday session takes 10 minutes)
2. V9 content (requires posting first)
3. V7 benchmark (requires manual testing)

### 6f â€” Decision matrix

| Product constrained | Funnel constrained | Distribution constrained | Weekly action |
|---|---|---|---|
| âœ… Yes | Any | Any | Fix product â€” paste_execute or RAM issue unresolved |
| âŒ No | âœ… Yes | Any | Fix funnel â€” improve activation flow or onboarding |
| âŒ No | âŒ No | âœ… Yes | Scale distribution â€” post more, test new platforms |
| âŒ No | âŒ No | âŒ No | ðŸŽ‰ All layers healthy â€” maintain and monitor |
| Insufficient data | Insufficient data | Insufficient data | Record data â€” no recommendation possible yet |

---

## 7. How to Handle Missing / Insufficient Data

V10 degrades gracefully at every data sufficiency level.

### 7a â€” All three layers empty (current state)

Output:
- Layer status table: all three rows show "0 observations â€” no real data"
- Cross-layer join table: empty
- Bottleneck diagnosis: "âš ï¸ No data available â€” cannot diagnose"
- Weekly action: "Record data â€” complete Monday V8 session and record first V9 post"
- Data gaps: full checklist for all three layers

### 7b â€” One layer has data

Output:
- Layer status: show the layer with data, mark others as empty
- Join table: single-layer rows (other columns = â€”)
- Bottleneck diagnosis: "âš ï¸ Only 1 of 3 layers has data â€” cross-layer diagnosis not yet possible"
- Weekly action: based on the single layer's signal

### 7c â€” Two layers have data

Output:
- Cross-layer join table: two populated columns
- Partial bottleneck diagnosis: compare the two available layers
- Weekly action: based on the two available layers, noting the missing layer's impact
- Note: "V[missing] data would strengthen this recommendation"

### 7d â€” All three layers have data but fewer than 4 weeks each

Output:
- Full cross-layer join table
- Preliminary diagnosis: flagged as LOW confidence
- Weekly action: LOW confidence, note weeks remaining to full baseline
- Anti-hype: "Diagnosis from N weeks â€” pattern not yet confirmed"

### 7e â€” All three layers have â‰¥4 weeks of real data

Full diagnosis. MEDIUM or HIGH confidence based on signal consistency.

### 7f â€” Old V7 data (> 4 weeks since last benchmark)

Treat V7 signals as STALE:
- Show the most recent benchmark values with age annotation
- Diagnosis confidence for product layer = STALE
- Weekly action note: "V7 data is X weeks old â€” run benchmarks to verify current product state"

---

## 8. How to Avoid Fake Certainty

V10 applies the same anti-hype discipline as V7, V8, and V9.

### 8a â€” Confidence levels are explicit

Every weekly action has an explicit confidence level:
- `HIGH`: â‰¥4 weeks of consistent signal from â‰¥2 layers pointing the same direction
- `MEDIUM`: â‰¥2 weeks of signal from â‰¥2 layers, or 1 strong V7 finding
- `LOW`: 1â€“3 weeks of data, or only 1 layer with data
- `INSUFFICIENT DATA`: any layer with 0 real observations

### 8b â€” Single-week signals trigger LOW confidence

A bottleneck identified from exactly 1 week of data is always LOW confidence.
The report states: "This is a 1-week signal â€” confirm over 2+ consecutive weeks."

### 8c â€” Conflicting signals surface explicitly

If V7 says product is constrained but V8 shows improving activation:
"Conflicting signals: V7 product constraint flagged but V8 activation improving.
Possible explanation: product fix may already be in effect. Run new V7 benchmarks
to confirm current paste_execute value."

### 8d â€” No derived metrics from zero denominators

`activation_rate = first_dictations / downloads` is only computed when both inputs
are real measured values (V8 status = `measured`). If downloads = 0 or = unknown,
activation_rate is not computed. The report shows "â€”" not "0%" or "undefined."

### 8e â€” No cross-layer attribution without explicit V8-V9 join

V10 does not claim "content post X drove Y downloads" without a validated V8-V9
correlation. That requires V9 Phase 2 (`correlate_content_business.py`) to run
first. V10 only surfaces the correlation placeholder: "V9 Phase 2 join needed."

### 8f â€” Validation sample exclusion propagated to join

Before joining, V10 applies each layer's validation filter independently.
The join never mixes real observations with validation samples.
If a layer has ONLY validation samples, it is treated as empty for join purposes.

---

## 9. Weekly Founder Decision Checklist

Generated every run as part of `unified_weekly_report.md`.

```
## Founder Decision Checklist

[ ] Read the weekly action in weekly_action.md
[ ] Check whether the recommended layer matches your intuition
[ ] If you disagree with the diagnosis, check which data is missing (Data Gaps section)
[ ] Record any V8 business metrics not yet updated this week
    â†’ python internal/brain/scripts/add_business_observation.py ...
[ ] Record any V9 content posts published this week
    â†’ python internal/brain/scripts/add_content_observation.py ...
[ ] If V7 data is stale (> 4 weeks), run a manual benchmark session
[ ] Run all three review scripts after recording:
    â†’ python internal/brain/scripts/review_benchmarks.py
    â†’ python internal/brain/scripts/review_business_metrics.py
    â†’ python internal/brain/scripts/review_content_performance.py
[ ] Re-run unified report after recording new data:
    â†’ python internal/brain/scripts/generate_unified_report.py
[ ] Commit weekly data:
    â†’ git add internal/brain/data/ internal/brain/outputs/
    â†’ git commit -m "data(brain): weekly unified snapshot YYYY-Www"
```

---

## 10. Safety Gates

| Gate | Rule | Consequence if violated |
|---|---|---|
| G1 â€” Validation filter | All three layers filtered before join | Report marks the layer as empty if all records are validation-only |
| G2 â€” Minimum data for diagnosis | Bottleneck diagnosis requires â‰¥2 layers with real data | Report shows "insufficient data" section only |
| G3 â€” No stale-data diagnosis | V7 benchmarks >4 weeks old are flagged as STALE | Diagnosis confidence = STALE; action = re-run benchmarks |
| G4 â€” No derived metric from zero | activation_rate computed only when both inputs are real measured values | Report shows "â€”" not a computed rate |
| G5 â€” No single-week bottleneck | Bottleneck declared only after â‰¥2 consecutive weeks of same signal | Confidence = LOW on first week; MEDIUM on second; HIGH on â‰¥4 |
| G6 â€” No cross-layer attribution | Content-to-download attribution requires V9 Phase 2 script | Placeholder shown; no attribution claimed |
| G7 â€” No paid recommendations | Report never suggests paid advertising | Hardcoded exclusion |
| G8 â€” No action from empty data | Weekly action requires â‰¥1 layer with real observations | If all empty: action = "record data" only |

---

## 11. Stop Conditions

Stop generating recommendations and report to founder when:

| # | Condition | Action |
|---|---|---|
| SC1 | All three layers have 0 real observations | Output data-entry checklist only â€” no diagnosis |
| SC2 | V7 data shows a new metric > 2Ã— previous baseline | Flag anomaly â€” may indicate a regression, re-run benchmark before acting |
| SC3 | V8 MRR drops > 30% week-over-week | Surface immediately as anomaly â€” do not bury in weekly action |
| SC4 | V9 views > 500K in a single week | Flag for verification â€” may be viral outlier requiring attribution check |
| SC5 | Conflicting layer signals without explanation | Surface conflict explicitly â€” do not choose a side silently |
| SC6 | Weekly action confidence = INSUFFICIENT DATA for â‰¥4 consecutive weeks | Flag: "4 weeks without sufficient data â€” data recording has stalled" |
| SC7 | V8 shows churn > paid_conversions for 2+ consecutive weeks | Escalate immediately â€” product or pricing issue |
| SC8 | Script asked to automate actions, post content, or call external APIs | Stop immediately â€” outside V10 scope |

---

## 12. Future Implementation Steps

### Phase 1 â€” Minimal implementation (next session)

| Step | Deliverable | Type |
|---|---|---|
| 1 | `generate_unified_report.py` â€” reads all three layers, derives V7 periods, joins by week, writes both output files | `feat(brain)` |
| 2 | `outputs/unified_weekly_report.md` â€” generated on validation run (shows 0 real obs, data entry checklist) | `feat(brain)` |
| 3 | `outputs/weekly_action.md` â€” generated on validation run (shows INSUFFICIENT DATA action) | `feat(brain)` |
| 4 | Validate with existing V7 benchmark data (which DOES exist â€” 43 observations) | `feat(brain)` |
| 5 | Update `current_state.md` | `docs(brain)` |

### Phase 2 â€” Bottleneck diagnosis (after â‰¥2 layers have â‰¥4 weeks of real data)

| Step | Deliverable | Type |
|---|---|---|
| 6 | Add bottleneck diagnosis section to `generate_unified_report.py` | `feat(brain)` |
| 7 | Add confidence scoring to `weekly_action.md` output | `feat(brain)` |
| 8 | `data/unified_snapshots.jsonl` â€” append weekly join snapshot for trend tracking | `feat(brain)` |

### Phase 3 â€” Trend tracking (after â‰¥8 weeks of joint data)

| Step | Deliverable | Type |
|---|---|---|
| 9 | Add trend section to unified report (is the bottleneck layer shifting?) | `feat(brain)` |
| 10 | `outputs/bottleneck_trend.md` â€” which layer was flagged each week | `feat(brain)` |

---

## 13. Validation Commands

After Phase 1 implementation, run these:

```bash
# Syntax check
python -m py_compile internal/brain/scripts/generate_unified_report.py

# Run on current state (V7 has 43 real obs; V8 and V9 have 0 real obs)
python internal/brain/scripts/generate_unified_report.py

# Expected outcome:
# - V7 layer: shows benchmark data (paste_execute=645ms, RAM findings)
# - V8 layer: "0 real observations â€” data entry pending"
# - V9 layer: "0 real observations â€” data entry pending"
# - Bottleneck: "Insufficient data for full diagnosis â€” V7 product constraint flagged"
# - Weekly action: product layer (paste_execute known issue) â€” MEDIUM confidence
# - No validation sample data in either output file

# Confirm validation samples not in outputs
grep -c "manual_validation" internal/brain/outputs/unified_weekly_report.md
grep -c "manual_validation" internal/brain/outputs/weekly_action.md
# Both should return 0

# Check git status
git status --short
# Should show only internal/brain/ files
```

**Special validation â€” V7 partial data run:**

Unlike V8 and V9, V7 already has 43 real benchmark observations.
The Phase 1 script must correctly:
1. Derive ISO week from V7 `date` fields
2. Surface paste_execute=645ms as the known product constraint
3. Produce a MEDIUM confidence weekly action recommending product investigation
4. Not claim a bottleneck for V8 or V9 (no real data in those layers)

This is the first V10 run that produces a real (not INSUFFICIENT DATA) output.

---

## 14. How V10 Prepares V11 Operating Loop

V11 will be the first phase where the Brain **runs without being prompted**.
A scheduled process (cron or trigger) runs `generate_unified_report.py` each Monday,
generates `unified_weekly_report.md` and `weekly_action.md`, and notifies the founder.

V10 prepares V11 by:

| V10 deliverable | What V11 needs from it |
|---|---|
| `generate_unified_report.py` runs without user input | V11 calls it as a subprocess on schedule |
| Output files overwrite safely on every run | V11 does not need to manage file state |
| Confidence levels are machine-readable in the output | V11 can check confidence and skip notification if INSUFFICIENT DATA |
| Data gap section is explicit | V11 can surface "record this before Monday" notifications |
| Anti-hype gates are hardcoded | V11 inherits them automatically â€” no new safety logic needed |
| Validation sample exclusion runs before join | V11 inherits it â€” no new filtering needed |
| `data/unified_snapshots.jsonl` (Phase 2) appends per run | V11 can track report history without reading raw output files |

**V11 gate (preliminary â€” V11 will define its own):**
- V10 Phase 2 diagnosis validated by founder over â‰¥4 weeks
- At least one weekly action was acted on and measured (founder confirms)
- `generate_unified_report.py` runs correctly with no founder input required
- Founder approves the automated run cadence (weekly, Monday 08:00 local time)

---

## 15. Exact Next Prompt for V10 Minimal Implementation

Copy and send this prompt to begin V10 Phase 1:

```
Read and follow:
- internal/brain/memory/operating_contract.md
- internal/brain/memory/current_state.md
- internal/brain/outputs/v10_design_plan.md

Mission:
Implement V10 Phase 1 â€” Unified Decision Engine (minimal).

Task type:
implementation_task (Brain-only).
No product code changes.

Goal:
Build the minimal V10 script that joins V7, V8, and V9 data by ISO week period key
and generates a weekly founder-facing report with a single recommended action.

Create:
- internal/brain/scripts/generate_unified_report.py
- internal/brain/outputs/unified_weekly_report.md    (generated)
- internal/brain/outputs/weekly_action.md             (generated)

Update:
- internal/brain/memory/current_state.md

Implementation must follow v10_design_plan.md exactly:

Section 3: Input files and V7 period derivation
  - benchmark_observations.jsonl: derive ISO week from "date" field
  - business_observations.jsonl: use "period" field directly; exclude source=manual_validation
  - content_observations.jsonl: use "period" field directly; exclude source=manual_validation
  - All three filtered before join

Section 5: Output file formats
  - unified_weekly_report.md: layer status table, cross-layer join table,
    bottleneck diagnosis section, weekly action reference, data gaps, do-not-overreact
  - weekly_action.md: action, why, expected signal, evidence table, confidence explanation

Section 6: Decision scoring model
  - Rule-based decision matrix (not ML) â€” Sections 6aâ€“6f
  - Product check â†’ Funnel check â†’ Distribution check â†’ Insufficient data
  - paste_execute > 300ms â†’ product constrained
  - activation_rate < 30% (if real V8 data exists) â†’ funnel constrained
  - 0 content posts last 2 weeks (if real V9 data exists) â†’ distribution constrained

Section 7: Missing data fallback
  - 7a: All empty â†’ data entry checklist only
  - 7b/7c: Partial data â†’ partial diagnosis with missing-layer note
  - 7d: <4 weeks â†’ LOW confidence
  - 7e: â‰¥4 weeks â†’ MEDIUM/HIGH confidence
  - 7f: V7 stale (>4 weeks old) â†’ STALE flag on product assessment

Section 8: Anti-fake-certainty rules
  - Confidence levels explicit on every action
  - No derived metric from zero denominator
  - No cross-layer attribution without V9 Phase 2

Section 9: Founder decision checklist (embedded in unified_weekly_report.md)

Section 10: Safety gates G1â€“G8 must be implemented

generate_unified_report.py requirements:
  - Required: no arguments (reads all three data files automatically)
  - Optional: --week YYYY-Www (default: latest week with any real data, or current week)
  - Writes both output files in one run
  - Validates that all three input files are accessible (warn if missing, continue)
  - Derives V7 periods from datetime strings
  - Produces the join table with all three layers per week
  - Runs bottleneck diagnosis (Phase 1: product constraint only â€” V8 and V9 may be empty)
  - Produces weekly_action.md with MEDIUM confidence if V7 product constraint detected
  - Produces weekly_action.md with INSUFFICIENT DATA if V7 also has no data

After implementation:
- Run python -m py_compile internal/brain/scripts/generate_unified_report.py
- Run python internal/brain/scripts/generate_unified_report.py
- Verify: V7 data surfaces paste_execute signal correctly
- Verify: V8 and V9 show "0 real observations" without crashing
- Verify: weekly_action.md shows product constraint action (MEDIUM confidence)
- Verify: no validation samples in either output
- Run git status --short â€” confirm only internal/brain/ files changed

Commit if all checks pass:
feat(brain): add V10 unified decision engine

Rules:
- Do not modify product code.
- Do not add API calls.
- Do not automate actions.
- Only write inside internal/brain/.
- Use brain.py (read_jsonl, write_text, ensure_brain_structure) for all file I/O.
- Fallback gracefully on empty or missing input files.
```

---

## Summary Card

```
V10 DESIGN (2026-04-25)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Purpose:   Unified Decision Engine
           Joins V7 + V8 + V9 by ISO week period key.
           Answers: "Is the constraint product, funnel, or distribution?"

Question answered each week:
  "What is the single highest-leverage action this week?"

Inputs:
  data/benchmark_observations.jsonl  â€” V7 product (43 real obs exist)
  data/business_observations.jsonl   â€” V8 business (0 real obs)
  data/content_observations.jsonl    â€” V9 distribution (0 real obs)

Outputs:
  outputs/unified_weekly_report.md   â€” cross-layer join table + diagnosis
  outputs/weekly_action.md           â€” one ranked action with evidence

Decision matrix (rule-based, not ML):
  1. Product constrained?  â†’ Fix product first (paste_execute, RAM)
  2. Funnel constrained?   â†’ Fix activation before scaling distribution
  3. Distribution issue?   â†’ Post more content, test new platforms
  4. All layers healthy?   â†’ Maintain and monitor
  5. Insufficient data?    â†’ Record data â€” no recommendation yet

Current V10 output (with today's data):
  V7: MEDIUM confidence â€” paste_execute=645ms product constraint known
  V8: INSUFFICIENT DATA â€” 0 real business observations
  V9: INSUFFICIENT DATA â€” 0 real content observations
  Weekly action: "Investigate paste_execute root cause (V7 backlog PB-1)"

Safety:
  - Validation samples excluded before join (all three layers)
  - No derived metric from zero denominator
  - No bottleneck from single week (gate G5)
  - No cross-layer attribution without V9 Phase 2 (gate G6)
  - No paid recommendations (gate G7)
  - Confidence level explicit on every action
  - Degrades gracefully on empty layers

Scripts to build (Phase 1):
  generate_unified_report.py   â€” single script, two outputs

V11 link:  V10 runs on-demand now â†’ V11 runs on schedule (Monday 08:00)
           V10 proves the format; V11 automates the cadence

Phase 1:  Now (implement generate_unified_report.py)
Phase 2:  After â‰¥2 layers have â‰¥4 weeks of real data (bottleneck diagnosis)
Phase 3:  After â‰¥8 joint weeks (trend tracking, bottleneck shift detection)

Product code touched during V10 design: ZERO
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

---

*This document is planning_only. No product code was modified or proposed for modification.*
*V10 Phase 1 implementation prompt is in Section 15 above.*

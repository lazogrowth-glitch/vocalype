# Vocalype Brain â€” V8C Missing / Zero Metrics Protocol

Date: 2026-04-25
Task type: planning_only
Author: Vocalype Brain
Status: design document â€” no scripts modified

> This document defines how to record business metrics honestly at the
> early-stage when many numbers are zero, unmeasured, or inapplicable.
> It prevents inflated traction signals and ensures the baseline is clean.

---

## 1. Definitions

Four statuses cover every "I don't have a number" situation.
Use exactly one. Do not conflate them.

### `zero`
**The metric was checked. The value is 0.**

The data source exists and was consulted.
The result is zero â€” not missing, not unknown. A confirmed absence of activity.

- Example: Stripe dashboard opened. Zero new paid conversions this week. â†’ `zero`
- Example: TikTok analytics checked. Zero views this week. â†’ `zero`
- This IS a real observation. Record it as `--value 0`.

Zero is informative. Repeated zeros signal a funnel stage that is completely blocked.

---

### `unknown`
**The metric was not checked this week.**

The data source may exist, but the founder did not open it.
The value could be 0, 5, or 100 â€” we don't know.

- Example: Vercel analytics was not checked this week. â†’ `unknown`
- Example: Supabase was not queried. â†’ `unknown`
- Do NOT record an `unknown` as 0. They are different signals.
- Do NOT fabricate a plausible value to avoid an unknown.

Unknown observations are recorded as a text note, not a numeric value.
The review script will flag metrics that have been `unknown` for â‰¥2 consecutive weeks.

---

### `not_available`
**The data source does not exist yet.**

The metric requires a tool or integration that has not been set up.
Recording is impossible regardless of effort this week.

- Example: No analytics tool installed â†’ `website_visitors` is `not_available`
- Example: Stripe not yet connected â†’ `mrr` is `not_available`
- Example: No download tracking in place â†’ `downloads` is `not_available`

Once the data source is created, the status transitions to `zero` or a real value.
`not_available` is never permanent â€” it is a blocker that should be resolved.

---

### `not_applicable`
**The metric does not apply to the current stage.**

The metric is conceptually valid but requires preconditions that do not exist yet.

- Example: `trial_to_paid_rate` requires trial users to exist â†’ `not_applicable` until first trial
- Example: `churned_users` requires paying subscribers â†’ `not_applicable` until first conversion
- Example: `d7_retention_rate` requires â‰¥7 days of user history â†’ `not_applicable` until then

`not_applicable` transitions to `zero` or a real value when the precondition is met.
It is NOT the same as `unknown` â€” we are not failing to check, the metric just doesn't apply.

---

## 2. When Each Status Should Be Used

| Situation | Status | Record? |
|---|---|---|
| Dashboard opened, value confirmed as 0 | `zero` | Yes â€” `--value 0` |
| Dashboard not opened this week | `unknown` | Yes â€” text note only |
| Analytics tool not installed | `not_available` | Yes â€” text note only |
| No paying users yet; churn impossible | `not_applicable` | Yes â€” text note only |
| Founder guesses "probably 0" | **DO NOT USE** | No â€” do not guess |
| Founder copies last week's value without checking | **DO NOT USE** | No â€” staleness is worse than unknown |

**The rule:** Only record a numeric value when you have opened the data source
and read the number yourself in the current week. Everything else is a status note.

---

## 3. Example Records â€” Early Vocalype Stage

The following illustrates how each status maps to an honest record for a
pre-traction Vocalype (first weeks of public availability).

### Week 2026-W18 â€” example batch

**Stripe not yet set up (or MRR is genuinely â‚¬0):**
```bash
# If Stripe exists and was checked â€” confirmed zero:
python internal/brain/scripts/add_business_observation.py \
    --metric mrr --value 0 --unit usd \
    --source stripe_dashboard --period 2026-W18 \
    --notes "confirmed zero, no paying users"

# If Stripe exists but was not checked this week:
# â†’ Do not record. Note in weekly log: "mrr: unknown this week â€” not checked."

# If Stripe not yet connected:
# â†’ Note in weekly log: "mrr: not_available â€” Stripe not configured."
```

**Downloads â€” verified zero:**
```bash
python internal/brain/scripts/add_business_observation.py \
    --metric downloads --value 0 --unit count \
    --source vercel --period 2026-W18 \
    --notes "checked Vercel download page, 0 installer clicks"
```

**first_successful_dictations â€” Supabase checked, 2 users:**
```bash
python internal/brain/scripts/add_business_observation.py \
    --metric first_successful_dictations --value 2 --unit count \
    --source supabase_dashboard --period 2026-W18 \
    --notes "2 distinct users with first dictation in history table this week"
```

**content_posts â€” founder did not post this week:**
```bash
python internal/brain/scripts/add_business_observation.py \
    --metric content_posts --value 0 --unit count \
    --source manual_founder --period 2026-W18 \
    --notes "no posts this week, building product"
```

**churned_users â€” not_applicable (no paying users exist yet):**
```
# Do not record as 0. Note in weekly log:
# "churned_users: not_applicable â€” no paying subscribers yet."
# Record it once the first subscriber exists.
```

**website_visitors â€” analytics not installed:**
```
# Note in weekly log:
# "website_visitors: not_available â€” no analytics tool installed."
# Action: install Plausible or enable Vercel Analytics.
```

---

## 4. How `review_business_metrics.py` Should Interpret Each Status

> These behaviours are defined here for future implementation.
> The script does NOT yet support status fields â€” this section guides V8C script changes.

| Status | Report behaviour |
|---|---|
| Numeric value (including 0) | Display in funnel table, trend chart, weekly summary |
| `unknown` (text note) | Flag: "âš ï¸ metric not checked this week" â€” does NOT count toward baseline weeks |
| `not_available` | Flag: "ðŸ”´ data source missing â€” see setup checklist" â€” excluded from trend |
| `not_applicable` | Flag: "â¸ not applicable yet â€” precondition unmet" â€” excluded from trend |

**Baseline readiness rules:**
- Only weeks with a confirmed numeric value (including zero) count toward the 4-week baseline.
- A week where the metric is `unknown` is NOT a baseline week.
- A metric with all `not_applicable` entries should be hidden from missing-metric warnings.

**Anomaly flags:**
- `unknown` for â‰¥2 consecutive weeks â†’ flag: "Metric unchecked for 2+ weeks â€” add to weekly routine."
- `not_available` for â‰¥4 weeks â†’ flag: "Data source missing for 4+ weeks â€” blocking baseline."
- `not_applicable` transitions to real value â†’ flag: "First observation â€” baseline clock starts."

**Implementation note for V8C script update:**
The current `add_business_observation.py` requires `--value` as a float.
To support non-numeric statuses, the script needs a `--status` optional flag:
```
--status unknown | not_available | not_applicable
```
When `--status` is provided, `--value` is omitted. The record stores:
```json
{"metric": "mrr", "period": "2026-W18", "status": "not_available", "notes": "Stripe not configured"}
```
When `--status` is absent, the record stores the numeric value as today.

---

## 5. What Not to Fake

These behaviours produce false baselines and should never occur:

| Anti-pattern | Why it is harmful |
|---|---|
| Recording `--value 0` without checking the dashboard | Zero looks like confirmed absence; it may actually be unknown |
| Copying last week's value when not re-checked | Stale data inflates apparent consistency |
| Recording `--value 1` as an estimate ("probably 1 download") | Invented traction corrupts baseline |
| Skipping `not_applicable` metrics and pretending they don't exist | Hides when metrics become applicable |
| Recording `content_views` as 0 when no content was posted | Content_views = 0 when posts exist and got no views. When 0 posts exist, it is `not_applicable`. |
| Marking a metric `not_applicable` to avoid checking it | `not_applicable` is a structural state, not a way to skip work |

**The Brain's job is to make the founder's reality legible, not comfortable.**
A clean baseline of zeros and unknowns is more valuable than a fake baseline of plausible numbers.

---

## 6. Manual Weekly Check Routine

10-minute session, every Monday (or end of Sunday).
Record only what you actually open. Note anything you skip.

```
1. Open Stripe Dashboard (2 min)
   Record: mrr, paid_conversions, trial_starts, churned_users, refunds
   If Stripe not set up: note "not_available" in weekly log.
   If nothing changed: record the current MRR as a confirmed snapshot anyway.

2. Open Supabase (2 min)
   Record: account_signups, first_successful_dictations
   If you did not check: note "unknown" â€” do not copy last week.

3. Open Vercel / Analytics (1 min)
   Record: website_visitors, downloads (if tracked)
   If analytics not installed: note "not_available" and add setup to backlog.

4. Open TikTok / Social Analytics (1 min)
   Record: content_views, content_posts
   If no content was published: content_posts = 0 (confirmed).
   If content exists but you did not check views: note "unknown".

5. Count manually (1 min)
   Record: founder_distribution_actions (DMs + emails + community posts sent)
   This is always checkable â€” count from your sent folder / DM history.

6. Run review script (1 min)
   python internal/brain/scripts/review_business_metrics.py
   Read the report. Note any anomaly flags.

7. Note any "unknown" or "not_available" metrics in the report notes.
   Add missing data sources to the product/ops backlog.
```

**Minimum viable weekly session (if pressed for time):**
Record at least: `mrr`, `first_successful_dictations`, `downloads`.
These three cover revenue, North Star activation, and top-of-funnel. Skip others if needed,
but mark them as `unknown` â€” do not leave them unrecorded.

---

## 7. Suggested Next V8 Implementation Task

The current `add_business_observation.py` requires a numeric `--value`.
To implement this protocol, one script change is needed:

**Task:** Add `--status` optional flag to `add_business_observation.py`

```
python internal/brain/scripts/add_business_observation.py \
    --metric mrr \
    --status not_available \
    --source stripe_dashboard \
    --period 2026-W18 \
    --notes "Stripe not yet configured"
```

**Record format when --status is used:**
```json
{
  "date": "2026-04-25T10:00:00",
  "period": "2026-W18",
  "metric": "mrr",
  "status": "not_available",
  "source": "stripe_dashboard",
  "app_version": "4327589",
  "notes": "Stripe not yet configured"
}
```

**Review script changes needed:**
- `review_business_metrics.py`: distinguish status records from value records
- Baseline counting: only count weeks with a numeric `value` field
- Anomaly flags: add the 3 status-based flags from Section 4
- Funnel table: show status icons (âœ… / âš ï¸ / ðŸ”´ / â¸) next to missing metrics

**Suggested prompt for V8C implementation:**
```
Read and follow:
- internal/brain/memory/operating_contract.md
- internal/brain/memory/current_state.md
- internal/brain/outputs/v8_missing_metrics_protocol.md

Mission:
Implement V8C â€” add --status flag to add_business_observation.py
and update review_business_metrics.py to distinguish value vs status records.

Task type: implementation_task (Brain scripts only, no product code).

Changes:
1. add_business_observation.py:
   - Add optional --status arg: one of unknown | not_available | not_applicable
   - When --status is provided, --value is not required
   - Record format: omit "value" field, add "status" field
   - Validate: --status and --value are mutually exclusive

2. review_business_metrics.py:
   - Separate value records from status records before computing stats
   - Baseline counting: only weeks with numeric value count
   - Funnel table: show status icon when no value exists for a metric+period
   - Anomaly flags: add unknown (>=2 weeks), not_available (>=4 weeks) flags

Rules:
- Only modify internal/brain/scripts/
- Do not modify product code.
- After changes: run compile check and validation sample.
- Do not commit yet.
```

---

## 8. Stop Conditions

| # | Condition | Action |
|---|---|---|
| SC1 | Any numeric value was recorded without opening the data source | Remove the record â€” it is fabricated |
| SC2 | `not_applicable` is used to avoid checking a metric that could be checked | Change to `unknown` â€” `not_applicable` is structural, not optional |
| SC3 | The baseline shows â‰¥4 weeks with all zeros across all metrics | Flag: possible measurement setup failure â€” verify data sources are working |
| SC4 | `first_successful_dictations` is `unknown` for â‰¥2 consecutive weeks | Stop â€” this is the North Star metric; it must be checked every week |
| SC5 | A metric is marked `not_available` for >8 consecutive weeks | Flag as backlog blocker â€” the missing data source should be set up |
| SC6 | Founder asks Brain to estimate or interpolate a missing value | Refuse â€” record `unknown` instead, never estimate |
| SC7 | Two conflicting values for the same metric+period exist in the JSONL | Flag and ask founder to confirm which is correct before generating report |

---

## Summary

```
V8C MISSING METRICS PROTOCOL (2026-04-25)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Four statuses:
  zero           = checked, confirmed 0    â†’ record --value 0
  unknown        = not checked             â†’ note only, no numeric record
  not_available  = data source missing     â†’ note only, flag setup backlog
  not_applicable = precondition unmet      â†’ note only, hidden from warnings

Early Vocalype typical state (pre-traction):
  mrr = 0 (if Stripe exists) or not_available
  first_successful_dictations = 0 or low count (confirmed from Supabase)
  downloads = 0 (confirmed from Vercel) or not_available
  churned_users = not_applicable (no paying users yet)
  content_views = 0 (if posted) or not_applicable (if no posts)

What never to do:
  Guess, estimate, copy last week, or record 0 without checking.

Next implementation task:
  Add --status flag to add_business_observation.py (V8C script update)
  Update review_business_metrics.py to handle status records
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

---

*This document is planning_only. No scripts were modified. No product code was touched.*
*Source: v8_design_plan.md, operating_contract.md.*

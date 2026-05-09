# Vocalype Brain â€” V8 Design Plan
# Business Metrics Visibility Loop

Date: 2026-04-25
Task type: planning_only
Status: design document only â€” no scripts implemented yet
Author: Vocalype Brain

---

## What V8 Is For

V7 gave the Brain **product eyes**: real latency, RAM, inference timing, pipeline anatomy.
V8 gives the Brain **business eyes**: users, downloads, activation, conversion, revenue.

Without V8, the Brain cannot answer:
- "Is anyone actually downloading and using Vocalype?"
- "Are product improvements translating into more activated users?"
- "Is latency reduction (V7 finding) correlated with better conversion?"
- "Where in the funnel are users dropping off?"
- "Is MRR growing, flat, or declining?"

V8 does not automate growth. It does not post content. It does not touch the product.
It records numbers, reports trends, and connects product metrics to business outcomes.

V8 is the measurement foundation that makes V9 (growth/distribution) honest.

---

## 1. What V8 Should Do

| Action | Description |
|---|---|
| Record manual business observations | Founder enters metrics weekly via CLI or direct JSONL append |
| Generate weekly business report | `review_business_metrics.py` reads observations, writes `business_metrics_report.md` |
| Connect product metrics to business outcomes | Join V7 benchmark data to business metrics by date/version |
| Surface funnel drop-offs | Show where users are lost: download â†’ install â†’ activate â†’ dictate â†’ convert |
| Track North Star metric | `first_successful_dictation_count` per week â€” the only metric that matters at activation stage |
| Flag anomalies | RAM growth, MRR drop, conversion collapse â€” surface these before they become crises |
| Prepare V9 backlog | Each business gap becomes a V9 candidate (distribution, content, onboarding) |

---

## 2. What V8 Must NOT Do

| Forbidden action | Why |
|---|---|
| Modify product code (`src/`, `src-tauri/`, `backend/`) | Brain does not touch product code |
| Add analytics, tracking, or telemetry to the app | Separate V7.5 task requiring explicit founder approval |
| Modify auth, license, payment, or security code | Permanently forbidden scope |
| Auto-post content to TikTok, Twitter, LinkedIn | V9 scope â€” not V8 |
| Automate growth campaigns | V9 scope |
| Pull data directly from Stripe, Supabase, or Vercel APIs | V8 Phase 1 = manual. Automated pulls are V8 Phase 2. |
| Declare a business win without before/after comparison | The method requires baseline + delta |
| Track individual user behaviour or PII | Aggregate metrics only â€” no user-level data in Brain files |
| Run SQL against production Supabase | Manual export only in Phase 1 |
| Design V9 before V8 Phase 1 baseline is recorded | V9 requires at least 4 weeks of V8 data |

---

## 3. Business Metrics to Track

### 3A â€” Distribution / Top of Funnel

| Metric | Unit | Source | Notes |
|---|---|---|---|
| `website_visitors_week` | count | Vercel analytics / UTM | Weekly unique sessions on vocalype.com |
| `download_page_views_week` | count | Vercel / analytics | Views on download/CTA page |
| `downloads_week` | count | Download counter / GitHub releases | Installer downloads per week |
| `installer_to_launch_rate` | % | Manual estimate / Supabase | % of downloads that reached app launch |
| `content_posts_published_week` | count | Manual (founder) | TikTok / social posts published |
| `content_views_week` | count | TikTok / social analytics | Total views across all posts |
| `content_to_download_attributed` | count | UTM / landing page | Downloads attributed to content |

### 3B â€” Activation Funnel

| Metric | Unit | Source | Notes |
|---|---|---|---|
| `new_app_installs_week` | count | Supabase auth.users | New accounts created per week |
| `activation_attempts_week` | count | Supabase / logs | Sessions that reached activation screen |
| `activation_success_week` | count | Supabase / logs | Sessions that reached "ready" state |
| `activation_success_rate` | % | Derived | activation_success / activation_attempts |
| `first_successful_dictation_week` | count | Supabase history | **North Star** â€” users who completed first dictation |
| `first_dictation_success_rate` | % | Derived | first_dictation / new_installs |
| `activation_to_dictation_drop` | % | Derived | % of activated users who never dictated |

### 3C â€” Engagement / Retention

| Metric | Unit | Source | Notes |
|---|---|---|---|
| `dau` | count | Supabase | Daily active users (any dictation) |
| `wau` | count | Supabase | Weekly active users |
| `dictations_per_wau_week` | float | Supabase | North Star numerator / WAU â€” usage intensity |
| `d7_retention_rate` | % | Supabase cohort | Users active 7 days after first dictation |
| `d30_retention_rate` | % | Supabase cohort | Users active 30 days after first dictation |

### 3D â€” Revenue

| Metric | Unit | Source | Notes |
|---|---|---|---|
| `trial_starts_week` | count | Stripe / Supabase | New trials started |
| `paid_conversions_week` | count | Stripe | Trial â†’ paid this week |
| `trial_to_paid_rate` | % | Derived | conversions / trial_starts (lagged by trial length) |
| `mrr_usd` | USD | Stripe | Monthly Recurring Revenue snapshot |
| `mrr_delta_usd` | USD | Derived | MRR change vs. prior week snapshot |
| `churn_count_week` | count | Stripe | Cancelled subscriptions this week |
| `refund_count_week` | count | Stripe | Refunds processed this week |
| `arpu_usd` | USD | Derived | MRR / paid users |

### 3E â€” Founder Actions (accountability layer)

| Metric | Unit | Source | Notes |
|---|---|---|---|
| `content_created_week` | count | Manual | Videos/posts created (not just published) |
| `outreach_contacts_week` | count | Manual | DMs, emails, cold contacts sent |
| `user_interviews_week` | count | Manual | User conversations completed |
| `user_feedback_items_week` | count | Manual | Pieces of actionable feedback collected |
| `product_commits_week` | count | git log | Commits to main (non-Brain) per week |
| `brain_commits_week` | count | git log | Brain/measurement commits per week |

---

## 4. Product-to-Business Connection from V7

V7 measured product fundamentals. V8 connects them to business outcomes.

The join key is `week_of` (ISO week) â€” both V7 product observations and V8 business
observations are timestamped. Any product change can be correlated against business
metric changes in the same or following week.

| V7 Product Metric | V8 Business Question |
|---|---|
| `total_dictation_latency_ms` p50 = 1043ms | Does reducing latency increase `d7_retention_rate`? |
| `paste_execute` = 645ms (62% of latency) | If paste drops to 100ms, does `dictations_per_wau_week` rise? |
| Idle background inference loop | Does fixing idle RAM growth reduce `churn_count_week`? |
| `activation_success_rate` (unmeasured) | Is activation failure the primary reason for low `first_dictation_success_rate`? |
| `stt_inference_time_ms` p50 = 230ms | Is inference speed a churn reason, or is quality (WER) more important? |

**Correlation is not causation.** V8 surfaces the correlation. The founder decides if
the correlation is causal before investing in an optimisation.

The Brain will never declare "latency fix caused conversion increase" â€” it will report
"latency p50 dropped 40% in week N; paid_conversions_week rose 20% in weeks N+1 and N+2."

---

## 5. Manual Metrics Format (Phase 1)

Phase 1 = founder manually records observations once per week.
No API calls. No database queries. Copy numbers from dashboards.

### Protocol (10-minute weekly session)

```
Every Monday morning (or end of Sunday):

1. Open Vercel Analytics â†’ record website_visitors_week, download_page_views_week
2. Open Stripe Dashboard â†’ record mrr_usd, paid_conversions_week, trial_starts_week, churn_count_week
3. Open Supabase â†’ auth.users, history table â†’ record new_app_installs_week, first_successful_dictation_week
4. Open TikTok / social analytics â†’ record content_views_week
5. Count manually: content_posts_published_week, outreach_contacts_week, user_interviews_week
6. Record each using add_business_observation.py (V8 Phase 1 script â€” to be built)
7. Run review_business_metrics.py â†’ read outputs/business_metrics_report.md
```

### Manual observation command (proposed, not yet built)

```bash
python internal/brain/scripts/add_business_observation.py \
    --week 2026-W18 \
    --metric mrr_usd \
    --value 420 \
    --source stripe_dashboard \
    --notes "weekly snapshot, no refunds this week"
```

---

## 6. Future Automatic Metrics Format (Phase 2)

Phase 2 = automated pulls from existing APIs after manual baseline is established.
**Phase 2 requires explicit founder approval before any API integration is built.**

| Source | API / method | Metrics |
|---|---|---|
| Stripe | `stripe.BalanceTransactions.list()` | mrr_usd, paid_conversions_week, churn_count_week |
| Supabase | `supabase.rpc('weekly_metrics')` | wau, first_successful_dictation_week, activation_success_rate |
| Vercel / Plausible | Analytics export | website_visitors_week, download_page_views_week |
| GitHub | `gh api repos/.../releases` | downloads_week (if using GitHub releases) |
| TikTok | TikTok API or manual CSV export | content_views_week |

**Phase 2 script (not yet built):** `fetch_business_metrics.py`
- Reads API credentials from environment variables (never committed to repo)
- Appends observations to `data/business_observations.jsonl`
- Marks records as `source: automated` vs `source: manual`
- Must never store user-level data â€” aggregate only

---

## 7. Exact Input Files

| Input | Path | Purpose |
|---|---|---|
| Brain config | `internal/brain/config/brain.config.json` | Safety rules |
| Business observations | `internal/brain/data/business_observations.jsonl` | Weekly metric records |
| Business baseline | `internal/brain/data/business_baseline.jsonl` | Locked baseline for comparison |
| V7 benchmark observations | `internal/brain/data/benchmark_observations.jsonl` | Product metric join data |
| Applied patches log | `internal/brain/data/applied_patches.jsonl` | Link business delta to product change |
| Handoff tasks log | `internal/brain/data/handoff_tasks.jsonl` | Which product change shipped when |
| Operating contract | `internal/brain/memory/operating_contract.md` | Safety rules |
| Current state | `internal/brain/memory/current_state.md` | Phase tracking |

---

## 8. Exact Output Files

| Output | Path | Written by |
|---|---|---|
| Business observations | `internal/brain/data/business_observations.jsonl` | `add_business_observation.py` (manual entry) |
| Business baseline | `internal/brain/data/business_baseline.jsonl` | `lock_business_baseline.py` (Phase 2) |
| Weekly business report | `internal/brain/outputs/business_metrics_report.md` | `review_business_metrics.py` |
| Productâ€“business correlation | `internal/brain/outputs/product_business_correlation.md` | `correlate_metrics.py` (Phase 2) |
| V8 status report | `internal/brain/outputs/v8_status_report.md` | Manual (at phase close) |

---

## 9. Proposed JSONL Schemas

### `business_observations.jsonl` â€” one record per metric per week

```json
{
  "date": "2026-04-28T09:00:00",
  "week_of": "2026-W18",
  "metric": "mrr_usd",
  "value": 420.0,
  "unit": "usd",
  "source": "stripe_dashboard",
  "app_version": "536875b",
  "notes": "weekly snapshot"
}
```

**Field rules:**
- `week_of`: ISO week string (`YYYY-Www`) â€” standard grouping key
- `metric`: snake_case, from the approved metric list in Section 3
- `value`: always numeric â€” no strings, no nulls (omit record if unknown)
- `source`: one of `stripe_dashboard`, `supabase_dashboard`, `vercel_analytics`, `tiktok_analytics`, `manual_founder`, `automated`
- `app_version`: git SHA of the product at time of recording (use `git rev-parse --short HEAD`)

### `business_baseline.jsonl` â€” one record per metric (locked)

```json
{
  "date_locked": "2026-05-05",
  "locked_by": "founder",
  "metric": "mrr_usd",
  "baseline_value": 420.0,
  "sample_weeks": 4,
  "p50": 415.0,
  "p95": 440.0,
  "week_range": ["2026-W18", "2026-W21"],
  "app_version_range": ["536875b", "abc1234"]
}
```

### `product_business_correlation.jsonl` â€” one record per product change + business delta

```json
{
  "date": "2026-05-12",
  "product_change": "paste_execute_reduction",
  "app_version_before": "536875b",
  "app_version_after": "abc1234",
  "product_delta": {
    "metric": "total_dictation_latency_ms",
    "p50_before": 1043,
    "p50_after": 480,
    "delta_pct": -54.0
  },
  "business_delta_week_plus_1": {
    "metric": "dictations_per_wau_week",
    "before": 12.4,
    "after": 15.1,
    "delta_pct": 21.8
  },
  "causal_confidence": "low",
  "notes": "correlation only â€” confounders: content post published same week"
}
```

---

## 10. Safety Gates

All gates apply at every V8 session.

| Gate | Check | Failure action |
|---|---|---|
| G1 â€” Read-only Brain | Scripts never write to `src/`, `src-tauri/`, `backend/` | Abort â€” log safety violation |
| G2 â€” Aggregate only | No user-level PII in any Brain file | Abort â€” flag and redact |
| G3 â€” No API secrets in repo | Credentials must come from env vars, never from Brain files | Abort â€” do not commit |
| G4 â€” Manual before automated | Phase 2 automation requires â‰¥4 weeks of manual baseline | Stop â€” run Phase 1 first |
| G5 â€” Baseline locked before comparison | `compare_business_metrics.py` refuses if baseline missing | Warn â€” lock baseline first |
| G6 â€” App version tagged | Every observation record must include `app_version` | Warn â€” record is unreliable |
| G7 â€” Week string validated | `week_of` must be valid ISO week format | Error â€” reject malformed record |
| G8 â€” Correlation â‰  causation | Reports must label correlations explicitly, never claim causation | Manual check before committing |
| G9 â€” Founder records source | Every manual observation must have a `source` field | Warn â€” data provenance unclear |

---

## 11. Stop Conditions

Stop and report to the founder when any of the following is true:

| # | Condition | Action |
|---|---|---|
| S1 | Metric requires reading production database directly | Stop â€” export CSV manually instead |
| S2 | Observation contains individual user data (email, name, IP) | Stop â€” redact, use aggregate only |
| S3 | Script would write to product files | Abort â€” gate G1 violation |
| S4 | Business metric change cannot be explained (no product change, no campaign) | Flag as anomaly â€” do not declare win or loss |
| S5 | MRR drops >20% week-over-week | Stop all V8 optimisation work â€” investigate cause first |
| S6 | `churn_count_week` > `paid_conversions_week` for 3 consecutive weeks | Flag as churn crisis â€” escalate to founder |
| S7 | `first_successful_dictation_week` = 0 for any week | Stop â€” activation is broken, fix before measuring anything else |
| S8 | Correlation report shows product metric improved but business metric worsened | Do not declare win â€” investigate confounders before next patch |
| S9 | V8 Phase 2 API automation requested before 4 weeks of manual baseline | Stop â€” Phase 1 first |
| S10 | Founder asks V8 to post content, run ads, or modify backend pricing | Stop â€” that is V9 or forbidden scope |

---

## 12. Future Implementation Steps

### V8 Phase 1 â€” Manual Weekly Cadence (no API calls)

**Goal:** 4 weeks of baseline observations across all Section 3 metrics.

```
Step 1: Build add_business_observation.py
  - Appends one observation to data/business_observations.jsonl
  - Args: --week, --metric, --value, --unit, --source, --notes
  - Validates: ISO week format, known metric name, numeric value
  - Auto-reads app_version from git

Step 2: Build review_business_metrics.py
  - Reads data/business_observations.jsonl
  - Groups by metric, computes weekly trend (last 4 weeks)
  - Writes outputs/business_metrics_report.md
  - Sections: funnel summary, revenue summary, engagement summary, founder actions, anomaly flags

Step 3: Founder runs weekly 10-minute session
  - Record 8â€“12 metrics from Stripe / Supabase / Vercel dashboards
  - Run review_business_metrics.py
  - Read report â€” note any anomalies

Step 4: After 4 weeks: build lock_business_baseline.py
  - Reads data/business_observations.jsonl
  - Writes data/business_baseline.jsonl (locked snapshot, 4-week window)
  - Requires --approve flag
```

### V8 Phase 2 â€” Automated Pulls (after Phase 1 baseline)

```
Step 5: Build fetch_business_metrics.py (requires explicit founder approval)
  - Pulls from Stripe, Supabase, Vercel APIs
  - Appends to data/business_observations.jsonl with source: automated
  - Credentials from environment variables only, never from repo

Step 6: Build correlate_metrics.py
  - Joins V7 benchmark_observations.jsonl to business_observations.jsonl by date
  - Joins to applied_patches.jsonl and handoff_tasks.jsonl by app_version
  - Writes outputs/product_business_correlation.md
  - Labels correlations, flags confounders, never claims causation

Step 7: Scheduled weekly run (cron or manual trigger)
  - fetch_business_metrics.py â†’ review_business_metrics.py â†’ correlate_metrics.py
  - Output: business_metrics_report.md + product_business_correlation.md
  - Brain commits outputs (docs commit, brain files only)
```

### V8 Phase 3 â€” Signal Threshold Alerts (after Phase 2)

```
Step 8: Build alert_thresholds.py
  - Reads business_baseline.jsonl
  - Checks current week against thresholds
  - Flags: MRR drop >10%, churn spike, first_dictation_week = 0
  - Writes outputs/business_alerts.md
  - Does NOT auto-escalate â€” founder reads alerts manually
```

---

## 13. Validation Commands

```bash
# After Phase 1 scripts are built â€” compile check
python -m py_compile internal/brain/scripts/add_business_observation.py
python -m py_compile internal/brain/scripts/review_business_metrics.py

# After first manual session â€” verify observation recorded
python internal/brain/scripts/review_business_metrics.py
cat internal/brain/outputs/business_metrics_report.md

# After Phase 1 baseline (4 weeks) â€” lock baseline
python internal/brain/scripts/lock_business_baseline.py
python internal/brain/scripts/lock_business_baseline.py --approve

# Confirm product code untouched
git diff src/
git diff src-tauri/
git diff backend/

# Confirm output files written
cat internal/brain/outputs/business_metrics_report.md
cat internal/brain/outputs/product_business_correlation.md

# Verify no PII in observations
grep -i "email\|@\|phone\|ip_addr" internal/brain/data/business_observations.jsonl
# Expected output: nothing
```

---

## 14. How V8 Prepares V9 Growth / Distribution Loop

V9 is not automation for its own sake â€” it is automation of what V8 proves works.

V8 prepares V9 by:

### 14a â€” Identifying the highest-leverage distribution channel

After 4+ weeks of data, V8 can answer:
- Which content type drives the most download-attributed views? (TikTok vs other)
- What is the content â†’ download â†’ activation conversion rate?
- Is the funnel broken at download, activation, or first dictation?

V9 only automates what V8 proves has positive ROI.
V9 does not automate channels with no measured signal.

### 14b â€” Identifying the activation bottleneck

V8 measures `first_dictation_success_rate = first_dictation / new_installs`.
If this rate is < 50%, the primary growth lever is fixing activation â€” not distribution.
Pouring traffic into a broken funnel is anti-Elon (waste, not leverage).

V8 forces the decision: "Is growth blocked by distribution or by activation?"
V9 only scales the channel that is not the bottleneck.

### 14c â€” Connecting product changes to business outcomes

When V7 product patches land (paste_execute reduction, idle loop fix), V8 measures
whether they moved `d7_retention_rate` or `dictations_per_wau_week`.

V9 growth investment is justified only after V8 confirms the product is worth scaling.

### 14d â€” What V9 must NOT inherit from V8

V9 must not assume:
- Content views â†’ downloads is linear (it is not)
- Activation rate is stable (it changes with product versions)
- Correlation between product improvement and retention is causal

V9 requires: V8 baseline locked + â‰¥1 confirmed product win in product+business terms.

---

## 15. Exact Next Prompt for V8 Minimal Implementation

Copy and send this prompt to begin building V8 Phase 1 scripts:

```
Read and follow:
- internal/brain/memory/operating_contract.md
- internal/brain/memory/current_state.md
- internal/brain/outputs/v8_design_plan.md

Mission:
Build V8 Phase 1 â€” Manual Business Metrics Recorder.

Task type:
implementation_task (Brain scripts only).
No product code changes.

Goal:
Build the two V8 Phase 1 scripts defined in v8_design_plan.md:
  1. internal/brain/scripts/add_business_observation.py
  2. internal/brain/scripts/review_business_metrics.py

Requirements:
- add_business_observation.py:
    Args: --week (YYYY-Www), --metric, --value, --unit, --source, --notes
    Validates: ISO week format, known metric name (from Section 3 of design plan), numeric value
    Auto-reads app_version from: git rev-parse --short HEAD
    Appends one JSON record to: data/business_observations.jsonl
    Prints confirmation with all field values

- review_business_metrics.py:
    Reads: data/business_observations.jsonl
    Groups by metric, computes: count, min, max, mean, last 4 weeks trend
    Sections: funnel summary, revenue summary, engagement, founder actions
    Flags: any metric with 0 observations in latest week
    Writes: outputs/business_metrics_report.md
    Prints: summary to stdout

Rules:
- Only write to internal/brain/scripts/ and internal/brain/data/ and internal/brain/outputs/
- Do not modify product code.
- Do not add API calls or network requests.
- Do not add any dependency not in Python stdlib.
- After writing scripts, run:
    python -m py_compile internal/brain/scripts/add_business_observation.py
    python -m py_compile internal/brain/scripts/review_business_metrics.py
    python internal/brain/scripts/add_business_observation.py \
        --week 2026-W18 --metric mrr_usd --value 0 --unit usd \
        --source manual_founder --notes "validation test"
    python internal/brain/scripts/review_benchmarks.py
- Do not commit yet.
```

---

## Summary

```
V8 DESIGN PLAN (2026-04-25)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Purpose:   Give the Brain business eyes to complement V7 product eyes

Phase 1:   Manual weekly recording (10 min/week, no APIs)
           Script: add_business_observation.py + review_business_metrics.py
           Data:   data/business_observations.jsonl
           Report: outputs/business_metrics_report.md
           Goal:   4 weeks of baseline across all Section 3 metrics

Phase 2:   Automated pulls (Stripe, Supabase, Vercel) + correlation
           Requires: 4 weeks of Phase 1 baseline
           Scripts: fetch_business_metrics.py, correlate_metrics.py

Phase 3:   Threshold alerts (MRR drop, churn spike, activation = 0)
           Requires: Phase 2 baseline locked

North Star metric:
  first_successful_dictation_week (Supabase history table)
  â€” the only metric that matters at this activation stage

V7 â†’ V8 connection:
  When paste_execute drops from 645ms to ~100ms (V7 patch),
  does d7_retention_rate or dictations_per_wau_week rise?
  V8 measures that correlation. V9 scales only what correlates.

V8 gates for V9:
  - 4 weeks of V8 business baseline
  - â‰¥1 confirmed product win (product + business delta positive)
  - Activation funnel assessed: is growth blocked by distribution or activation?

Product code touched: ZERO (during V8 planning and Phase 1)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

---

*This document is planning_only. No scripts were implemented. No product code was modified.*
*V8 Phase 1 implementation begins with the prompt in Section 15.*

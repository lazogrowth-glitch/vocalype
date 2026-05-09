# Vocalype Brain â€” V8 Business Metrics Report

Date: 2026-04-25T15:07:35
Total observations: 6

> This report is measurement-only. No growth recommendations.
> Only `measured` and `zero` observations count toward the baseline.

---

## Coverage

- Total observations       : 6
- Priority metrics checked : 2 / 13
- Metrics never checked    : 10
- Not applicable yet       : 1
- Weeks recorded           : 1
- Baseline ready (â‰¥4 weeks all checked): NO

| Metric | Checked weeks | Latest status | Baseline ready |
|---|---|---|---|
| `website_visitors` | 0 | âš ï¸ unknown | âŒ (0/4) |
| `downloads` | 1 | âœ… zero | âŒ (1/4) |
| `account_signups` | 0 | â€” â€” | âŒ (0/4) |
| `activation_attempts` | 0 | ðŸ”´ not_available | âŒ (0/4) |
| `first_successful_dictations` | 0 | â€” â€” | âŒ (0/4) |
| `trial_starts` | 0 | â€” â€” | âŒ (0/4) |
| `paid_conversions` | 0 | â€” â€” | âŒ (0/4) |
| `mrr` | 1 | âœ… zero | âŒ (1/4) |
| `refunds` | 0 | â€” â€” | âŒ (0/4) |
| `churned_users` | 0 | â¸ not_applicable | â¸ n/a |
| `content_posts` | 0 | â€” â€” | âŒ (0/4) |
| `content_views` | 0 | â€” â€” | âŒ (0/4) |
| `founder_distribution_actions` | 0 | â€” â€” | âŒ (0/4) |

---

## Status Breakdown

| Metric | 2026-W17 |
|---|---|
| `website_visitors` | âš ï¸ unknown |
| `downloads` | âœ… 0.5 |
| `account_signups` | â€” |
| `activation_attempts` | ðŸ”´ not_available |
| `first_successful_dictations` | â€” |
| `trial_starts` | â€” |
| `paid_conversions` | â€” |
| `mrr` | âœ… 0.0 |
| `refunds` | â€” |
| `churned_users` | â¸ not_applicable |
| `content_posts` | â€” |
| `content_views` | â€” |
| `founder_distribution_actions` | â€” |

Legend: âœ… measured/zero &nbsp; âš ï¸ unknown &nbsp; ðŸ”´ not_available &nbsp; â¸ not_applicable

---

## Funnel Summary

### Distribution (top of funnel)

| Metric | Latest | Trend | Checked weeks |
|---|---|---|---|
| `website_visitors` | âš ï¸ unknown | â€” | 0 |
| `downloads` | âœ… 0.5 count (2026-W17) |  | 1 |
| `content_posts` | â€” | â€” | 0 |
| `content_views` | â€” | â€” | 0 |
| `founder_distribution_actions` | â€” | â€” | 0 |

### Activation funnel

| Metric | Latest | Trend | Checked weeks |
|---|---|---|---|
| `account_signups` | â€” | â€” | 0 |
| `activation_attempts` | ðŸ”´ not_available | â€” | 0 |
| `first_successful_dictations` | â€” | â€” | 0 |

### Revenue

| Metric | Latest | Trend | Checked weeks |
|---|---|---|---|
| `trial_starts` | â€” | â€” | 0 |
| `paid_conversions` | â€” | â€” | 0 |
| `mrr` | âœ… 0.0 usd (2026-W17) |  | 1 |
| `refunds` | â€” | â€” | 0 |
| `churned_users` | â¸ not_applicable | â€” | 0 |

---

## Anomaly Flags

> No anomalies detected in current data.

---

## Data Source Backlog

These metrics are marked `not_available` â€” the data source needs to be set up:

- **`activation_attempts`**: Supabase: sessions that reached activation screen this week

---

## Missing Priority Metrics

No confirmed observations yet (excluding not_available and not_applicable):

### `website_visitors`
*Weekly unique website visitors*

How to collect: Vercel Analytics / Plausible â€” weekly unique sessions

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric website_visitors --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `account_signups`
*New accounts created (Supabase auth.users)*

How to collect: Supabase: COUNT(*) FROM auth.users WHERE created_at >= week_start

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric account_signups --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `first_successful_dictations`
*Users who completed first dictation â€” NORTH STAR*

How to collect: Supabase history table: COUNT(DISTINCT user_id) first dictations this week

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric first_successful_dictations --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `trial_starts`
*New trials started (Stripe)*

How to collect: Stripe Dashboard: New trials started this week

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric trial_starts --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `paid_conversions`
*Trial-to-paid conversions (Stripe)*

How to collect: Stripe Dashboard: Subscriptions converted from trial this week

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric paid_conversions --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `refunds`
*Refunds processed (Stripe)*

How to collect: Stripe Dashboard: Refunds processed this week

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric refunds --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `content_posts`
*Content posts published (TikTok / social)*

How to collect: Manual count: posts published to TikTok/social this week

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric content_posts --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `content_views`
*Total content views across all posts*

How to collect: TikTok Analytics: total views across all published content

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric content_views --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `founder_distribution_actions`
*Founder outreach / distribution actions*

How to collect: Manual count: DMs, outreach emails, community posts this week

Record with:
```
python internal/brain/scripts/add_business_observation.py \
    --metric founder_distribution_actions --value <value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

---

## Product-to-Business Connection (V7 Baseline)

> Placeholder â€” will populate when V7 product data and V8 business data
> cover the same weeks. Requires `correlate_metrics.py` (V8 Phase 2).

| V7 Metric | Value | V8 Question | Business Metric |
|---|---|---|---|
| `total_dictation_latency_ms` p50 | 1043 ms | Does lower latency increase retention? | `first_successful_dictations` |
| `paste_execute` | 645 ms (62% of p50) | Paste fix â†’ engagement rise? | `content_views` / dictations per WAU |
| Idle RAM growth | +110 MB / 15 min | RAM fix â†’ lower churn? | `churned_users` |

---

## Suggested Next Actions

**Collect missing metrics (1 remaining):**

- `website_visitors`: Vercel Analytics / Plausible â€” weekly unique sessions

**Continue weekly recordings:** 1/4 weeks of checked data needed.
Record metrics every Monday from Stripe / Supabase / Vercel dashboards.

> This report is measurement-only.
> Growth recommendations require â‰¥4 weeks of checked baseline data.

---

## Stop Conditions

Do not begin growth optimisation until:
- â‰¥4 weeks of **checked** observations for every applicable metric
- Business baseline locked in `data/business_baseline.jsonl`
- `first_successful_dictations` > 0 every week (activation is working)
- At least one product change benchmarked before AND after

*This report is measurement-only. V8 Phase 1 does not optimise â€” it measures.*

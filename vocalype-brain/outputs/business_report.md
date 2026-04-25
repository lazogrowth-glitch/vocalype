# Vocalype Brain — V8 Business Metrics Report

Date: 2026-04-25T14:44:04
Total observations: 1

> This report is measurement-only. No growth recommendations.
> Collect ≥4 weeks of data before locking the business baseline.

---

## Coverage

- Total observations     : 1
- Priority metrics seen  : 1 / 13
- Priority metrics missing: 12
- Weeks recorded         : 1
- Baseline ready (≥4 weeks): NO

| Metric | Weeks recorded | Baseline ready |
|---|---|---|
| `website_visitors` | 0 | ❌ No (0/4) |
| `downloads` | 1 | ❌ No (1/4) |
| `account_signups` | 0 | ❌ No (0/4) |
| `activation_attempts` | 0 | ❌ No (0/4) |
| `first_successful_dictations` | 0 | ❌ No (0/4) |
| `trial_starts` | 0 | ❌ No (0/4) |
| `paid_conversions` | 0 | ❌ No (0/4) |
| `mrr` | 0 | ❌ No (0/4) |
| `refunds` | 0 | ❌ No (0/4) |
| `churned_users` | 0 | ❌ No (0/4) |
| `content_posts` | 0 | ❌ No (0/4) |
| `content_views` | 0 | ❌ No (0/4) |
| `founder_distribution_actions` | 0 | ❌ No (0/4) |

---

## Funnel Summary

### Distribution (top of funnel)

| Metric | Latest week | Trend | Weeks recorded |
|---|---|---|---|
| `website_visitors` | — | — | 0 |
| `downloads` | 1.0 count (2026-W17) |  | 1 |
| `content_posts` | — | — | 0 |
| `content_views` | — | — | 0 |
| `founder_distribution_actions` | — | — | 0 |

### Activation funnel

| Metric | Latest week | Trend | Weeks recorded |
|---|---|---|---|
| `account_signups` | — | — | 0 |
| `activation_attempts` | — | — | 0 |
| `first_successful_dictations` | — | — | 0 |

### Revenue

| Metric | Latest week | Trend | Weeks recorded |
|---|---|---|---|
| `trial_starts` | — | — | 0 |
| `paid_conversions` | — | — | 0 |
| `mrr` | — | — | 0 |
| `refunds` | — | — | 0 |
| `churned_users` | — | — | 0 |

---

## Weekly Trends

> Insufficient data — need ≥2 weeks to show trends.

---

## Product-to-Business Connection (V7 Baseline)

> This section will populate automatically once V7 product data and V8 business
> data cover the same time periods. Placeholder until correlate_metrics.py is built.

| V7 Product Metric | Current Value | V8 Business Question | Business Metric |
|---|---|---|---|
| `total_dictation_latency_ms` p50 | 1043 ms (38 runs) | Does lower latency increase retention? | `first_successful_dictations` |
| `paste_execute` | 645 ms (62% of p50) | If paste drops to 100ms, does engagement rise? | `dictations_per_wau` (not yet recorded) |
| Idle background inference loop | +110 MB over 15min | Does fixing RAM growth reduce churn? | `churned_users` |
| `activation_success_rate` | Unmeasured | Is activation the conversion bottleneck? | `activation_attempts` vs `first_successful_dictations` |

> Correlation analysis requires `correlate_metrics.py` (V8 Phase 2 — not yet built).

---

## Anomaly Flags

> No anomalies detected in current data.

---

## Missing Priority Metrics

The following priority metrics have no observations yet.
Record these during your weekly 10-minute dashboard session.

### `website_visitors`
*Weekly unique website visitors*

How to collect: Vercel Analytics or Plausible — weekly unique sessions

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric website_visitors --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `account_signups`
*New accounts created (Supabase auth.users)*

How to collect: Supabase: SELECT COUNT(*) FROM auth.users WHERE created_at >= week_start

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric account_signups --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `activation_attempts`
*Sessions that reached activation screen*

How to collect: Supabase: sessions that reached activation screen this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric activation_attempts --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `first_successful_dictations`
*Users who completed first dictation — North Star*

How to collect: Supabase history table: COUNT(DISTINCT user_id) first dictations this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric first_successful_dictations --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `trial_starts`
*New trials started (Stripe)*

How to collect: Stripe Dashboard: New trials started this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric trial_starts --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `paid_conversions`
*Trial-to-paid conversions (Stripe)*

How to collect: Stripe Dashboard: Subscriptions converted from trial this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric paid_conversions --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `mrr`
*Monthly Recurring Revenue snapshot (USD)*

How to collect: Stripe Dashboard: MRR snapshot (end of week)

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric mrr --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `refunds`
*Refunds processed (Stripe)*

How to collect: Stripe Dashboard: Refunds processed this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric refunds --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `churned_users`
*Cancelled subscriptions (Stripe)*

How to collect: Stripe Dashboard: Cancelled subscriptions this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric churned_users --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `content_posts`
*Content posts published (TikTok / social)*

How to collect: Manual count: posts published to TikTok/social this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric content_posts --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `content_views`
*Total content views across all posts*

How to collect: TikTok Analytics: total views across all published content

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric content_views --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

### `founder_distribution_actions`
*Founder outreach / distribution actions*

How to collect: Manual count: DMs, outreach emails, community posts this week

Record with:
```
python vocalype-brain/scripts/add_business_observation.py \
    --metric founder_distribution_actions --value <your_value> --unit <unit> \
    --source <source> --period <YYYY-Www>
```

---

## Suggested Next Actions

**Collect missing metrics (12 remaining):**

- `website_visitors`: Vercel Analytics or Plausible — weekly unique sessions
- `account_signups`: Supabase: SELECT COUNT(*) FROM auth.users WHERE created_at >= week_start
- `activation_attempts`: Supabase: sessions that reached activation screen this week
- ... and 9 more (see Missing Priority Metrics section)

**Continue weekly recordings:** 1/4 weeks recorded.
Record metrics every Monday from Stripe / Supabase / Vercel dashboards.

> This report is measurement-only.
> Growth recommendations require ≥4 weeks of baseline data + locked baseline.

---

## Stop Conditions

Do not begin growth optimisation until:
- ≥4 weeks of observations for every priority metric
- Business baseline locked in `data/business_baseline.jsonl`
- At least one product change has been benchmarked before AND after
- `first_successful_dictations` > 0 every week (activation is working)

*This report is measurement-only. V8 Phase 1 does not optimise — it measures.*

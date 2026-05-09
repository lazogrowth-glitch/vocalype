# Vocalype Brain â€” Weekly Business Snapshot

Generated: 2026-04-25T15:29:37
Snapshot period: **2026-W17**
Current week: 2026-W17

> âš ï¸  No real business observations found â€” only validation samples exist.
> Record actual metrics from your Stripe, Supabase, and Vercel dashboards
> before using this snapshot for any decisions.

---

## Metrics Recorded This Week

> No metrics recorded yet for this period.

## Not Yet Recorded

No observation of any kind for these metrics:

- **Website visitors** â€” source: Vercel / Plausible
- **Installer downloads** â€” source: Vercel / GitHub Releases
- **New signups** â€” source: Supabase auth.users
- **Activation attempts** â€” source: Supabase
- **First successful dictations (North Star)** â€” source: Supabase history table
- **Trial starts** â€” source: Stripe Dashboard
- **Paid conversions** â€” source: Stripe Dashboard
- **MRR (USD)** â€” source: Stripe Dashboard
- **Refunds** â€” source: Stripe Dashboard
- **Churned users** â€” source: Stripe Dashboard
- **Content posts published** â€” source: Manual count
- **Content views** â€” source: TikTok / social analytics
- **Distribution actions** â€” source: Manual count

---

## Founder Action Checklist

Run this every Monday (10 minutes):

[ ] **Check North Star:** open Supabase â†’ history table â†’ count distinct users with first dictation this week â†’ record `first_successful_dictations`
[ ] Open Stripe â†’ record `mrr` (even if $0)
[ ] Open Vercel / download page â†’ record `downloads` (even if 0)
[ ] Record `account_signups` from Supabase auth.users
[ ] Record `content_posts` from Manual count
[ ] Record `founder_distribution_actions` from Manual count
[ ] Run: `python internal/brain/scripts/review_business_metrics.py`
[ ] Commit: `git add internal/brain/data/business_observations.jsonl internal/brain/outputs/ && git commit -m "data(brain): weekly business snapshot YYYY-Www"`

---

## Do Not Overreact Yet

This is an **early measurement phase.** These conclusions are premature:

- 0 downloads â‰  product failure. It may mean distribution has not started yet.
- $0 MRR â‰  unsustainable. Pre-revenue is normal at this stage.
- 13 metrics unrecorded: no trend exists yet. One week of data is not a pattern.

> Baseline requires â‰¥4 weeks of checked data before any pattern is meaningful.

---

## Next Metrics to Record

1. `first_successful_dictations` â€” North Star, highest priority
1. `website_visitors` â€” Vercel / Plausible
1. `downloads` â€” Vercel / GitHub Releases
1. `account_signups` â€” Supabase auth.users
1. `activation_attempts` â€” Supabase
1. `trial_starts` â€” Stripe Dashboard
   *(and 7 more â€” see business_report.md)*

---

*Snapshot generated from 0 real observations (6 validation samples excluded).*
*Source: `internal/brain/data/business_observations.jsonl`*
*To record an observation: `python internal/brain/scripts/add_business_observation.py --help`*

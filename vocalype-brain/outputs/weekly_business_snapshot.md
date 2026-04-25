# Vocalype Brain — Weekly Business Snapshot

Generated: 2026-04-25T15:29:37
Snapshot period: **2026-W17**
Current week: 2026-W17

> ⚠️  No real business observations found — only validation samples exist.
> Record actual metrics from your Stripe, Supabase, and Vercel dashboards
> before using this snapshot for any decisions.

---

## Metrics Recorded This Week

> No metrics recorded yet for this period.

## Not Yet Recorded

No observation of any kind for these metrics:

- **Website visitors** — source: Vercel / Plausible
- **Installer downloads** — source: Vercel / GitHub Releases
- **New signups** — source: Supabase auth.users
- **Activation attempts** — source: Supabase
- **First successful dictations (North Star)** — source: Supabase history table
- **Trial starts** — source: Stripe Dashboard
- **Paid conversions** — source: Stripe Dashboard
- **MRR (USD)** — source: Stripe Dashboard
- **Refunds** — source: Stripe Dashboard
- **Churned users** — source: Stripe Dashboard
- **Content posts published** — source: Manual count
- **Content views** — source: TikTok / social analytics
- **Distribution actions** — source: Manual count

---

## Founder Action Checklist

Run this every Monday (10 minutes):

[ ] **Check North Star:** open Supabase → history table → count distinct users with first dictation this week → record `first_successful_dictations`
[ ] Open Stripe → record `mrr` (even if $0)
[ ] Open Vercel / download page → record `downloads` (even if 0)
[ ] Record `account_signups` from Supabase auth.users
[ ] Record `content_posts` from Manual count
[ ] Record `founder_distribution_actions` from Manual count
[ ] Run: `python vocalype-brain/scripts/review_business_metrics.py`
[ ] Commit: `git add vocalype-brain/data/business_observations.jsonl vocalype-brain/outputs/ && git commit -m "data(brain): weekly business snapshot YYYY-Www"`

---

## Do Not Overreact Yet

This is an **early measurement phase.** These conclusions are premature:

- 0 downloads ≠ product failure. It may mean distribution has not started yet.
- $0 MRR ≠ unsustainable. Pre-revenue is normal at this stage.
- 13 metrics unrecorded: no trend exists yet. One week of data is not a pattern.

> Baseline requires ≥4 weeks of checked data before any pattern is meaningful.

---

## Next Metrics to Record

1. `first_successful_dictations` — North Star, highest priority
1. `website_visitors` — Vercel / Plausible
1. `downloads` — Vercel / GitHub Releases
1. `account_signups` — Supabase auth.users
1. `activation_attempts` — Supabase
1. `trial_starts` — Stripe Dashboard
   *(and 7 more — see business_report.md)*

---

*Snapshot generated from 0 real observations (6 validation samples excluded).*
*Source: `vocalype-brain/data/business_observations.jsonl`*
*To record an observation: `python vocalype-brain/scripts/add_business_observation.py --help`*

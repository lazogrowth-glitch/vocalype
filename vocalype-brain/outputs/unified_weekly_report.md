# Vocalype Brain — Unified Weekly Report

Generated: 2026-04-25T20:09:27
Report week: **2026-W17**
Current week: 2026-W17
Data state: **PARTIAL** (1/3 layers have real data)

> ⚠️  Partial data — cross-layer diagnosis is limited.
> See Data Gaps section for what to record.

---

## Layer Status

| Layer | Real obs | Weeks of data | Key signals | Sufficiency |
|---|---|---|---|---|
| **V7 — Product** | 43 | 1 | paste=644ms, inference=254ms, RAM+110MB, idle loop confirmed | ⚠️ 1 week(s) — needs ≥4 |
| **V8 — Business** | 0 (6 excluded) | 0 | — | ❌ No real data |
| **V9 — Distribution** | 0 (1 excluded) | 0 | — | ❌ No real data |

---

## Cross-Layer Join Table

| Period | V7: paste_ms | V7: RAM+MB | V8: downloads | V8: activations | V8: rate | V9: posts | V9: views |
|---|---|---|---|---|---|---|---|
| 2026-W17 | 644ms | 110MB | — | — | — | — | — |

---

## Known Product Constraints (V7)

| Constraint | Evidence | Status |
|---|---|---|
| Product constraint | `paste_latency_ms` median = 644ms (threshold: >300ms) | ⚠️ Unresolved |
| Product constraint | `memory_growth_mb` max = 110MB (threshold: >50MB) | ⚠️ Unresolved |
| Stability risk | idle_background_inference_loop confirmed in logs | ⚠️ Unresolved |

> Pipeline is **paste-bound**: paste=644ms = ~72% of (paste+inference). Inference=254ms is NOT the bottleneck.

---

## Bottleneck Diagnosis

**Bottleneck layer:** V7 — Product  
**Confidence:** 🟡 MEDIUM  

> Confidence is MEDIUM (not HIGH) because V8 and/or V9 have no real data.
> Cannot cross-validate the product constraint against business impact.

---

## Data Gaps — What to Record This Week

- **V8 Business (highest priority):** Open Stripe, Supabase, Vercel. Record `downloads`, `account_signups`, `first_successful_dictations`, `mrr`. Use: `python vocalype-brain/scripts/add_business_observation.py`
- **V9 Content:** No content posts recorded. After publishing, record each post with: `python vocalype-brain/scripts/add_content_observation.py`

---

## Active Risks

- **MEDIUM — Product latency:** paste_execute ≈644ms unresolved. Users experience visible paste lag on every dictation.
- **MEDIUM — Memory leak:** idle background inference loop confirmed. RAM grew +110MB in 15 min idle.
- **LOW — Business blind spot:** 0 real V8 observations. Cannot detect funnel failures or MRR changes.
- **LOW — Distribution blind spot:** 0 real V9 observations. Cannot assess whether content drives downloads.

---

## Active Stop Conditions

| # | Condition | Status |
|---|---|---|
| SC1 | All three layers have 0 real observations | ✅ Clear |
| SC3 | V8 MRR drops > 30% week-over-week | N/A — no V8 data |
| SC6 | 4+ consecutive weeks without sufficient data | ⚠️ Not yet — check in 4 weeks |

---

## Founder Decision Checklist

[ ] Read `outputs/weekly_action.md` for this week's recommended action
[ ] Check whether the diagnosis matches your intuition — if not, check the Data Gaps above
[ ] **Record V8 business metrics** (10-min session — Stripe, Supabase, Vercel)
[ ] **Record V9 content post** after publishing (add_content_observation.py)
[ ] After recording, re-run: `python vocalype-brain/scripts/generate_unified_report.py`
[ ] Commit: `git add vocalype-brain/data/ vocalype-brain/outputs/ && git commit -m "data(brain): weekly unified snapshot YYYY-Www"`

---

## Do Not Overreact Yet

- 1/3 layers have real data — full cross-layer pattern requires all three.
- A single confirmed product constraint does not mean the product is failing — it means one specific fix has high leverage.
- No trend exists until ≥4 consecutive weeks of data in each layer.

> Full cross-layer diagnosis requires ≥4 real weeks in all three layers.

---

*Report generated from V7=43 obs, V8=0 real obs (6 excluded), V9=0 real obs (1 excluded).*
*To re-run: `python vocalype-brain/scripts/generate_unified_report.py`*

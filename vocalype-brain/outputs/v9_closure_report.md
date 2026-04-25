# Vocalype Brain — V9 Closure Report

Date: 2026-04-25
Task type: planning_only
Author: Vocalype Brain
Status: V9 CLOSED as infrastructure phase. V10 design approved to begin.

> This document closes V9 as a measurement infrastructure phase and frames V10.
> No product code was modified during V9. No growth was automated. No content was posted.

---

## 1. V9 Completion Verdict

**V9 is closed. Reason: the distribution measurement infrastructure is complete and working.**

V9 was designed to give the Brain distribution eyes. It delivered on that mandate.

| Deliverable | Status | Notes |
|---|---|---|
| `v9_design_plan.md` — 16-section distribution metrics architecture | ✅ Done | Planning only |
| `add_content_observation.py` — CLI recorder with publication + performance support | ✅ Done | Validated, committed |
| `review_content_performance.py` — report generator with platform/type/hook breakdown | ✅ Done | Validated, committed |
| `weekly_content_snapshot.py` — founder-facing weekly checklist | ✅ Done | Validated, committed |
| `content_observations.jsonl` — append-only JSONL store | ✅ Done | 1 validation sample (excluded from reports) |
| `content_report.md` — auto-generated performance report | ✅ Done | Regenerates on every review run |
| `weekly_content_snapshot.md` — founder checklist with anti-hype section | ✅ Done | Excludes validation samples correctly |
| Platform enum (5 platforms) | ✅ Done | tiktok, instagram_reels, youtube_shorts, youtube, twitter_x |
| Content type enum (8 types) | ✅ Done | demo, tutorial, pain_point, testimonial, hook_test, before_after, day_in_life, reaction |
| Niche enum (8 niches) | ✅ Done | productivity, developer, writer, student, accessibility, remote_worker, entrepreneur, general |
| Safety gates G1–G8 implemented | ✅ Done | No ranking < 5 posts, no trend < 4 weeks, validation excluded |
| Stop conditions SC1, SC3, SC4, SC8 implemented | ✅ Done | Views > 500K flagged, anti-trend warning |
| 4 weeks of real content baseline | ❌ Not collected | No real observations recorded yet |
| `correlate_content_business.py` — Phase 2 join script | ❌ Not built | Requires ≥10 real posts + ≥4 V8 weeks |
| `compare_content_experiments.py` — Phase 3 comparison script | ❌ Not designed | Phase 3 — after joint data baseline |

**Why closing without real content data:**

V9 was always a two-part phase:
1. Build the measurement infrastructure (done)
2. Feed it real content observations over time (ongoing — not a Brain task, a founder task)

The Brain's job in V9 is complete. The infrastructure works, the protocol is defined,
and the scripts handle all early-stage edge cases (no data, validation-only, single platform)
without inventing performance metrics.

The remaining V9 work — recording each piece of content after posting — is a recurring
**founder action**, not a Brain implementation task. The tools to do it exist.

---

## 2. What V9 Can Do Now

| Capability | How |
|---|---|
| Record any content post with full metadata | `add_content_observation.py --platform X --content_type Y --hook "..." ...` |
| Record performance metrics 24–72h later | Same script with `--views`, `--likes`, `--saves`, `--lesson`, `--next_action` |
| Update an existing post with performance data | `--post_id <id> --record_type performance_update` |
| Generate weekly content performance report | `review_content_performance.py` → `content_report.md` |
| Generate founder posting checklist | `weekly_content_snapshot.py` → `weekly_content_snapshot.md` |
| Show platform breakdown and content type breakdown | Built into review script |
| List all hooks tested (tabular) | Built into review script |
| Surface lessons learned across all posts | Built into review script |
| Flag posts with no performance check yet | Coverage gaps section in content_report.md |
| Suggest next experiments from `next_action` fields | Distribution backlog in content_report.md |
| Warn when views > 500K (outlier verification) | Gate SC1 in add script |
| Warn when check_hours < 24 (premature metrics) | Gate G3 in add script |
| Suppress ranking when fewer than 5 posts of a type | Gate G1/G2 in review script |
| Prevent trend claims from < 4 weeks of data | Gate G6 in snapshot script |
| Exclude validation samples from all reports | Source filter on `manual_validation` |
| Warn loudly when only validation samples exist | Both report scripts |

---

## 3. What V9 Cannot Do Yet

| Capability | Why not yet | When |
|---|---|---|
| Show 4-week content performance trends | No real observations yet | After 4 weeks of founder content recording |
| Rank content types by performance | < 5 posts per type (gate G1) | After ≥5 posts per content_type |
| Recommend platform prioritization | No real cross-platform data | After ≥5 posts per platform |
| Correlate content weeks to V8 business weeks | `correlate_content_business.py` not built + no joint data | V9 Phase 2 |
| Compare before/after content experiments | `compare_content_experiments.py` not designed | V9 Phase 3 |
| Automate content posting | Permanently out of V9 Phase 1–3 scope | Phase 4 — separate design |
| Pull analytics via platform APIs | No API integration | Phase 4 — separate design |
| Identify which hook style drives the most downloads | No V8 baseline + no content baseline | After V9 Phase 2 |
| Feed V10 with distribution layer data | No real data → no signal to feed | After 4 weeks of real V9 data |

---

## 4. How V9 Prevents Fake Traction

V9 was designed for the zero-traction early stage where a founder is just starting to post
content and has no performance data yet. Four mechanisms prevent fake traction:

### 4a — Validation sample exclusion
Every script explicitly filters records with `source=manual_validation` before any analysis.
Samples used to test and validate the scripts never appear in the weekly snapshot, the
content report, or the distribution backlog. A warning fires loudly when only validation
samples exist, so the founder is never confused about why all metrics show "0 real posts."

### 4b — No ranking before minimum data
`review_content_performance.py` enforces a minimum of 5 posts per content type and per
platform before showing any ranking or ordering. Below that threshold, the report shows
raw counts only: "3 posts — count only." This prevents "demo posts are better" conclusions
from 1 demo and 0 tutorials.

### 4c — No trend before 4 weeks
`weekly_content_snapshot.py` explicitly counts weeks of data and states "N week(s) of data —
baseline requires ≥4 weeks before any pattern is meaningful." Until 4 weeks of consecutive
posting exist, no trend language is used anywhere in the reports.

### 4d — downloads_attributed never auto-populated
The `downloads_attributed` field in the JSONL schema can only be set by the founder
manually (via `--downloads`). The review script never infers or computes attributed
downloads from `website_clicks` or any other field. Attribution requires the founder to
trace the conversion manually, which prevents inflated download counts driven by
content speculation.

### 4e — Anti-hype section in every snapshot
The weekly snapshot includes an explicit "Do Not Overreact Yet" section that fires
stage-appropriate reality checks: 0 views ≠ product failure, low early reach is normal
as the account grows, one data point is not a pattern.

---

## 5. Current Distribution Data Reality

**As of 2026-04-25:**

| Dimension | Status |
|---|---|
| Real content observations | **0** (1 record is a validation sample) |
| Weeks of real data | 0 / 4 needed for trend analysis |
| Platforms tested | 0 (validation sample not counted) |
| Content types recorded | 0 |
| Hooks tested | 0 |
| Posts with performance data | 0 |
| Lessons learned | 0 |
| Distribution backlog items | 0 |

**This is the honest state.** The measurement infrastructure exists.
The founder has not yet posted and recorded their first real piece of content.

The correct next action is not a Brain task — it is the founder publishing a piece of
content, then opening the platform analytics 24–72h later and recording what is actually
there, using the tools that now exist.

The Brain will process whatever reality the founder records. It will not invent a baseline.

---

## 6. How V9 Connects to V8 Business Metrics

V9 and V8 share the same period key: ISO week `YYYY-Www`.

This alignment makes the following questions answerable in V9 Phase 2:

| V9 signal | V8 signal | Question |
|---|---|---|
| Content posts count in week N | V8 `downloads` in weeks N and N+1 | Does posting more content correlate with more downloads? |
| `profile_visits` sum in week N | V8 `website_visitors` in week N | Do TikTok profile visits show up in Vercel analytics? |
| `website_clicks` sum in week N | V8 `website_visitors` in week N | Does link-in-bio traffic appear in Vercel? |
| `content_type=demo` posts in week N | V8 `first_successful_dictations` | Do demo posts drive activation events the following week? |
| `platform=tiktok` posts in week N | V8 `downloads` in week N+1 | Is TikTok a meaningful download driver? |

**Phase 2 gate:** ≥10 real V9 content observations AND ≥4 weeks of real V8 observations.

**Current status:** 0 real V9 observations. 0 real V8 observations.
Both datasets are empty. The period key alignment is the only current connection.
The V8/V9 join cannot be run until both datasets have real data.

---

## 7. How V9 Connects to V7 Product Insights

V7 profiled the dictation pipeline and found `paste_execute = 645ms` (62% of total
p50 latency). This is the visible lag a viewer sees when a demo post shows Vocalype
pasting transcribed text into an active window.

| V7 finding | V9 implication |
|---|---|
| `paste_execute = 645ms` constant | Demo content shows a real paste delay — the founder should know this is a product limitation, not a recording artifact |
| Idle background inference loop (+110MB/15min) | Long recording demos risk showing RAM warnings on lower-spec machines — avoid extended idle periods in demo cuts |
| p95 tail latency = 2405ms (chunk_cleanup fires 24% of runs) | Demo recordings will occasionally show a slow outlier — not representative; retake if it appears on screen |
| `stt_inference_time = 230ms` (not the bottleneck) | Inference is fast — demos can honestly highlight "instant recognition" for the audio-to-text step |

**When V7 paste fix lands:**
Once the V7 paste_execute investigation is resolved and a fix is applied, the
first data-backed `before_after` content piece becomes possible: "Here's how fast
Vocalype pastes now vs. before." V9 should track this as a `content_type=before_after`
post in the weeks immediately following the patch deployment.

---

## 8. V10 Readiness Verdict

**V10 is NOT ready. V10 design may begin in planning_only mode.**

| V10 gate | Status | Decision |
|---|---|---|
| V7 Phase 2 baseline locked (product benchmark comparison running) | ❌ Not locked | Not waived — product baseline required for cross-layer correlation |
| V8 ≥4 weeks of real business observations | ❌ 0 weeks | Not waived — business layer must have real data before unified decision engine |
| V9 ≥4 weeks of real content observations across ≥2 platforms | ❌ 0 weeks | Not waived — distribution layer must have real data before unified decision engine |
| ≥1 confirmed product improvement applied and measured | ❌ None | Not waived — V10 needs at least one change-and-measure cycle to make useful recommendations |
| Founder sign-off on V9 Phase 2 correlation report | ❌ Not run | Not waived — cross-layer correlation must be validated before automated recommendations |

**Why V10 design can still begin now:**

The design of V10 does not require real data — it requires knowing what V10 should
compute, what its inputs are, what safety constraints it must respect, and what its
output format should be.

Planning V10 now (as a `planning_only` task) ensures the design is ready to execute
the moment all three data layers have real baselines.

**V10 cannot run until** all three layers (V7, V8, V9) have ≥4 weeks of real data
and at least one cross-layer signal has been validated by the founder.

---

## 9. What V10 Should Be

**V10 = Unified Decision Engine — Cross-Layer Weekly Recommendation**

V10 does not automate decisions. It joins V7 (product), V8 (business), and V9
(distribution) data by the shared `period` key and surfaces the **single
highest-leverage action for this week**, ranked by evidence.

V10 answers one question per week:
> "Given current product quality (V7), current funnel performance (V8), and current
> distribution reach (V9) — what is the highest-leverage action this week?"

V10 structure:

| Phase | Description | Gate to enter |
|---|---|---|
| V10 Phase 1 — Cross-layer join | Joins V7 + V8 + V9 by period. Produces a unified weekly table. | ≥4 real weeks in all three datasets |
| V10 Phase 2 — Bottleneck diagnosis | Identifies which layer is the current constraint: product, funnel, or distribution | After Phase 1 run validated by founder |
| V10 Phase 3 — Weekly recommendation | Outputs one ranked action per week with evidence from all three layers | After Phase 2 validated by founder |

V10 inputs:
- `data/benchmark_observations.jsonl` — V7 product metrics
- `data/business_observations.jsonl` — V8 business metrics
- `data/content_observations.jsonl` — V9 distribution metrics
- `memory/operating_contract.md` — safety rules

V10 outputs:
- `outputs/unified_weekly_report.md` — cross-layer join table + bottleneck diagnosis
- `outputs/weekly_action.md` — single ranked action with evidence (one per week)

V10 North Star question (answered each week):
> "Is the constraint this week in the product (V7), the funnel (V8), or distribution (V9)?"

Example recommendations V10 could surface:
- "Product: paste latency 645ms — 3 weeks without a fix. Funnel: 0 first dictations / 12 downloads. Priority = fix paste before adding more distribution."
- "Distribution: 0 content posts this week, downloads flat. Product and funnel stable. Priority = post at least 2 pieces of content this week."
- "Funnel: website visitors up 40% (TikTok drove traffic) but downloads flat. Priority = improve download page CTA, not more content."

---

## 10. What V10 Must NOT Do

| Forbidden action | Why |
|---|---|
| Make decisions autonomously without founder review | V10 outputs recommendations — the founder decides |
| Run without all three layers having real data | Joining empty datasets produces noise, not signal |
| Recommend paid advertising | No CAC/LTV baseline — paid cannot be justified |
| Automate any distribution or product action | V10 is read-only across all three layers |
| Recommend product changes without V7 Phase 2 baseline | Product recommendations require before/after comparison |
| Declare a bottleneck from 1 week of data | One week is not a pattern — minimum 2 consecutive same-layer flags before bottleneck declared |
| Replace V7, V8, or V9 layer-specific reports | V10 supplements the layer reports; it does not replace them |
| Modify backend, auth, license, or product code | Permanently forbidden per operating contract |
| Claim product-market fit, growth trajectory, or virality | Anti-hype — same discipline as V8 and V9 |
| Compute cross-layer correlation before founder validates the join | Phase 1 output must be reviewed before Phase 2 runs |
| Recommend closing any distribution channel without 5+ posts of data | Gate G2 from V9 applies to V10 as well |

---

## 11. Exact Next Prompt for V10 Design

Copy and send this prompt to begin V10 planning:

```
Read and follow:
- vocalype-brain/memory/operating_contract.md
- vocalype-brain/memory/current_state.md
- vocalype-brain/outputs/v7_closure_report.md
- vocalype-brain/outputs/v8_closure_report.md
- vocalype-brain/outputs/v9_closure_report.md

Mission:
Design V10 — Unified Decision Engine.

Task type:
planning_only.
No product code changes.

Goal:
Write the V10 design plan.

Create:
- vocalype-brain/outputs/v10_design_plan.md

The plan must include:
1. V10 objectives (what it answers that V7/V8/V9 cannot answer individually)
2. Cross-layer join protocol (how V7 + V8 + V9 are joined by period key)
3. Bottleneck diagnosis logic (product vs funnel vs distribution)
4. Weekly recommendation format (one action, with evidence citations)
5. Unified weekly report format (outputs/unified_weekly_report.md)
6. Weekly action format (outputs/weekly_action.md)
7. Safety gates (minimum data requirements before each section runs)
8. Stop conditions (when to halt and ask the founder)
9. Anti-hype rules (no PMF claims, no virality claims, no bottleneck from 1 week)
10. What V10 must NOT do
11. How V10 prepares V11 (one paragraph only)
12. Proposed JSONL schemas for any new data files
13. Brain scripts needed (join_layers, diagnose_bottleneck, generate_weekly_action)
14. V10 success criteria
15. Validation commands
16. Exact next prompt for V10 Phase 1 implementation

Context:
V7 produces: benchmark_observations.jsonl
  — latency (paste_execute=645ms bottleneck), RAM (+110MB idle), WER
V8 produces: business_observations.jsonl
  — downloads, signups, first_successful_dictations, MRR, activation_attempts
V9 produces: content_observations.jsonl
  — platform, content_type, hook, views, profile_visits, website_clicks, lesson_learned

All three use ISO week YYYY-Www as the shared period key.

North Star: first_successful_dictations_per_week / downloads_per_week (activation rate)
V10 North Star question: "Is the constraint product, funnel, or distribution?"

Current data state:
  V7: benchmark observations exist (paste_execute bottleneck confirmed)
  V8: 0 real business observations (infrastructure ready)
  V9: 0 real content observations (infrastructure ready)
  Joint data: not yet possible — V8 and V9 need real data first

Rules:
- Do not create automation.
- Do not recommend paid ads.
- Do not modify product code.
- Do not implement scripts yet.
- Only write inside vocalype-brain/.
- If a metric requires data not yet collected, note it as a dependency.
- Design for the future state where all three layers have ≥4 weeks of real data.
```

---

## Summary Card

```
V9 CLOSURE (2026-04-25)
────────────────────────────────────────────────────────────────────
Verdict:   CLOSED — infrastructure complete, real content entry pending

Phase 1:   Complete (3 scripts built, platform/type/niche enums defined,
           validation samples correctly excluded, safety gates implemented)
Phase 2:   Not started (correlate_content_business.py not built —
           requires ≥10 real posts + ≥4 real V8 weeks)
Phase 3:   Not designed (compare_content_experiments.py — Phase 3)
Real data: 0 observations (founder has not posted and recorded yet)

What V9 built:
  add_content_observation.py       — publication + performance recorder
  review_content_performance.py    — platform/type/hook/lesson/backlog report
  weekly_content_snapshot.py       — founder checklist (anti-hype)
  v9_design_plan.md                — 16-section distribution architecture

Anti-traction mechanisms:
  - validation samples excluded from all reports
  - no ranking before ≥5 posts per type (gate G1/G2)
  - no trend before ≥4 weeks (gate G6)
  - downloads_attributed never auto-populated (gate G5)
  - views > 500K flagged for verification (SC1)
  - do-not-overreact section in every snapshot

V10 gates (NOT yet met):
  - V7 Phase 2 baseline locked
  - V8 ≥4 weeks real data
  - V9 ≥4 weeks real data across ≥2 platforms
  - ≥1 confirmed product improvement measured
  - Founder sign-off on V9 Phase 2 correlation

V10 design: APPROVED to begin (planning_only)
V10 entry:  Use exact prompt in Section 11 above

Three-layer architecture complete:
  V7 = product eyes   (benchmark_observations.jsonl)
  V8 = business eyes  (business_observations.jsonl)
  V9 = distribution eyes (content_observations.jsonl)
  V10 = unified brain (joins all three by period key)

Product code touched during V9: ZERO
────────────────────────────────────────────────────────────────────
```

---

*This report is planning_only. No product code was modified or proposed for modification.*
*All source data: `vocalype-brain/data/content_observations.jsonl` (validation sample only at closure).*
